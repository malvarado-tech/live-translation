/**
 * Replay of a recorded session from static files under /replay: a source
 * recording, translated captions and synthetic translated voices, all on one
 * timeline (see public/replay/manifest.json). No server routes and no keys,
 * so the replay works from a static export.
 *
 * No imports, so it runs under `node --test` as well as in the browser.
 */

export type ReplaySegment = {
  id: number;
  start: number;
  end: number;
  source_text: string;
  text: string;
};

export type ReplayAudio = { mp3?: string; webm_opus?: string };

export type ReplayManifest = {
  title: string;
  duration_s: number;
  source: {
    speaker: string;
    event: string;
    date: string;
    language: string;
    source_url: string;
    license: string;
    license_url: string;
    attribution: string;
  };
  source_track: { captions: string; audio: ReplayAudio };
  languages: Array<{
    code: string;
    bcp47: string;
    label: string;
    captions: string;
    audio: ReplayAudio;
    segments: ReplaySegment[];
    tts?: { synthetic?: boolean };
  }>;
};

export type ReplayChannel = {
  code: string;
  bcp47: string;
  label: string;
  /** The speaker's own recording rather than a translation. */
  original: boolean;
  audio: ReplayAudio;
  cues: Array<{ id: number; start: number; end: number; text: string }>;
};

/** Channels in listening order: translations first, then the original. */
export function replayChannels(m: ReplayManifest): ReplayChannel[] {
  const channels: ReplayChannel[] = m.languages.map((l) => ({
    code: l.code,
    bcp47: l.bcp47,
    label: l.label,
    original: false,
    audio: l.audio,
    cues: l.segments.map((s) => ({ id: s.id, start: s.start, end: s.end, text: s.text })),
  }));
  const ref = m.languages[0]?.segments ?? [];
  const srcCode = m.source.language.split("-")[0].toLowerCase();
  channels.push({
    code: srcCode,
    bcp47: m.source.language,
    label: srcCode === "en" ? "English" : m.source.language,
    original: true,
    audio: m.source_track.audio,
    cues: ref.map((s) => ({ id: s.id, start: s.start, end: s.end, text: s.source_text })),
  });
  return channels;
}

/** Cues that have started by time `t` (seconds), oldest first. */
export function cuesUntil<T extends { start: number }>(cues: readonly T[], t: number): T[] {
  let n = 0;
  while (n < cues.length && cues[n].start <= t) n++;
  return cues.slice(0, n);
}

/** The cue being spoken at `t`, or null in a gap. */
export function cueAt<T extends { start: number; end: number }>(cues: readonly T[], t: number): T | null {
  for (const c of cues) if (c.start <= t && t < c.end) return c;
  return null;
}

/** The audio file to load: Opus/WebM when the browser plays it, else MP3. */
export function pickAudio(audio: ReplayAudio, canPlayWebm: boolean): string | null {
  if (canPlayWebm && audio.webm_opus) return audio.webm_opus;
  return audio.mp3 ?? audio.webm_opus ?? null;
}

export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
