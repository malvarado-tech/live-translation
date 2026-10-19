"use client";

/**
 * Listener surface shared by the live listener page and the replay page.
 * Two views over one model:
 *  - Receiver: a channel card (large code, live light, level meter), the
 *    last two caption lines and channel buttons, like an interpretation
 *    receiver.
 *  - Captions: a caption stage, the channel code on the language button and
 *    a small level indicator.
 * Both keep the main controls in the bottom thumb zone (56 px and up).
 */
import Link from "next/link";
import { useId, useState, type ReactNode } from "react";
import { buttonClass, HMeter, Segmented, toggleClass } from "@/components/ui/controls";
import type { CaptionLine } from "@/lib/captions";
import type { ListenerTone } from "@/lib/listener-health";
import type {
  ListenerLang,
  ListenerStatusKey,
  ListenerStrings,
} from "@/lib/listener-strings";
import {
  useListenerView,
  useTextSize,
  useTheme,
  type TextSize,
} from "@/lib/prefs";

export type ListenerChannel = {
  code: string;
  label: string;
  number: number;
  active: boolean;
  /** Link to the channel (live) or a callback (replay). */
  href?: string;
  onSelect?: () => void;
  stateLabel?: string;
  lang?: string;
};

export type PrimaryAction =
  | { kind: "listen"; onClick: () => void; busy?: boolean }
  | { kind: "mute"; muted: boolean; onToggle: () => void };

export type ListenerSurfaceProps = {
  t: ListenerStrings;
  uiLang: ListenerLang;
  onUiLang: (l: ListenerLang) => void;
  title: string;
  subtitle?: string | null;
  channel: { code: string; label: string; number: number | null; lang: string };
  status: ListenerStatusKey;
  tone: ListenerTone;
  /** Extra line under the status, e.g. "Attempt 2 of 5". */
  statusDetail?: string | null;
  level: number | null;
  delaySeconds?: number | null;
  lines: CaptionLine[];
  /** Captions exist for this channel (original audio has none). */
  captionsAvailable: boolean;
  channels: ListenerChannel[];
  primary: PrimaryAction;
  onLeave?: (() => void) | null;
  changeLanguageHref?: string | null;
  /** Replay transport (play/pause, scrub). */
  transport?: ReactNode;
  /** Attribution or other notes under the controls. */
  footer?: ReactNode;
  /** A notice above the controls, e.g. blocked autoplay. */
  notice?: string | null;
  /** A standing label under the header, e.g. what a replay is. */
  badge?: string | null;
};

const TALLY_CLASS: Record<ListenerTone, string> = {
  live: "bg-onair text-on-onair border-onair",
  warn: "hatch border-amber",
  standby: "border-dashed border-line-strong text-silk",
  off: "border-line-strong text-silk",
  error: "bg-error-wash text-error-ink border-error-ink",
  replay: "bg-primary text-on-primary border-primary",
};

const DOT_CLASS: Record<ListenerTone, string> = {
  live: "bg-onair",
  warn: "bg-amber",
  standby: "bg-dim",
  off: "bg-dim",
  error: "bg-error-ink",
  replay: "bg-green",
};

/** The incoming level is worth showing (live audio or a recording playing). */
function signalTone(tone: ListenerTone): boolean {
  return tone === "live" || tone === "replay";
}

const SIZES: Record<TextSize, { old: number; cur: number; rOld: number; rCur: number }> = {
  m: { old: 22, cur: 28, rOld: 18, rCur: 23 },
  l: { old: 26, cur: 34, rOld: 21, rCur: 27 },
  xl: { old: 31, cur: 41, rOld: 25, rCur: 32 },
};

const NEXT_SIZE: Record<TextSize, TextSize> = { m: "l", l: "xl", xl: "m" };

export function ListenerSurface(props: ListenerSurfaceProps) {
  const [view, setView] = useListenerView();
  const [theme, setTheme] = useTheme();
  const [size, setSize] = useTextSize();
  const { t } = props;

  return (
    <div
      className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-4 px-4 pb-[max(16px,env(safe-area-inset-bottom))] pt-4"
      data-testid="listener-surface"
      data-view={view}
      lang={props.uiLang}
    >
      <ListenerHeader {...props} />
      {props.badge ? (
        <p className="rounded-md border border-line-strong px-3 py-2 text-[15px] font-medium text-ink" data-testid="listener-badge">
          {props.badge}
        </p>
      ) : null}
      <div className="flex items-center gap-2">
        <Segmented
          label={t.view}
          value={view}
          onChange={setView}
          options={[
            { value: "receiver", label: t.views.receiver },
            { value: "captions", label: t.views.captions },
          ]}
          testId="listener-view-switch"
          stretch
          className="flex-1"
        />
        <button
          type="button"
          onClick={() => setTheme(theme === "night" ? "light" : "night")}
          aria-pressed={theme === "night"}
          data-testid="theme-toggle"
          className={`inline-flex min-h-11 shrink-0 items-center rounded-md border px-3 text-sm font-semibold ${toggleClass(theme === "night")}`}
        >
          {t.themes.night}
        </button>
      </div>

      {view === "receiver" ? (
        <ReceiverBody {...props} size={size} />
      ) : (
        <CaptionsBody {...props} size={size} />
      )}

      <StatusAnnouncer {...props} />

      {props.notice ? (
        <p className="rounded-md border border-amber bg-amber-wash px-3 py-2 text-[15px] text-ink">
          {props.notice}
        </p>
      ) : null}

      {props.transport}

      <ThumbBar
        {...props}
        size={size}
        onSize={() => setSize(NEXT_SIZE[size])}
      />

      {props.footer}
    </div>
  );
}

function ListenerHeader({ t, uiLang, onUiLang, title, subtitle }: ListenerSurfaceProps) {
  const other: ListenerLang = uiLang === "es" ? "en" : "es";
  return (
    <header className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold leading-tight text-ink [overflow-wrap:anywhere]">
          {title}
        </h1>
        {subtitle ? (
          <p className="mt-0.5 text-[15px] text-silk">{subtitle}</p>
        ) : null}
      </div>
      <button
        type="button"
        onClick={() => onUiLang(other)}
        lang={other}
        aria-label={other === "en" ? "Interface in English" : "Interfaz en español"}
        title={t.interfaceLanguage}
        data-testid="ui-lang-toggle"
        className={`${buttonClass("ghost", "sm")} min-w-12 shrink-0 font-cond text-base tracking-wide`}
      >
        {other === "en" ? "EN" : "ES"}
      </button>
    </header>
  );
}

function StatusAnnouncer({ t, status, statusDetail }: ListenerSurfaceProps) {
  // One polite live region for every status change, in both views.
  return (
    <p role="status" aria-live="polite" className="sr-only" data-testid="listener-status-live">
      {t.status[status].line}
      {statusDetail ? ` ${statusDetail}` : ""}
    </p>
  );
}

function delayText(t: ListenerStrings, s: number | null | undefined, tone: ListenerTone) {
  if (!signalTone(tone)) return t.noSignal;
  if (s == null) return "";
  return t.delay(s.toFixed(1));
}

function showsStatusMessage(status: ListenerStatusKey) {
  return (
    status !== "live" &&
    status !== "idle" &&
    status !== "replay-playing" &&
    status !== "replay-paused" &&
    status !== "replay-loading"
  );
}

function ReceiverBody(props: ListenerSurfaceProps & { size: TextSize }) {
  const { t, channel, status, tone, level, lines, size, channels } = props;
  const sz = SIZES[size];
  const tail = lines.slice(-2);
  return (
    <>
      <section
        aria-label={`${t.channel} ${channel.number ?? ""} ${channel.label}`}
        className="rounded-lg border border-line bg-panel p-5"
        data-testid="receiver-card"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            {channel.number !== null ? (
              <p className="font-cond text-lg font-semibold text-silk">
                {t.channel} {channel.number}
              </p>
            ) : null}
            <p
              className="font-cond text-[88px] font-bold leading-[0.85] tracking-tight text-ink"
              aria-hidden
            >
              {channel.code.toUpperCase()}
            </p>
          </div>
          <span
            data-testid="listener-tally"
            data-tone={tone}
            className={`inline-flex min-h-11 items-center rounded-md border px-3 font-cond text-xl font-bold tracking-[0.04em] ${TALLY_CLASS[tone]}`}
          >
            {t.status[status].tally}
          </span>
        </div>
        <p className="mt-3 text-lg text-silk" lang={channel.lang}>
          {channel.label}
        </p>
        <div className="mt-5">
          <HMeter level={signalTone(tone) ? level : null} label={t.audioLevel} testId="listener-meter" />
          <div className="mt-2 flex justify-between gap-2 text-[15px] text-silk">
            <span>{t.audioLevel}</span>
            <span className="tabular">{delayText(t, props.delaySeconds, tone)}</span>
          </div>
        </div>
      </section>

      {showsStatusMessage(status) ? (
        <div data-testid="listener-status-message">
          <p className="text-[22px] font-semibold leading-snug text-ink">
            {t.status[status].line}
          </p>
          {props.statusDetail ? (
            <p className="mt-1 text-base text-silk">{props.statusDetail}</p>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-1 flex-col justify-end gap-2 font-caption" lang={channel.lang} data-testid="caption-tail">
        {!props.captionsAvailable ? (
          <p className="text-base text-silk">{t.noCaptions}</p>
        ) : tail.length === 0 ? (
          status === "live" || status === "replay-playing" ? (
            <p className="text-base text-silk">{t.captionsPending}</p>
          ) : null
        ) : (
          tail.map((line, i) => {
            const current = i === tail.length - 1;
            return (
              <p
                key={line.id}
                className={current ? "font-bold text-ink" : "text-dim"}
                style={{
                  fontSize: current ? sz.rCur : sz.rOld,
                  lineHeight: 1.3,
                }}
              >
                {line.text}
              </p>
            );
          })
        )}
      </div>

      {channels.length > 1 ? (
        <nav aria-label={t.changeLanguage} className="grid grid-cols-3 gap-2" data-testid="channel-buttons">
          {channels.map((c) => (
            <ChannelButton key={c.code} channel={c} />
          ))}
        </nav>
      ) : props.changeLanguageHref ? (
        <Link href={props.changeLanguageHref} className={buttonClass("ghost", "md")}>
          {t.changeLanguage}
        </Link>
      ) : null}
    </>
  );
}

function ChannelButton({ channel: c }: { channel: ListenerChannel }) {
  const cls = `flex min-h-14 items-center justify-center gap-2 rounded-md border px-2 transition ${
    c.active
      ? "border-green bg-panel-2 ring-1 ring-green"
      : "border-line bg-panel hover:bg-panel-2"
  }`;
  const inner = (
    <>
      <span
        aria-hidden
        className={`h-2.5 w-2.5 rounded-full ${c.active ? "bg-green" : "bg-dim"}`}
      />
      <span className="font-cond text-lg text-silk" aria-hidden>
        {c.number}
      </span>
      <span className="font-cond text-2xl font-bold text-ink" aria-hidden>
        {c.code.toUpperCase()}
      </span>
      <span className="sr-only" lang={c.lang}>
        {c.label}
      </span>
    </>
  );
  if (c.href && !c.active) {
    return (
      <Link href={c.href} className={cls} data-testid={`channel-${c.code}`}>
        {inner}
      </Link>
    );
  }
  return (
    <button
      type="button"
      onClick={c.active ? undefined : c.onSelect}
      aria-current={c.active ? "true" : undefined}
      className={cls}
      data-testid={`channel-${c.code}`}
    >
      {inner}
    </button>
  );
}

function CaptionsBody(props: ListenerSurfaceProps & { size: TextSize }) {
  const { t, channel, status, tone, level, lines, size } = props;
  const sz = SIZES[size];
  const [open, setOpen] = useState(false);
  const sheetId = useId();
  const visible = lines.slice(-12);
  const canSwitch = props.channels.length > 1 || Boolean(props.changeLanguageHref);
  const silentSince = !showsStatusMessage(status) ? null : t.status[status].line;

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          disabled={!canSwitch}
          aria-expanded={canSwitch ? open : undefined}
          aria-controls={canSwitch ? sheetId : undefined}
          data-testid="language-button"
          className="flex min-h-14 min-w-0 flex-1 items-center gap-3 rounded-full border border-line bg-panel px-3 text-left disabled:cursor-default"
        >
          <span className="rounded-full bg-primary px-2.5 py-0.5 font-cond text-lg font-bold text-on-primary">
            {channel.code.toUpperCase()}
          </span>
          <span className="min-w-0 flex-1 truncate text-lg font-semibold text-ink" lang={channel.lang}>
            {channel.label}
          </span>
          {canSwitch ? (
            <span aria-hidden className="pr-2 text-silk">
              {open ? "▴" : "▾"}
            </span>
          ) : null}
          <span className="sr-only">{t.changeLanguage}</span>
        </button>
      </div>

      {open && canSwitch ? (
        <div id={sheetId} className="flex flex-col gap-2 rounded-lg border border-line bg-panel p-2" data-testid="language-sheet">
          {props.channels.map((c) =>
            c.href && !c.active ? (
              <Link key={c.code} href={c.href} className="flex min-h-14 items-center gap-3 rounded-md px-3 hover:bg-panel-2">
                <span className="font-cond text-xl font-bold">{c.code.toUpperCase()}</span>
                <span lang={c.lang}>{c.label}</span>
                {c.stateLabel ? <span className="ml-auto text-sm text-silk">{c.stateLabel}</span> : null}
              </Link>
            ) : (
              <button
                key={c.code}
                type="button"
                onClick={() => {
                  setOpen(false);
                  if (!c.active) c.onSelect?.();
                }}
                aria-current={c.active ? "true" : undefined}
                className={`flex min-h-14 items-center gap-3 rounded-md px-3 text-left hover:bg-panel-2 ${c.active ? "bg-panel-2" : ""}`}
              >
                <span className="font-cond text-xl font-bold">{c.code.toUpperCase()}</span>
                <span lang={c.lang}>{c.label}</span>
                {c.active ? <span aria-hidden className="ml-auto h-2.5 w-2.5 rounded-full bg-green" /> : null}
              </button>
            ),
          )}
          {props.changeLanguageHref ? (
            <Link href={props.changeLanguageHref} className="flex min-h-12 items-center rounded-md px-3 font-semibold text-ink underline underline-offset-4">
              {t.languageSelection}
            </Link>
          ) : null}
        </div>
      ) : null}

      <div
        className="relative flex min-h-48 flex-1 flex-col justify-end gap-3 overflow-hidden font-caption [mask-image:linear-gradient(to_bottom,transparent,black_18%)]"
        lang={channel.lang}
        data-testid="caption-stage"
      >
        {!props.captionsAvailable ? (
          <p className="text-lg text-silk">{t.noCaptions}</p>
        ) : visible.length === 0 ? (
          <p className="text-lg text-silk">{t.captionsPending}</p>
        ) : (
          visible.map((line, i) => {
            const current = i === visible.length - 1;
            const stale = showsStatusMessage(status);
            return (
              <p
                key={line.id}
                className={current && !stale ? "font-bold text-ink" : current ? "font-bold text-silk" : "text-dim"}
                style={{ fontSize: current ? sz.cur : sz.old, lineHeight: 1.3 }}
              >
                {line.text}
              </p>
            );
          })
        )}
      </div>

      {silentSince ? (
        <div
          className="rounded-lg border border-amber bg-amber-wash px-4 py-3"
          data-testid="listener-status-message"
        >
          <p className="flex items-center gap-2 text-lg font-bold text-amber-ink">
            <span aria-hidden className={`h-3 w-3 rounded-full ${DOT_CLASS[tone]}`} />
            {t.status[status].tally}
          </p>
          <p className="mt-1 text-base text-ink">{silentSince}</p>
          {props.statusDetail ? <p className="mt-1 text-[15px] text-silk">{props.statusDetail}</p> : null}
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <p className="flex items-center gap-2 text-lg">
            <span aria-hidden className={`h-3 w-3 rounded-full ${DOT_CLASS[tone]}`} />
            <span className="font-bold text-ink" data-testid="listener-tally" data-tone={tone}>
              {t.status[status].tally}
            </span>
            {tone === "live" && props.delaySeconds != null ? (
              <span className="tabular text-silk">· {t.delay(props.delaySeconds.toFixed(1)).toLowerCase()}</span>
            ) : null}
          </p>
          <MiniLevel level={signalTone(tone) ? level : null} label={t.audioLevel} />
        </div>
      )}
    </>
  );
}

function MiniLevel({ level, label }: { level: number | null; label: string }) {
  const bars = [0.25, 0.55, 0.85, 0.5, 0.7];
  const l = level ?? 0;
  return (
    <span
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(l * 100)}
      data-testid="listener-meter"
      data-level={level === null ? "none" : l.toFixed(2)}
      className="flex h-8 items-center gap-[3px]"
    >
      {bars.map((b, i) => (
        <i
          key={i}
          className={`block w-[4px] rounded-full ${l > 0.05 ? "bg-meter-green" : "bg-off"}`}
          style={{ height: `${Math.max(6, Math.round(32 * Math.min(1, b * (0.35 + l * 1.3))))}px` }}
        />
      ))}
    </span>
  );
}

function ThumbBar(props: ListenerSurfaceProps & { size: TextSize; onSize: () => void }) {
  const { t, primary, onLeave, size, onSize } = props;
  return (
    <div className="flex gap-2" data-testid="thumb-bar">
      {primary.kind === "listen" ? (
        <button
          type="button"
          onClick={primary.onClick}
          disabled={primary.busy}
          className={`${buttonClass("primary", "xl")} flex-1`}
          data-testid="listen-button"
        >
          {t.listen}
        </button>
      ) : (
        <button
          type="button"
          onClick={primary.onToggle}
          aria-pressed={primary.muted}
          className={`${buttonClass(primary.muted ? "default" : "primary", "xl")} flex-1`}
          data-testid="mute-button"
        >
          {primary.muted ? t.unmute : t.mute}
        </button>
      )}
      <button
        type="button"
        onClick={onSize}
        aria-label={`${t.textSize}: ${t.textSizes[size]}`}
        title={t.textSize}
        className={`${buttonClass("default", "xl")} w-16 shrink-0 px-0`}
        data-testid="text-size-button"
      >
        <span aria-hidden className="font-caption text-xl">Aa</span>
      </button>
      {onLeave ? (
        <button
          type="button"
          onClick={onLeave}
          className={`${buttonClass("ghost", "xl")} shrink-0 px-3 text-base text-silk`}
          data-testid="leave-button"
        >
          {t.leave}
        </button>
      ) : null}
    </div>
  );
}
