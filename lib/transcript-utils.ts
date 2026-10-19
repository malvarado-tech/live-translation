/**
 * Transcript timeline → SRT / VTT.
 *
 * The operator dashboard captures transcript deltas as they arrive from each
 * engine, with timestamps relative to session start. This module turns those
 * deltas into broadcast-ready subtitle files.
 *
 * Grouping strategy: chunk consecutive deltas from the same channel into
 * subtitle "cues" of ~5 seconds each, with each cue showing all the text that
 * arrived during that window. Imperfect, deltas don't carry word-level
 * timing, but it's good enough for portfolio/demo use and offline review.
 */

export type TranscriptEntry = {
  /** ms since session start */
  atMs: number;
  /** which engine produced this delta */
  engine: "openai" | "gemini";
  /** "source" = input (what the speaker said), "translated" = output */
  channel: "source" | "translated";
  /** the delta text fragment */
  text: string;
};

const DEFAULT_CUE_WINDOW_MS = 5_000;
const MIN_CUE_DURATION_MS = 1_500;
const MAX_CUE_DURATION_MS = 8_000;

type Cue = { startMs: number; endMs: number; text: string };

/**
 * Group consecutive same-channel deltas into ~5-second subtitle cues.
 * Cues are clamped to MIN/MAX duration; the last cue's end time is the last
 * delta's atMs + a small tail (so the final cue doesn't vanish instantly).
 */
function buildCues(
  entries: TranscriptEntry[],
  windowMs = DEFAULT_CUE_WINDOW_MS,
): Cue[] {
  if (entries.length === 0) return [];
  const sorted = [...entries].sort((a, b) => a.atMs - b.atMs);
  const cues: Cue[] = [];
  let currentStart = sorted[0].atMs;
  let currentText = "";
  let lastAt = currentStart;

  for (const entry of sorted) {
    if (entry.atMs - currentStart >= windowMs && currentText.trim().length > 0) {
      cues.push({
        startMs: currentStart,
        endMs: Math.max(currentStart + MIN_CUE_DURATION_MS, lastAt + 500),
        text: currentText.trim(),
      });
      currentStart = entry.atMs;
      currentText = "";
    }
    currentText += entry.text;
    lastAt = entry.atMs;
  }
  if (currentText.trim().length > 0) {
    cues.push({
      startMs: currentStart,
      endMs: Math.max(currentStart + MIN_CUE_DURATION_MS, lastAt + 1500),
      text: currentText.trim(),
    });
  }
  // Enforce MAX_CUE_DURATION_MS by clamping; pad gaps so cues don't overlap.
  for (let i = 0; i < cues.length; i++) {
    const cue = cues[i];
    if (cue.endMs - cue.startMs > MAX_CUE_DURATION_MS) {
      cue.endMs = cue.startMs + MAX_CUE_DURATION_MS;
    }
    if (i + 1 < cues.length && cue.endMs > cues[i + 1].startMs) {
      cue.endMs = cues[i + 1].startMs - 1;
    }
  }
  return cues;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}
function pad3(n: number): string {
  if (n < 10) return `00${n}`;
  if (n < 100) return `0${n}`;
  return String(n);
}

function fmtSrtTime(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const milli = ms % 1000;
  return `${pad2(h)}:${pad2(m)}:${pad2(s)},${pad3(milli)}`;
}

function fmtVttTime(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const milli = ms % 1000;
  return `${pad2(h)}:${pad2(m)}:${pad2(s)}.${pad3(milli)}`;
}

export function transcriptToSrt(
  entries: TranscriptEntry[],
  windowMs?: number,
): string {
  const cues = buildCues(entries, windowMs);
  if (cues.length === 0) return "";
  const lines: string[] = [];
  cues.forEach((cue, i) => {
    lines.push(String(i + 1));
    lines.push(`${fmtSrtTime(cue.startMs)} --> ${fmtSrtTime(cue.endMs)}`);
    lines.push(cue.text);
    lines.push("");
  });
  return lines.join("\n");
}

export function transcriptToVtt(
  entries: TranscriptEntry[],
  windowMs?: number,
): string {
  const cues = buildCues(entries, windowMs);
  const lines: string[] = ["WEBVTT", ""];
  cues.forEach((cue) => {
    lines.push(`${fmtVttTime(cue.startMs)} --> ${fmtVttTime(cue.endMs)}`);
    lines.push(cue.text);
    lines.push("");
  });
  return lines.join("\n");
}

/**
 * Filter a transcript timeline to a specific engine + channel.
 */
export function filterTranscript(
  entries: TranscriptEntry[],
  engine: TranscriptEntry["engine"],
  channel: TranscriptEntry["channel"],
): TranscriptEntry[] {
  return entries.filter((e) => e.engine === engine && e.channel === channel);
}
