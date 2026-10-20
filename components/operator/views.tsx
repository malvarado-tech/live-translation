"use client";

/**
 * Operator views over one model, shared by the live dashboard and the
 * read-only replay:
 *  - Desk: vertical channel strips (tally, ladder meter, response time,
 *    listeners, on-air time) with transcript lanes below.
 *  - Rows: horizontal channel rows, one alert slot with its fix, and the
 *    monitored transcript at reading size.
 * Both views keep the Audio section (devices, input level, monitor) on
 * screen.
 */
import { QRCodeSVG } from "qrcode.react";
import { UrlText } from "@/components/ui/url-text";
import { memo, useEffect, useRef, useState, type ReactNode } from "react";
import { AudioSection, type AudioModel } from "@/components/operator/audio-section";
import {
  Button,
  buttonClass,
  HMeter,
  Kbd,
  Segmented,
  Tally,
  VMeter,
  type TallyTone,
} from "@/components/ui/controls";
import { FOLLOW_FADE, LatestButton, useFollowScroll } from "@/components/ui/follow-scroll";
import type { CaptionLine } from "@/lib/captions";
import { useOperatorView, useTheme } from "@/lib/prefs";

export type Stat = { label: string; value: string; tone?: "warn" | "ok" | "dim" };

export type StripModel = {
  key: string;
  code: string;
  label: string;
  tally: { tone: TallyTone; text: string };
  level: number | null;
  /** Shown instead of the meter when no level is available here. */
  levelNote?: string;
  stats: Stat[];
  /** One line for the Rows view. */
  meta: string;
  fault?: boolean;
  actions?: ReactNode;
  /** Where the data comes from; shown once per view, not per strip. */
  source?: string;
  lang?: string;
};

export type AlertModel = {
  severity: "warn" | "fault";
  title: string;
  body: string;
  detail?: string | null;
  actions?: ReactNode;
};

export type TranscriptModel = {
  title: string;
  badge?: { text: string; tone?: "ok" | "dim" } | null;
  lines: CaptionLine[];
  lang: string;
  placeholder: string;
};

export type QrModel = {
  url: string;
  caption: string;
  roomUrl?: string | null;
  /** Full-screen QR page for a projector, opened in a new tab. */
  pageUrl?: string | null;
  actions?: ReactNode;
};

export type ListenerPreview = { code: string; text: string; tone: "ok" | "warn" | "dim"; lang: string };

export type OperatorModel = {
  input: StripModel;
  channels: StripModel[];
  alert: AlertModel | null;
  /** Shown in the alert slot when there is no alert. */
  okLine: string;
  source: TranscriptModel | null;
  target: TranscriptModel | null;
  qr: QrModel | null;
  listenersSee: ListenerPreview[];
  audio: AudioModel | null;
  addLanguage?: ReactNode;
  log: Array<{ at: string; text: string }>;
};

/* ------------------------------------------------------------------ bar */

export type SessionBarProps = {
  tally: { tone: TallyTone; text: string };
  clock: string;
  title: string;
  subtitle: string;
  figures: Stat[];
  actions: ReactNode;
};

export function SessionBar({ tally, clock, title, subtitle, figures, actions }: SessionBarProps) {
  return (
    <header className="z-30 border-b border-line bg-panel lg:sticky lg:top-0" data-testid="session-bar">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3">
        <div className="flex items-center gap-4">
          <Tally tone={tally.tone} className="h-9 text-lg" testId="session-tally">
            {tally.text}
          </Tally>
          <span className="tabular font-cond text-[34px] font-semibold leading-none text-ink" data-testid="session-clock">
            {clock}
          </span>
        </div>
        <div className="min-w-0 border-l border-line pl-4">
          <h1 className="truncate text-base font-semibold text-ink">{title}</h1>
          <p className="truncate text-sm text-silk">{subtitle}</p>
        </div>
        <dl className="flex gap-5">
          {figures.map((f) => (
            <div key={f.label}>
              <dt className="font-cond text-sm font-semibold text-silk">{f.label}</dt>
              <dd
                className={`tabular font-cond text-2xl font-semibold leading-none ${
                  f.tone === "warn" ? "text-amber-ink" : "text-ink"
                }`}
              >
                {f.value}
              </dd>
            </div>
          ))}
        </dl>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {actions}
          <SettingsMenu />
        </div>
      </div>
    </header>
  );
}

/** View and theme, behind one Settings button at the end of the bar. */
function SettingsMenu() {
  const [view, setView] = useOperatorView();
  const [theme, setTheme] = useTheme();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement | null>(null);
  const button = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    const onDown = (e: PointerEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

  return (
    <div className="relative" ref={wrap}>
      <button
        ref={button}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="operator-settings"
        data-testid="settings-button"
        className={`${buttonClass("ghost", "md")} ${open ? "bg-btn-hover" : ""}`}
      >
        <svg aria-hidden width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <path d="M2 4.5h8M14 4.5h2M2 13.5h3M9 13.5h7" />
          <circle cx="12" cy="4.5" r="2" />
          <circle cx="7" cy="13.5" r="2" />
        </svg>
        Settings
      </button>
      {open ? (
        <div
          id="operator-settings"
          role="group"
          aria-label="Settings"
          data-testid="settings-menu"
          className="absolute right-0 top-full z-40 mt-2 flex w-[min(280px,calc(100vw-32px))] flex-col gap-4 rounded-md border border-line bg-panel p-4 shadow-lg"
        >
          <Segmented
            label="View"
            value={view}
            onChange={setView}
            stretch
            options={[
              { value: "desk", label: "Desk" },
              { value: "rows", label: "Rows" },
            ]}
            testId="operator-view-switch"
          />
          <Segmented
            label="Theme"
            value={theme}
            onChange={setTheme}
            stretch
            options={[
              { value: "light", label: "Light" },
              { value: "night", label: "Night" },
            ]}
            testId="operator-theme-switch"
          />
        </div>
      ) : null}
    </div>
  );
}

/* ---------------------------------------------------------------- parts */

export function AlertSlot({ alert, okLine }: { alert: AlertModel | null; okLine: string }) {
  if (!alert) {
    return (
      <div className="flex min-h-12 items-center gap-3 px-1 text-silk" data-testid="alert-slot" data-state="ok">
        <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full bg-green" />
        <span className="shrink-0 whitespace-nowrap font-semibold text-ink">No alerts</span>
        <span className="min-w-0">{okLine}</span>
      </div>
    );
  }
  const fault = alert.severity === "fault";
  return (
    <div
      role="alert"
      data-testid="alert-slot"
      data-state={alert.severity}
      className={`grid grid-cols-1 items-center gap-x-4 gap-y-2 rounded-md border px-5 py-4 sm:grid-cols-[1fr_auto] ${
        fault ? "border-error-ink bg-error-wash" : "border-amber bg-amber text-on-amber"
      }`}
    >
      <div className="min-w-0">
        <p className={`text-lg font-bold ${fault ? "text-error-ink" : "text-on-amber"}`}>{alert.title}</p>
        <p className={`mt-1 text-[15px] ${fault ? "text-ink" : "text-on-amber"}`}>{alert.body}</p>
        {alert.detail ? (
          <p className={`mt-1 break-words font-mono text-[13px] ${fault ? "text-silk" : "text-on-amber"}`}>
            Detail: {alert.detail}
          </p>
        ) : null}
      </div>
      {alert.actions ? <div className="flex flex-wrap gap-2">{alert.actions}</div> : null}
    </div>
  );
}

function fmtTime(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "";
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

const LaneLine = memo(function LaneLine({
  at,
  text,
  current,
  size,
}: {
  at: number | null | undefined;
  text: string;
  current: boolean;
  size: "md" | "lg";
}) {
  return (
    <div className="grid grid-cols-[44px_1fr] gap-3">
      <span className="tabular pt-0.5 font-cond text-sm text-silk">{fmtTime(at)}</span>
      <p
        className={
          size === "lg"
            ? current
              ? "font-caption text-[30px] font-bold leading-tight text-ink"
              : "font-caption text-[22px] leading-snug text-silk"
            : current
              ? "text-[17px] font-medium text-ink"
              : "text-[15px] text-silk"
        }
      >
        {text}
      </p>
    </div>
  );
});

/**
 * A transcript lane with the whole session: it follows the newest line
 * until the operator scrolls back, then "Back to latest" returns.
 */
export function TranscriptLane({
  model,
  size = "md",
  testId,
}: {
  model: TranscriptModel;
  size?: "md" | "lg";
  testId?: string;
}) {
  const lines = model.lines;
  const { scrollRef, contentRef, following, overflow, resume } = useFollowScroll();
  return (
    <section
      className="flex min-h-0 flex-col gap-2 rounded-md border border-line bg-panel px-4 py-3"
      data-testid={testId}
      data-following={following ? "true" : "false"}
      aria-label={model.title}
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-cond text-[15px] font-semibold tracking-[0.04em] text-silk">{model.title}</h2>
        {model.badge ? (
          <span className={`text-sm font-semibold ${model.badge.tone === "ok" ? "text-green-ink" : "text-silk"}`}>
            {model.badge.text}
          </span>
        ) : null}
      </div>
      <div className="relative min-h-0 flex-1">
        <div
          ref={scrollRef}
          role="log"
          aria-live="off"
          aria-label={`${model.title}, transcript`}
          tabIndex={0}
          data-testid={testId ? `${testId}-scroll` : undefined}
          className={`overflow-y-auto overscroll-contain [scrollbar-width:thin] ${
            size === "lg" ? "max-h-[min(62vh,640px)]" : "max-h-72"
          } ${overflow && following ? FOLLOW_FADE : ""}`}
          lang={model.lang}
        >
          <div ref={contentRef} className="flex flex-col gap-2">
            {lines.length === 0 ? (
              <p className="text-[15px] text-silk">{model.placeholder}</p>
            ) : (
              lines.map((l, i) => (
                <LaneLine key={l.id} at={l.at} text={l.text} current={i === lines.length - 1} size={size} />
              ))
            )}
          </div>
        </div>
        <LatestButton
          visible={!following}
          label="Back to latest"
          onClick={resume}
          testId={testId ? `${testId}-latest` : "lane-latest"}
        />
      </div>
    </section>
  );
}

export function QrCard({ qr, compact = false }: { qr: QrModel; compact?: boolean }) {
  const [projector, setProjector] = useState(false);
  useEffect(() => {
    if (!projector) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setProjector(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [projector]);
  return (
    <section
      className={`flex gap-4 rounded-md border border-line bg-panel p-4 ${compact ? "flex-row items-center" : "flex-col"}`}
      data-testid="event-link"
      aria-label="Listener code"
    >
      {!compact ? <h2 className="font-cond text-[15px] font-semibold text-silk">Listener code</h2> : null}
      <div className={`rounded bg-white p-2 ${compact ? "shrink-0" : "self-center"}`}>
        <QRCodeSVG value={qr.url} size={compact ? 112 : 168} fgColor="#111519" bgColor="#ffffff" />
      </div>
      <div className="flex min-w-0 flex-col gap-2">
        <p className="font-cond text-lg font-semibold text-ink" data-testid="event-url">
          <UrlText url={qr.url} />
        </p>
        <p className="text-sm text-silk">{qr.caption}</p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => setProjector(true)}>
            Projector view
          </Button>
          {qr.pageUrl ? (
            <a
              href={qr.pageUrl}
              target="_blank"
              rel="noopener"
              className={buttonClass("default", "sm")}
              data-testid="open-qr-page"
            >
              Open QR page
            </a>
          ) : null}
          {qr.actions}
        </div>
      </div>
      {projector ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Projector view"
          className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-white p-8 text-[#111519]"
        >
          <QRCodeSVG value={qr.url} size={Math.min(560, 0.6 * 1000)} fgColor="#111519" bgColor="#ffffff" className="h-auto max-h-[62vh] w-auto max-w-[80vw]" />
          <p className="text-center font-cond text-5xl font-bold">
            <UrlText url={qr.url} />
          </p>
          <p className="text-2xl">{qr.caption}</p>
          <button
            type="button"
            onClick={() => setProjector(false)}
            className="min-h-11 rounded-md border border-[#7d8893] px-5 text-base font-semibold"
          >
            Close projector view <span className="ml-2 text-sm">(Esc)</span>
          </button>
        </div>
      ) : null}
    </section>
  );
}

function StatList({ stats, large = false }: { stats: Stat[]; large?: boolean }) {
  return (
    <dl className="flex flex-col gap-2.5">
      {stats.map((s) => (
        <div key={s.label}>
          <dt className="font-cond text-sm font-semibold text-silk">{s.label}</dt>
          <dd
            className={`tabular font-cond font-semibold leading-tight ${large ? "text-[22px]" : "text-lg"} ${
              s.tone === "warn" ? "text-amber-ink" : s.tone === "dim" ? "text-silk" : "text-ink"
            }`}
          >
            {s.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function DeskStrip({ strip, kind }: { strip: StripModel; kind: "input" | "channel" }) {
  return (
    <section
      className={`flex min-w-0 flex-col gap-3 rounded-md border bg-panel p-3 ${
        strip.fault ? "border-amber ring-2 ring-amber" : "border-line"
      }`}
      data-testid={`strip-${strip.key}`}
      aria-label={kind === "input" ? "Input" : `${strip.code.toUpperCase()} ${strip.label}`}
    >
      {kind === "input" ? (
        <div className="flex items-center justify-between">
          <h2 className="font-cond text-lg font-semibold text-ink">Input</h2>
          <span className={`text-sm font-semibold ${strip.tally.tone === "fault" || strip.tally.tone === "warn" ? "text-amber-ink" : "text-green-ink"}`}>
            {strip.tally.text}
          </span>
        </div>
      ) : (
        <Tally tone={strip.tally.tone} className="h-9 text-[17px]" testId={`tally-${strip.key}`}>
          {strip.tally.text}
        </Tally>
      )}
      <div>
        <p className={`font-cond font-bold leading-[0.9] text-ink ${kind === "input" ? "text-2xl" : "text-[46px]"}`}>
          {kind === "input" ? strip.label : strip.code.toUpperCase()}
        </p>
        <p className="mt-1 truncate text-sm text-silk" lang={strip.lang}>
          {kind === "input" ? strip.code : strip.label}
        </p>
      </div>
      <div className="flex flex-1 gap-3">
        {strip.level !== null || !strip.levelNote ? (
          <VMeter level={strip.level} label={`${strip.code} level`} testId={`meter-${strip.key}`} />
        ) : (
          <div className="flex w-[30px] shrink-0 rounded-[3px] bg-well" aria-hidden />
        )}
        <div className="flex min-w-0 flex-col gap-2">
          <StatList stats={strip.stats} large />
          {strip.levelNote ? <p className="text-xs text-silk">{strip.levelNote}</p> : null}
        </div>
      </div>
      {strip.actions ? <div className="flex flex-wrap gap-2">{strip.actions}</div> : null}
    </section>
  );
}

function RowsRow({ strip, kind }: { strip: StripModel; kind: "input" | "channel" }) {
  return (
    <div
      className={`grid grid-cols-[100px_minmax(0,1fr)] items-center gap-x-4 gap-y-2 border-b border-line px-4 py-3 last:border-b-0 sm:grid-cols-[110px_130px_minmax(0,1fr)_auto] ${
        strip.fault ? "bg-amber-wash" : ""
      }`}
      data-testid={`row-${strip.key}`}
    >
      <Tally tone={kind === "input" ? "off" : strip.tally.tone} className="h-8 text-base" testId={`tally-${strip.key}`}>
        {kind === "input" ? "Input" : strip.tally.text}
      </Tally>
      <span className="min-w-0">
        <span
          className={`block font-cond font-bold leading-none text-ink ${
            kind === "input" ? "truncate text-xl" : "text-[28px]"
          }`}
          title={kind === "input" ? strip.label : undefined}
        >
          {kind === "input" ? strip.label : strip.code.toUpperCase()}
        </span>
        <span className="block truncate text-sm text-silk" lang={strip.lang}>
          {kind === "input" ? strip.code : strip.label}
        </span>
      </span>
      <span className="col-span-2 min-w-0 sm:col-span-1">
        {strip.level === null && strip.levelNote ? (
          <span className="block rounded-[4px] bg-well px-2 py-1.5 text-xs text-silk">{strip.levelNote}</span>
        ) : (
          <HMeter level={strip.level} segments={24} label={`${strip.code} level`} testId={`meter-${strip.key}`} />
        )}
        <span className={`mt-1.5 block text-sm ${strip.fault ? "font-semibold text-amber-ink" : "text-silk"}`}>
          {strip.meta}
        </span>
      </span>
      {strip.actions ? (
        <span className="col-span-2 flex flex-wrap gap-2 sm:col-span-1 sm:justify-end">{strip.actions}</span>
      ) : null}
    </div>
  );
}

/** The data-source note shared by strips, shown once. */
function SourceNote({ channels }: { channels: StripModel[] }) {
  const note = channels.find((c) => c.source)?.source;
  return note ? <p className="text-sm text-silk" data-testid="source-note">{note}</p> : null;
}

function ListenersSee({ items }: { items: ListenerPreview[] }) {
  if (items.length === 0) return null;
  return (
    <section aria-label="Listeners see" className="flex flex-col gap-2">
      <h2 className="text-sm text-silk">Listeners see</h2>
      <ul className="flex flex-wrap gap-2">
        {items.map((i) => (
          <li
            key={i.code}
            className={`rounded-[4px] border px-3 py-2 text-sm ${
              i.tone === "warn" ? "border-amber bg-amber-wash text-ink" : "border-line bg-panel text-ink"
            }`}
          >
            <b className="font-cond">{i.code.toUpperCase()}</b>{" "}
            <span lang={i.lang}>&ldquo;{i.text}&rdquo;</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function LogStrip({ log }: { log: OperatorModel["log"] }) {
  return (
    <section aria-label="Log" className="flex items-start gap-4 border-t border-line pt-3 text-sm">
      <h2 className="font-semibold text-silk">Log</h2>
      {log.length === 0 ? (
        <p className="text-silk">No entries yet.</p>
      ) : (
        <ol className="flex flex-wrap gap-x-6 gap-y-1">
          {log.slice(-6).reverse().map((e, i) => (
            <li key={`${e.at}-${i}`} className="text-ink">
              <span className="tabular mr-2 text-silk">{e.at}</span>
              {e.text}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/* ---------------------------------------------------------------- views */

export function DeskView({ model }: { model: OperatorModel }) {
  return (
    <div className="flex flex-col gap-4" data-testid="desk-view">
      {model.alert ? <AlertSlot alert={model.alert} okLine={model.okLine} /> : null}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[repeat(auto-fit,minmax(200px,1fr))]">
        <DeskStrip strip={model.input} kind="input" />
        {model.channels.map((c) => (
          <DeskStrip key={c.key} strip={c} kind="channel" />
        ))}
        {model.addLanguage ? (
          <section className="flex flex-col justify-center gap-3 rounded-md border border-dashed border-line-strong p-3">
            {model.addLanguage}
          </section>
        ) : null}
        {model.qr ? <QrCard qr={model.qr} /> : null}
      </div>
      <SourceNote channels={model.channels} />
      {model.audio ? <AudioSection audio={model.audio} wide /> : null}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {model.source ? <TranscriptLane model={model.source} testId="lane-source" /> : null}
        {model.target ? <TranscriptLane model={model.target} testId="lane-target" /> : null}
      </div>
      <ListenersSee items={model.listenersSee} />
      <LogStrip log={model.log} />
    </div>
  );
}

export function RowsView({ model }: { model: OperatorModel }) {
  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]" data-testid="rows-view">
      <div className="flex min-w-0 flex-col gap-4">
        <AlertSlot alert={model.alert} okLine={model.okLine} />
        <div className="rounded-md border border-line bg-panel">
          <RowsRow strip={model.input} kind="input" />
          {model.channels.map((c) => (
            <RowsRow key={c.key} strip={c} kind="channel" />
          ))}
          {model.addLanguage ? (
            <div className="flex flex-wrap items-center gap-3 px-4 py-3">{model.addLanguage}</div>
          ) : null}
        </div>
        <SourceNote channels={model.channels} />
        {model.audio ? <AudioSection audio={model.audio} /> : null}
        <ListenersSee items={model.listenersSee} />
        {model.qr ? <QrCard qr={model.qr} compact /> : null}
      </div>
      <div className="flex min-w-0 flex-col gap-4">
        {model.source ? <TranscriptLane model={model.source} testId="lane-source" /> : null}
        {model.target ? (
          <TranscriptLane model={model.target} size="lg" testId="lane-target" />
        ) : null}
        <LogStrip log={model.log} />
      </div>
    </div>
  );
}

export function OperatorBody({ model }: { model: OperatorModel }) {
  const [view] = useOperatorView();
  return view === "rows" ? <RowsView model={model} /> : <DeskView model={model} />;
}

export function SessionActions({
  canMark,
  onMark,
  primary,
  end,
}: {
  canMark: boolean;
  onMark: () => void;
  primary: { label: string; onClick: () => void; disabled?: boolean; tone?: "primary" | "default" } | null;
  end: { label: string; onClick: () => void; disabled?: boolean } | null;
}) {
  return (
    <>
      <Button onClick={onMark} disabled={!canMark} ariaKeyShortcuts="M" testId="mark-button">
        Mark <Kbd>M</Kbd>
      </Button>
      {primary ? (
        <Button
          onClick={primary.onClick}
          disabled={primary.disabled}
          tone={primary.tone ?? "primary"}
          ariaKeyShortcuts="Space"
          testId="primary-action"
        >
          {primary.label} <Kbd>Space</Kbd>
        </Button>
      ) : null}
      {end ? (
        <Button onClick={end.onClick} disabled={end.disabled} tone="danger" testId="end-session">
          {end.label}
        </Button>
      ) : null}
    </>
  );
}
