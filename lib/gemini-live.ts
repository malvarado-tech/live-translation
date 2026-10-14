/**
 * Gemini Live client.
 *
 * Opens a WebSocket to Google's Gemini Live API using an ephemeral token
 * (minted server-side at /api/gemini-token), streams 16 kHz PCM16 mic audio,
 * and plays back the 24 kHz PCM16 translated audio via the Web Audio API.
 *
 * Emits source + translated transcript deltas and a first-audio-received
 * latency event compatible with the operator UI.
 */

import { buildGeminiSystemInstruction } from "./gemini-instruction";

const GEMINI_WS_BASE =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained";

const GEMINI_MODEL = "gemini-3.1-flash-live-preview";
const INPUT_SAMPLE_RATE = 16000;
const OUTPUT_SAMPLE_RATE = 24000;
const WORKLET_URL = "/worklets/pcm-encoder.js";

export type GeminiStatus =
  | "idle"
  | "creating-session"
  | "negotiating"
  | "live"
  | "closed"
  | "error";

export type GeminiEvent =
  | { type: "status"; status: GeminiStatus }
  | { type: "source-transcript"; delta: string }
  | { type: "translated-transcript"; delta: string }
  | { type: "first-audio-received"; latencyMs: number }
  | { type: "token-expiry"; expiresAtMs: number }
  | { type: "error"; message: string };

export type GeminiListener = (event: GeminiEvent) => void;

export type StartGeminiSessionOptions = {
  targetLanguage: string;
  targetLanguageLabel: string;
  onEvent: GeminiListener;
  /** Optional: route the translated audio to this <audio> element. */
  audioSink?: HTMLAudioElement | null;
  /** Optional: also route the translated audio to this second <audio> element
   *  (useful to play the audio at default device for screen-share tab audio
   *  while the primary sink targets a specific monitor headphone). */
  broadcastSink?: HTMLAudioElement | null;
  /** Optional: shared mic stream. If omitted, getUserMedia is called. */
  micStream?: MediaStream;
  /** When true, request input transcription. Adds tokens to the response stream. */
  captureSource?: boolean;
  /** Called once with the translated-audio MediaStream as soon as it's available.
   *  Useful for MediaRecorder / republishing — the same stream that feeds audioSink. */
  onOutputStream?: (stream: MediaStream) => void;
};

export type GeminiSession = {
  stop: () => Promise<void>;
};

type TokenResponse = {
  token?: string;
  model?: string;
  expiresAtMs?: number;
  error?: string;
};

export async function startGeminiSession(
  opts: StartGeminiSessionOptions,
): Promise<GeminiSession> {
  const {
    targetLanguage,
    targetLanguageLabel,
    onEvent,
    audioSink,
    broadcastSink,
    micStream,
    captureSource = false,
    onOutputStream,
  } = opts;
  void targetLanguage;

  let ws: WebSocket | null = null;
  let inputContext: AudioContext | null = null;
  let outputContext: AudioContext | null = null;
  let workletNode: AudioWorkletNode | null = null;
  let micSource: MediaStreamAudioSourceNode | null = null;
  let ownedMicStream: MediaStream | null = null;
  let outputDestination: MediaStreamAudioDestinationNode | null = null;
  let playHead = 0;
  let firstMicChunkAt: number | null = null;
  let firstAudioReceivedReported = false;
  let stopped = false;

  function emit(event: GeminiEvent) {
    try {
      onEvent(event);
    } catch (err) {
      console.error("[gemini-live] listener threw", err);
    }
  }

  async function stop() {
    if (stopped) return;
    stopped = true;
    try {
      workletNode?.disconnect();
      micSource?.disconnect();
      outputDestination?.disconnect();
      ownedMicStream?.getTracks().forEach((track) => track.stop());
      if (ws && ws.readyState === WebSocket.OPEN) {
        try {
          ws.close();
        } catch {
          // ignore
        }
      }
      await inputContext?.close();
      await outputContext?.close();
    } finally {
      ws = null;
      inputContext = null;
      outputContext = null;
      workletNode = null;
      micSource = null;
      outputDestination = null;
      ownedMicStream = null;
      emit({ type: "status", status: "closed" });
    }
  }

  try {
    emit({ type: "status", status: "creating-session" });

    // The translation system instruction is baked into the ephemeral token's
    // constraints (server-side); we also send it again in the setup message
    // below as a belt-and-suspenders safeguard.
    const tokenResp = await fetch("/api/gemini-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetLanguageLabel, captureSource }),
    });
    if (!tokenResp.ok) {
      const text = await tokenResp.text();
      throw new Error(`Token request failed (${tokenResp.status}): ${text}`);
    }
    const tokenData = (await tokenResp.json()) as TokenResponse;
    if (!tokenData.token) {
      throw new Error(`No token in response: ${JSON.stringify(tokenData)}`);
    }
    if (typeof tokenData.expiresAtMs === "number") {
      emit({ type: "token-expiry", expiresAtMs: tokenData.expiresAtMs });
    }

    emit({ type: "status", status: "negotiating" });

    const audioSource =
      micStream ??
      (await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      }));
    if (!micStream) {
      ownedMicStream = audioSource;
    }

    // Input pipeline @ 16 kHz
    inputContext = new AudioContext({ sampleRate: INPUT_SAMPLE_RATE });
    await inputContext.audioWorklet.addModule(WORKLET_URL);
    micSource = inputContext.createMediaStreamSource(audioSource);
    workletNode = new AudioWorkletNode(inputContext, "pcm-encoder");
    micSource.connect(workletNode);
    // Note: we don't connect workletNode to destination — mic should not echo.

    // Output pipeline @ 24 kHz, routed to provided audioSink via a stream destination
    outputContext = new AudioContext({ sampleRate: OUTPUT_SAMPLE_RATE });
    outputDestination = outputContext.createMediaStreamDestination();
    if (audioSink) {
      audioSink.srcObject = outputDestination.stream;
      audioSink.play().catch(() => {
        // User may need to interact first; we ignore here and let the UI retry.
      });
    }
    if (broadcastSink) {
      broadcastSink.srcObject = outputDestination.stream;
      broadcastSink.play().catch(() => {
        // ignore
      });
    }
    if (onOutputStream) {
      try {
        onOutputStream(outputDestination.stream);
      } catch (err) {
        console.error("[gemini-live] onOutputStream threw", err);
      }
    }
    playHead = outputContext.currentTime;

    const url = `${GEMINI_WS_BASE}?access_token=${encodeURIComponent(tokenData.token)}`;
    ws = new WebSocket(url);

    const systemInstruction = buildGeminiSystemInstruction(targetLanguageLabel);

    ws.onopen = () => {
      const setup: Record<string, unknown> = {
        model: `models/${GEMINI_MODEL}`,
        generationConfig: {
          responseModalities: ["AUDIO"],
        },
        systemInstruction: {
          parts: [{ text: systemInstruction }],
        },
        outputAudioTranscription: {},
      };
      if (captureSource) {
        setup.inputAudioTranscription = {};
      }
      ws?.send(JSON.stringify({ setup }));
    };

    ws.onerror = (event) => {
      emit({
        type: "error",
        message: `Gemini WebSocket error: ${(event as Event).type}`,
      });
    };

    ws.onclose = () => {
      void stop();
    };

    ws.onmessage = async (event) => {
      try {
        let data: string;
        if (typeof event.data === "string") {
          data = event.data;
        } else if (event.data instanceof Blob) {
          data = await event.data.text();
        } else if (event.data instanceof ArrayBuffer) {
          data = new TextDecoder().decode(event.data);
        } else {
          return;
        }
        handleServerMessage(JSON.parse(data));
      } catch (err) {
        console.error("[gemini-live] message handling failed", err);
      }
    };

    workletNode.port.onmessage = (msgEvent) => {
      const pcm = msgEvent.data as Int16Array;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      if (firstMicChunkAt === null) firstMicChunkAt = performance.now();
      const base64 = int16ToBase64(pcm);
      ws.send(
        JSON.stringify({
          realtimeInput: {
            audio: {
              data: base64,
              mimeType: `audio/pcm;rate=${INPUT_SAMPLE_RATE}`,
            },
          },
        }),
      );
    };

    emit({ type: "status", status: "live" });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    emit({ type: "error", message });
    emit({ type: "status", status: "error" });
    await stop();
    throw err;
  }

  function handleServerMessage(msg: unknown) {
    if (!isObject(msg)) return;
    const serverContent = (msg as { serverContent?: unknown }).serverContent;
    if (!isObject(serverContent)) return;

    const inputTranscription = (serverContent as { inputTranscription?: { text?: string } })
      .inputTranscription;
    const outputTranscription = (serverContent as { outputTranscription?: { text?: string } })
      .outputTranscription;
    const modelTurn = (serverContent as { modelTurn?: { parts?: Array<{ inlineData?: { data?: string; mimeType?: string } }> } })
      .modelTurn;

    if (inputTranscription?.text) {
      emit({ type: "source-transcript", delta: inputTranscription.text });
    }
    if (outputTranscription?.text) {
      if (!firstAudioReceivedReported && firstMicChunkAt !== null) {
        firstAudioReceivedReported = true;
        emit({
          type: "first-audio-received",
          latencyMs: performance.now() - firstMicChunkAt,
        });
      }
      emit({
        type: "translated-transcript",
        delta: outputTranscription.text,
      });
    }
    if (modelTurn?.parts) {
      for (const part of modelTurn.parts) {
        if (part.inlineData?.data && outputContext && outputDestination) {
          schedulePcmChunk(
            part.inlineData.data,
            outputContext,
            outputDestination,
          );
        }
      }
    }
  }

  function schedulePcmChunk(
    base64: string,
    ctx: AudioContext,
    dest: MediaStreamAudioDestinationNode,
  ) {
    try {
      const int16 = base64ToInt16(base64);
      if (int16.length === 0) return;
      const float32 = new Float32Array(int16.length);
      for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768;
      const buf = ctx.createBuffer(1, float32.length, OUTPUT_SAMPLE_RATE);
      buf.copyToChannel(float32, 0);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(dest);
      const startAt = Math.max(playHead, ctx.currentTime);
      src.start(startAt);
      playHead = startAt + buf.duration;
    } catch (err) {
      console.error("[gemini-live] PCM scheduling failed", err);
    }
  }

  return { stop };
}

function int16ToBase64(int16: Int16Array): string {
  const bytes = new Uint8Array(int16.buffer, int16.byteOffset, int16.byteLength);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToInt16(base64: string): Int16Array {
  const binary = atob(base64);
  const len = binary.length;
  if (len % 2 !== 0) {
    return new Int16Array(0);
  }
  const buffer = new ArrayBuffer(len);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
  return new Int16Array(buffer);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
