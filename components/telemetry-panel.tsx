"use client";

import { useState } from "react";
import {
  formatDuration,
  type ConnState,
  type LatencyStats,
  type TelemetrySnapshot,
} from "@/lib/telemetry";

const CONN_DOT: Record<ConnState, string> = {
  idle: "bg-zinc-400",
  connecting: "bg-amber-400 animate-pulse",
  live: "bg-emerald-500",
  closed: "bg-zinc-400",
  error: "bg-rose-500",
};

function fmtMs(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

function latencyText(l: LatencyStats): string {
  if (l.count === 0) return "no samples";
  return `last ${fmtMs(l.lastMs)} · p50 ${fmtMs(l.p50Ms)} · p95 ${fmtMs(l.p95Ms)} · n=${l.count}`;
}

/**
 * Token-expiry urgency colour.
 * Once the engine connection is `live`, the WebRTC peer no longer needs the
 * client_secret — it was only used for SDP exchange. So when the connection
 * is live, an expired countdown is informational, not alarming. When the
 * connection isn't live, an expired token means we'd need a fresh one to
 * (re)connect, so red is the right cue.
 */
function tokenClass(ms: number | null, connLive: boolean): string {
  if (ms === null) return "text-zinc-400 dark:text-zinc-600";
  if (ms <= 0) {
    return connLive
      ? "text-zinc-500 dark:text-zinc-400"
      : "text-rose-600 dark:text-rose-400 font-semibold";
  }
  if (ms < 5 * 60_000) return "text-rose-600 dark:text-rose-400 font-semibold";
  if (ms < 10 * 60_000) return "text-amber-600 dark:text-amber-400";
  return "text-zinc-700 dark:text-zinc-300";
}

function tokenText(ms: number | null, connLive: boolean): string {
  if (ms === null) return "—";
  if (ms <= 0) return connLive ? "persistent" : "expired";
  return formatDuration(ms);
}

/** Last-activity urgency: >30s red (likely stall), >10s amber, else fine. */
function activityClass(ms: number | null): string {
  if (ms === null) return "text-zinc-400 dark:text-zinc-600";
  if (ms > 30_000) return "text-rose-600 dark:text-rose-400 font-semibold";
  if (ms > 10_000) return "text-amber-600 dark:text-amber-400";
  return "text-zinc-700 dark:text-zinc-300";
}

function activityText(ms: number | null): string {
  if (ms === null) return "—";
  return `${Math.round(ms / 1000)}s ago`;
}

export function TelemetryPanel({
  snapshot,
  geminiEnabled,
  savedBenchmarkPath,
}: {
  snapshot: TelemetrySnapshot | null;
  geminiEnabled: boolean;
  savedBenchmarkPath: string | null;
}) {
  const [collapsed, setCollapsed] = useState(false);

  const s = snapshot;
  const running = s?.running ?? false;

  return (
    <section className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="flex w-full items-center justify-between px-5 py-3 text-left"
      >
        <span className="flex items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Session telemetry
          </span>
          {s ? (
            <span className="text-sm font-mono text-zinc-700 dark:text-zinc-300">
              {formatDuration(s.uptimeMs)}
            </span>
          ) : null}
          {running ? (
            <span className="inline-block h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
          ) : null}
        </span>
        <span className="text-xs text-zinc-400">
          {collapsed ? "▸ show" : "▾ hide"}
        </span>
      </button>

      {collapsed ? null : (
        <div className="border-t border-zinc-200 px-5 py-4 dark:border-zinc-800">
          {!s ? (
            <p className="text-sm text-zinc-400 dark:text-zinc-600">
              No session yet — telemetry starts when you click Start session.
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
              {/* Connection states */}
              <Metric label="Connections">
                <ConnRow label="OpenAI" state={s.conn.openai} />
                {geminiEnabled ? (
                  <ConnRow label="Gemini" state={s.conn.gemini} />
                ) : null}
                <ConnRow label="LiveKit" state={s.conn.livekit} />
              </Metric>

              {/* Token expiry — the long-run watchdog.
                  "persistent" = token expired but the WebRTC peer is still
                  live (the handshake doesn't need the token any more). */}
              <Metric label="Token expiry">
                <div className="flex justify-between text-sm">
                  <span className="text-zinc-500 dark:text-zinc-400">
                    OpenAI
                  </span>
                  <span
                    className={tokenClass(
                      s.tokenExpiresInMs.openai,
                      s.conn.openai === "live",
                    )}
                  >
                    {tokenText(
                      s.tokenExpiresInMs.openai,
                      s.conn.openai === "live",
                    )}
                  </span>
                </div>
                {geminiEnabled ? (
                  <div className="flex justify-between text-sm">
                    <span className="text-zinc-500 dark:text-zinc-400">
                      Gemini
                    </span>
                    <span
                      className={tokenClass(
                        s.tokenExpiresInMs.gemini,
                        s.conn.gemini === "live",
                      )}
                    >
                      {tokenText(
                        s.tokenExpiresInMs.gemini,
                        s.conn.gemini === "live",
                      )}
                    </span>
                  </div>
                ) : null}
              </Metric>

              {/* Latency */}
              <Metric label="First-token latency">
                <div className="text-sm">
                  <span className="text-zinc-500 dark:text-zinc-400">
                    OpenAI:{" "}
                  </span>
                  <span className="text-zinc-700 dark:text-zinc-300">
                    {latencyText(s.latency.openai)}
                  </span>
                </div>
                {geminiEnabled ? (
                  <div className="text-sm">
                    <span className="text-zinc-500 dark:text-zinc-400">
                      Gemini:{" "}
                    </span>
                    <span className="text-zinc-700 dark:text-zinc-300">
                      {latencyText(s.latency.gemini)}
                    </span>
                  </div>
                ) : null}
              </Metric>

              {/* Audio activity */}
              <Metric label="Last activity">
                <div className="flex justify-between text-sm">
                  <span className="text-zinc-500 dark:text-zinc-400">
                    OpenAI
                  </span>
                  <span className={activityClass(s.lastActivityAgoMs.openai)}>
                    {activityText(s.lastActivityAgoMs.openai)}
                  </span>
                </div>
                {geminiEnabled ? (
                  <div className="flex justify-between text-sm">
                    <span className="text-zinc-500 dark:text-zinc-400">
                      Gemini
                    </span>
                    <span
                      className={activityClass(s.lastActivityAgoMs.gemini)}
                    >
                      {activityText(s.lastActivityAgoMs.gemini)}
                    </span>
                  </div>
                ) : null}
              </Metric>

              {/* Health counters */}
              <Metric label="Health">
                <Counter
                  label="Disconnects"
                  value={s.disconnects}
                  alert={s.disconnects > 0}
                />
                <Counter
                  label="Errors"
                  value={s.errors}
                  alert={s.errors > 0}
                />
              </Metric>

              {/* Listeners */}
              <Metric label="Listeners">
                <Counter label="Current" value={s.listeners} />
                <Counter label="Peak" value={s.peakListeners} />
              </Metric>

              {/* Cost */}
              <Metric label="Estimated cost">
                <div className="font-mono text-lg text-zinc-900 dark:text-zinc-100">
                  ${s.estCostUsd.toFixed(4)}
                </div>
                <div className="text-xs text-zinc-400 dark:text-zinc-600">
                  USD · this session
                </div>
              </Metric>

              {/* Saved benchmark */}
              <Metric label="Benchmark file">
                {savedBenchmarkPath ? (
                  <div className="break-all font-mono text-xs text-emerald-700 dark:text-emerald-400">
                    {savedBenchmarkPath}
                  </div>
                ) : (
                  <div className="text-xs text-zinc-400 dark:text-zinc-600">
                    Written to benchmarks/ when you Stop.
                  </div>
                )}
              </Metric>

              {/* Event log — spans full width */}
              <div className="md:col-span-2 lg:col-span-4">
                <div className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  Recent events
                </div>
                <div className="max-h-40 overflow-y-auto rounded-md border border-zinc-200 bg-zinc-50 p-2 font-mono text-xs dark:border-zinc-800 dark:bg-zinc-950">
                  {s.recentEvents.length === 0 ? (
                    <span className="text-zinc-400 dark:text-zinc-600">
                      No events yet.
                    </span>
                  ) : (
                    s.recentEvents
                      .slice()
                      .reverse()
                      .map((e, i) => (
                        <div
                          key={`${e.atMs}-${i}`}
                          className="flex gap-2 py-0.5"
                        >
                          <span className="shrink-0 text-zinc-400 dark:text-zinc-600">
                            {Math.round(e.atMs / 1000)}s
                          </span>
                          <span className="shrink-0 text-zinc-500 dark:text-zinc-500">
                            [{e.kind}]
                          </span>
                          <span className="text-zinc-700 dark:text-zinc-300">
                            {e.detail}
                          </span>
                        </div>
                      ))
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function Metric({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        {label}
      </span>
      <div className="flex flex-col gap-1">{children}</div>
    </div>
  );
}

function ConnRow({ label, state }: { label: string; state: ConnState }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-zinc-500 dark:text-zinc-400">{label}</span>
      <span className="flex items-center gap-1.5">
        <span
          className={`inline-block h-2 w-2 rounded-full ${CONN_DOT[state]}`}
          aria-hidden
        />
        <span className="text-zinc-700 dark:text-zinc-300">{state}</span>
      </span>
    </div>
  );
}

function Counter({
  label,
  value,
  alert,
}: {
  label: string;
  value: number;
  alert?: boolean;
}) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-zinc-500 dark:text-zinc-400">{label}</span>
      <span
        className={
          alert
            ? "font-semibold text-rose-600 dark:text-rose-400"
            : "text-zinc-700 dark:text-zinc-300"
        }
      >
        {value}
      </span>
    </div>
  );
}
