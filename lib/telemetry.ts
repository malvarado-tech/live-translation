/**
 * Session telemetry recorder.
 *
 * Accumulates connection-health, latency, listener, and cost metrics during a
 * translation session, plus the full transcript timeline and operator-placed
 * "marks". Pure (no React), the operator page holds an instance in a ref,
 * feeds it events, polls `snapshot()` once a second for the live panel, and
 * calls `report()` at session end to persist a benchmark file.
 */

import type { TranscriptEntry } from "./transcript-utils";

export type ConnSource = "openai" | "gemini" | "livekit";
export type ConnState = "idle" | "connecting" | "live" | "closed" | "error";
export type EngineId = "openai" | "gemini";

export type MarkEntry = {
  /** ms since session start */
  atMs: number;
  /** Operator-provided note, if any. */
  note?: string;
};

// Approximate per-minute USD rates used for the on-screen estimate. Check the
// providers' current pricing; these are not fetched live.
const RATE_OPENAI_TRANSLATE = 0.034;
const RATE_OPENAI_WHISPER = 0.017;
const RATE_GEMINI = 0.023;

export type LatencyStats = {
  count: number;
  lastMs: number | null;
  p50Ms: number | null;
  p95Ms: number | null;
  maxMs: number | null;
};

export type LoggedEvent = {
  /** ms since session start */
  atMs: number;
  kind: string;
  detail: string;
};

export type TelemetrySnapshot = {
  running: boolean;
  startedAtIso: string | null;
  uptimeMs: number;
  conn: Record<ConnSource, ConnState>;
  tokenExpiresInMs: Record<EngineId, number | null>;
  latency: Record<EngineId, LatencyStats>;
  lastActivityAgoMs: Record<EngineId, number | null>;
  disconnects: number;
  errors: number;
  listeners: number;
  peakListeners: number;
  estCostUsd: number;
  marksCount: number;
  transcriptCount: number;
  recentEvents: LoggedEvent[];
};

export type SessionMeta = {
  eventId: string;
  targetLanguage: string;
  engines: EngineId[];
  captureSource: boolean;
};

export type SessionReport = {
  generatedAtIso: string;
  startedAtIso: string | null;
  endedAtIso: string | null;
  durationMs: number;
  meta: SessionMeta;
  conn: Record<ConnSource, ConnState>;
  latency: Record<EngineId, LatencyStats>;
  lastActivityAgoMs: Record<EngineId, number | null>;
  disconnects: number;
  errors: number;
  peakListeners: number;
  estCostUsd: number;
  events: LoggedEvent[];
  marks: MarkEntry[];
  transcript: TranscriptEntry[];
};

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.min(
    sorted.length - 1,
    Math.floor((p / 100) * sorted.length),
  );
  return sorted[idx];
}

function statsOf(samples: number[]): LatencyStats {
  if (samples.length === 0) {
    return { count: 0, lastMs: null, p50Ms: null, p95Ms: null, maxMs: null };
  }
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    count: samples.length,
    lastMs: samples[samples.length - 1],
    p50Ms: percentile(sorted, 50),
    p95Ms: percentile(sorted, 95),
    maxMs: sorted[sorted.length - 1],
  };
}

const EMPTY_META: SessionMeta = {
  eventId: "",
  targetLanguage: "",
  engines: [],
  captureSource: false,
};

export class SessionTelemetry {
  private startedAt: number | null = null;
  private endedAt: number | null = null;
  private events: LoggedEvent[] = [];
  private conn: Record<ConnSource, ConnState> = {
    openai: "idle",
    gemini: "idle",
    livekit: "idle",
  };
  private latencies: Record<EngineId, number[]> = { openai: [], gemini: [] };
  private lastActivityAt: Record<EngineId, number | null> = {
    openai: null,
    gemini: null,
  };
  private liveSince: Record<EngineId, number | null> = {
    openai: null,
    gemini: null,
  };
  private accumulatedMs: Record<EngineId, number> = { openai: 0, gemini: 0 };
  private tokenExpiresAt: Record<EngineId, number | null> = {
    openai: null,
    gemini: null,
  };
  private disconnects = 0;
  private errors = 0;
  private listeners = 0;
  private peakListeners = 0;
  private transcript: TranscriptEntry[] = [];
  private marks: MarkEntry[] = [];
  private meta: SessionMeta = EMPTY_META;

  start(meta: SessionMeta) {
    this.startedAt = Date.now();
    this.endedAt = null;
    this.events = [];
    this.conn = { openai: "idle", gemini: "idle", livekit: "idle" };
    this.latencies = { openai: [], gemini: [] };
    this.lastActivityAt = { openai: null, gemini: null };
    this.liveSince = { openai: null, gemini: null };
    this.accumulatedMs = { openai: 0, gemini: 0 };
    this.tokenExpiresAt = { openai: null, gemini: null };
    this.disconnects = 0;
    this.errors = 0;
    this.listeners = 0;
    this.peakListeners = 0;
    this.transcript = [];
    this.marks = [];
    this.meta = meta;
    this.log(
      "session-start",
      `${meta.eventId} → ${meta.targetLanguage} · engines: ${meta.engines.join(", ")} · captureSource: ${meta.captureSource ? "on" : "off"}`,
    );
  }

  stop() {
    if (this.startedAt === null || this.endedAt !== null) return;
    this.endedAt = Date.now();
    for (const e of ["openai", "gemini"] as EngineId[]) {
      const since = this.liveSince[e];
      if (since !== null) {
        this.accumulatedMs[e] += Date.now() - since;
        this.liveSince[e] = null;
      }
    }
    this.log(
      "session-stop",
      `duration ${Math.round((this.endedAt - this.startedAt) / 1000)}s`,
    );
  }

  private rel(): number {
    return this.startedAt ? Date.now() - this.startedAt : 0;
  }

  private log(kind: string, detail: string) {
    this.events.push({ atMs: this.rel(), kind, detail });
  }

  recordConnState(source: ConnSource, state: ConnState) {
    const prev = this.conn[source];
    if (prev === state) return;
    this.conn[source] = state;
    this.log("conn", `${source}: ${prev} → ${state}`);
    // Count a disconnect only on an *unexpected* drop (transition to "error").
    // A deliberate "Stop translation" transitions live → closed and must NOT
    // inflate the disconnect count.
    if (prev === "live" && state === "error") {
      this.disconnects++;
      this.log("disconnect", `${source} dropped from live (error)`);
    }
    if (source === "openai" || source === "gemini") {
      const e = source as EngineId;
      if (state === "live" && this.liveSince[e] === null) {
        this.liveSince[e] = Date.now();
      } else if (state !== "live" && this.liveSince[e] !== null) {
        this.accumulatedMs[e] += Date.now() - (this.liveSince[e] as number);
        this.liveSince[e] = null;
      }
    }
  }

  recordLatency(engine: EngineId, ms: number) {
    this.latencies[engine].push(ms);
    this.log("latency", `${engine}: ${(ms / 1000).toFixed(2)}s`);
  }

  recordActivity(engine: EngineId) {
    this.lastActivityAt[engine] = Date.now();
  }

  recordListenerCount(n: number) {
    if (n === this.listeners) return;
    this.listeners = n;
    if (n > this.peakListeners) this.peakListeners = n;
    this.log("listeners", `count: ${n}`);
  }

  recordError(scope: string, message: string) {
    this.errors++;
    this.log("error", `${scope}: ${message}`);
  }

  recordReconnect(scope: string, attempt: number, delayMs: number) {
    this.log(
      "reconnect",
      `${scope}: auto-reconnect attempt ${attempt} in ${Math.round(delayMs / 1000)}s`,
    );
  }

  recordTokenExpiry(engine: EngineId, expiresAtMs: number) {
    this.tokenExpiresAt[engine] = expiresAtMs;
    const inMin = Math.round((expiresAtMs - Date.now()) / 60000);
    this.log("token", `${engine} token expires in ~${inMin} min`);
  }

  recordTranscript(
    engine: EngineId,
    channel: "source" | "translated",
    text: string,
  ) {
    if (!text || this.startedAt === null) return;
    this.transcript.push({ atMs: this.rel(), engine, channel, text });
  }

  recordMark(note?: string) {
    if (this.startedAt === null) return;
    const entry: MarkEntry = note ? { atMs: this.rel(), note } : { atMs: this.rel() };
    this.marks.push(entry);
    this.log("mark", note ? note : "(no note)");
  }

  private engineActiveMs(e: EngineId): number {
    const since = this.liveSince[e];
    return this.accumulatedMs[e] + (since !== null ? Date.now() - since : 0);
  }

  private estCost(): number {
    const openaiMin = this.engineActiveMs("openai") / 60000;
    const geminiMin = this.engineActiveMs("gemini") / 60000;
    let cost = openaiMin * RATE_OPENAI_TRANSLATE;
    if (this.meta.captureSource) cost += openaiMin * RATE_OPENAI_WHISPER;
    if (this.meta.engines.includes("gemini")) cost += geminiMin * RATE_GEMINI;
    return cost;
  }

  snapshot(): TelemetrySnapshot {
    const now = Date.now();
    return {
      running: this.startedAt !== null && this.endedAt === null,
      startedAtIso: this.startedAt
        ? new Date(this.startedAt).toISOString()
        : null,
      uptimeMs: this.startedAt ? (this.endedAt ?? now) - this.startedAt : 0,
      conn: { ...this.conn },
      tokenExpiresInMs: {
        openai:
          this.tokenExpiresAt.openai !== null
            ? this.tokenExpiresAt.openai - now
            : null,
        gemini:
          this.tokenExpiresAt.gemini !== null
            ? this.tokenExpiresAt.gemini - now
            : null,
      },
      latency: {
        openai: statsOf(this.latencies.openai),
        gemini: statsOf(this.latencies.gemini),
      },
      lastActivityAgoMs: {
        openai:
          this.lastActivityAt.openai !== null
            ? now - this.lastActivityAt.openai
            : null,
        gemini:
          this.lastActivityAt.gemini !== null
            ? now - this.lastActivityAt.gemini
            : null,
      },
      disconnects: this.disconnects,
      errors: this.errors,
      listeners: this.listeners,
      peakListeners: this.peakListeners,
      estCostUsd: this.estCost(),
      marksCount: this.marks.length,
      transcriptCount: this.transcript.length,
      recentEvents: this.events.slice(-12),
    };
  }

  report(): SessionReport {
    const now = Date.now();
    return {
      generatedAtIso: new Date(now).toISOString(),
      startedAtIso: this.startedAt
        ? new Date(this.startedAt).toISOString()
        : null,
      endedAtIso: this.endedAt ? new Date(this.endedAt).toISOString() : null,
      durationMs: this.startedAt ? (this.endedAt ?? now) - this.startedAt : 0,
      meta: this.meta,
      conn: { ...this.conn },
      latency: {
        openai: statsOf(this.latencies.openai),
        gemini: statsOf(this.latencies.gemini),
      },
      lastActivityAgoMs: {
        openai:
          this.lastActivityAt.openai !== null
            ? now - this.lastActivityAt.openai
            : null,
        gemini:
          this.lastActivityAt.gemini !== null
            ? now - this.lastActivityAt.gemini
            : null,
      },
      disconnects: this.disconnects,
      errors: this.errors,
      peakListeners: this.peakListeners,
      estCostUsd: this.estCost(),
      events: [...this.events],
      marks: [...this.marks],
      transcript: [...this.transcript],
    };
  }
}

/** Format a millisecond duration as `1h 02m 03s` / `2m 03s` / `45s`. */
export function formatDuration(ms: number): string {
  if (ms <= 0) return "0s";
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) {
    return `${h}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
  }
  if (m > 0) return `${m}m ${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}
