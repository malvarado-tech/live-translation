"use client";

import {
  formatDuration,
  type ConnState,
  type LatencyStats,
  type TelemetrySnapshot,
} from "@/lib/telemetry";

const CONN_DOT: Record<ConnState, string> = {
  idle: "bg-dim",
  connecting: "bg-amber",
  live: "bg-green",
  closed: "bg-dim",
  error: "bg-onair",
};

const CONN_TEXT: Record<ConnState, string> = {
  idle: "Idle",
  connecting: "Connecting",
  live: "Connected",
  closed: "Closed",
  error: "Error",
};

function fmtMs(ms: number | null): string {
  if (ms === null) return "None";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

function latencyText(l: LatencyStats): string {
  if (l.count === 0) return "No samples";
  return `Last ${fmtMs(l.lastMs)} · median ${fmtMs(l.p50Ms)} · 95th percentile ${fmtMs(l.p95Ms)} · ${l.count} samples`;
}

/**
 * Once the engine connection is up, the peer connection no longer needs the
 * short-lived key (it was only used for the handshake), so an expired key is
 * informational while connected and a problem only for a reconnect.
 */
function tokenText(ms: number | null, connLive: boolean): { text: string; warn: boolean } {
  if (ms === null) return { text: "None", warn: false };
  if (ms <= 0) {
    return connLive
      ? { text: "Expired, not needed while connected", warn: false }
      : { text: "Expired", warn: true };
  }
  return { text: formatDuration(ms), warn: ms < 5 * 60_000 };
}

function activityText(ms: number | null): { text: string; warn: boolean } {
  if (ms === null) return { text: "None", warn: false };
  return { text: `${Math.round(ms / 1000)} s ago`, warn: ms > 10_000 };
}

/** Session details: engine and room health, timings, cost, event log. */
export function TelemetryPanel({
  snapshot,
  savedBenchmarkPath,
}: {
  snapshot: TelemetrySnapshot | null;
  savedBenchmarkPath: string | null;
}) {
  const s = snapshot;
  if (!s) {
    return (
      <p className="text-[15px] text-silk">
        No session yet. Details start when the room opens or translation starts.
      </p>
    );
  }
  const token = tokenText(s.tokenExpiresInMs.openai, s.conn.openai === "live");
  const activity = activityText(s.lastActivityAgoMs.openai);
  return (
    <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-4" data-testid="session-details">
      <Metric label="Connections">
        <Row label="Translation engine">
          <span className="flex items-center gap-1.5">
            <span aria-hidden className={`inline-block h-2 w-2 rounded-full ${CONN_DOT[s.conn.openai]}`} />
            {CONN_TEXT[s.conn.openai]}
          </span>
        </Row>
        <Row label="Room server">
          <span className="flex items-center gap-1.5">
            <span aria-hidden className={`inline-block h-2 w-2 rounded-full ${CONN_DOT[s.conn.livekit]}`} />
            {CONN_TEXT[s.conn.livekit]}
          </span>
        </Row>
      </Metric>
      <Metric label="Engine key">
        <Row label="Valid for" warn={token.warn}>
          {token.text}
        </Row>
      </Metric>
      <Metric label="First response time">
        <p className="text-[15px] text-ink">{latencyText(s.latency.openai)}</p>
      </Metric>
      <Metric label="Translated text">
        <Row label="Last received" warn={activity.warn}>
          {activity.text}
        </Row>
      </Metric>
      <Metric label="Health">
        <Row label="Drops" warn={s.disconnects > 0}>
          {s.disconnects}
        </Row>
        <Row label="Errors" warn={s.errors > 0}>
          {s.errors}
        </Row>
      </Metric>
      <Metric label="Listeners">
        <Row label="Now">{s.listeners}</Row>
        <Row label="Peak">{s.peakListeners}</Row>
      </Metric>
      <Metric label="Estimated cost">
        <p className="tabular font-cond text-2xl font-semibold text-ink">${s.estCostUsd.toFixed(2)}</p>
        <p className="text-sm text-silk">USD, this session, at list rates</p>
      </Metric>
      <Metric label="Session report">
        <p className="break-all text-sm text-ink">
          {savedBenchmarkPath ?? "Written to benchmarks/ when the session ends."}
        </p>
      </Metric>
      <div className="md:col-span-2 xl:col-span-4">
        <h3 className="mb-1 text-sm font-semibold text-silk">Event log</h3>
        <div className="max-h-48 overflow-y-auto rounded-md border border-line bg-panel-2 p-2 font-mono text-[13px]">
          {s.recentEvents.length === 0 ? (
            <span className="text-silk">No events yet.</span>
          ) : (
            s.recentEvents
              .slice()
              .reverse()
              .map((e, i) => (
                <div key={`${e.atMs}-${i}`} className="flex gap-2 py-0.5">
                  <span className="shrink-0 text-silk">{Math.round(e.atMs / 1000)} s</span>
                  <span className="shrink-0 text-silk">{e.kind}</span>
                  <span className="text-ink">{e.detail}</span>
                </div>
              ))
          )}
        </div>
      </div>
    </div>
  );
}

function Metric({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <h3 className="text-sm font-semibold text-silk">{label}</h3>
      <div className="flex flex-col gap-1">{children}</div>
    </div>
  );
}

function Row({
  label,
  children,
  warn,
}: {
  label: string;
  children: React.ReactNode;
  warn?: boolean;
}) {
  return (
    <div className="flex justify-between gap-3 text-[15px]">
      <span className="text-silk">{label}</span>
      <span className={warn ? "font-semibold text-amber-ink" : "text-ink"}>{children}</span>
    </div>
  );
}
