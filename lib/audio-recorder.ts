/**
 * Audio recorder — thin MediaRecorder wrapper.
 *
 * Used by the operator dashboard to record three audio streams per session:
 * the source mic, the OpenAI translated output, and the Gemini translated
 * output. Each Start Translation → Stop Translation cycle produces ONE
 * recording per stream; multiple cycles within a single Open Room → Close Room
 * session produce numbered segments (`-1`, `-2`, …).
 *
 * The MediaRecorder is configured to emit Opus in a WebM container — small
 * file sizes (~32 kbps), ubiquitous browser support, and acceptable quality
 * for both portfolio/demo use and offline accuracy review.
 */

const MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/mp4',
];

/** Pick the first MediaRecorder MIME type the browser actually supports. */
function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  for (const mime of MIME_CANDIDATES) {
    try {
      if (MediaRecorder.isTypeSupported(mime)) return mime;
    } catch {
      // ignore
    }
  }
  return undefined;
}

export type RecorderHandle = {
  /** Promise that resolves to a Blob containing the full recording. */
  stop: () => Promise<Blob | null>;
  /** True until stop() is called. */
  isRecording: () => boolean;
  /** Container/codec of the produced Blob. */
  mimeType: string;
};

export type StartRecorderOptions = {
  /** MediaStream to record. */
  stream: MediaStream;
  /** Optional: emit a chunk every N ms (default 1000). Bigger = less overhead, more memory before stop. */
  timeslice?: number;
};

/**
 * Start recording a MediaStream. Returns a handle whose `stop()` resolves to
 * the assembled Blob. Returns `null` on environments that don't support
 * MediaRecorder for any of the candidate MIME types — the caller should
 * gracefully skip recording in that case.
 */
export function startRecorder(opts: StartRecorderOptions): RecorderHandle | null {
  const mimeType = pickMimeType();
  if (!mimeType) return null;

  let recorder: MediaRecorder;
  try {
    recorder = new MediaRecorder(opts.stream, { mimeType });
  } catch (err) {
    console.warn("[audio-recorder] MediaRecorder construction failed", err);
    return null;
  }

  const chunks: BlobPart[] = [];
  let running = true;

  recorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) {
      chunks.push(event.data);
    }
  };

  recorder.onerror = (event) => {
    console.error("[audio-recorder] recorder error", event);
  };

  try {
    recorder.start(opts.timeslice ?? 1000);
  } catch (err) {
    console.warn("[audio-recorder] recorder.start failed", err);
    return null;
  }

  return {
    mimeType,
    isRecording: () => running,
    stop: () =>
      new Promise<Blob | null>((resolve) => {
        if (!running) {
          resolve(chunks.length ? new Blob(chunks, { type: mimeType }) : null);
          return;
        }
        running = false;
        recorder.onstop = () => {
          resolve(chunks.length ? new Blob(chunks, { type: mimeType }) : null);
        };
        try {
          recorder.stop();
        } catch (err) {
          console.warn("[audio-recorder] recorder.stop threw", err);
          resolve(chunks.length ? new Blob(chunks, { type: mimeType }) : null);
        }
      }),
  };
}

/**
 * Convert a MIME type string to a sensible file extension.
 */
export function mimeToExtension(mimeType: string): string {
  if (mimeType.includes("webm")) return "webm";
  if (mimeType.includes("ogg")) return "ogg";
  if (mimeType.includes("mp4")) return "m4a";
  return "bin";
}
