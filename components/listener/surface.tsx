"use client";

/**
 * Listener surface shared by the live listener page and the replay page.
 *
 * Always on screen: the event title, the current language (the button that
 * changes it), the captions, one status line and Mute (or Listen). View,
 * theme, text size, interface language and stopping the audio sit behind
 * one Options control.
 *
 * Two views over one model:
 *  - Captions (default): a caption stage.
 *  - Receiver: a channel card with the large language code and the level
 *    meter, and the caption lines under it, like an interpretation receiver.
 *
 * In both views the captions keep the whole session: the newest line stays
 * in view until the listener scrolls back, and "Back to latest" returns.
 */
import Link from "next/link";
import { memo, useCallback, useState, type ReactNode } from "react";
import { ListenerOptions } from "@/components/listener/options";
import { buttonClass, HMeter } from "@/components/ui/controls";
import { FOLLOW_FADE, LatestButton, useFollowScroll } from "@/components/ui/follow-scroll";
import { Sheet } from "@/components/ui/sheet";
import type { CaptionLine } from "@/lib/captions";
import type { ListenerTone } from "@/lib/listener-health";
import type {
  ListenerLang,
  ListenerStatusKey,
  ListenerStrings,
} from "@/lib/listener-strings";
import { useListenerView, useTextSize, type TextSize } from "@/lib/prefs";

export type ListenerChannel = {
  code: string;
  label: string;
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
  channel: { code: string; label: string; lang: string };
  status: ListenerStatusKey;
  tone: ListenerTone;
  /** Extra text on the status line, e.g. "Attempt 2 of 5". */
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
  /** Credits or other notes at the bottom. */
  footer?: ReactNode;
  /** A notice above the controls, e.g. blocked autoplay. */
  notice?: string | null;
  /** A short standing label under the title, e.g. what a replay is. */
  badge?: string | null;
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

/** Captions are current only while audio is flowing. */
function staleCaptions(status: ListenerStatusKey) {
  return (
    status !== "live" &&
    status !== "idle" &&
    status !== "replay-playing" &&
    status !== "replay-paused" &&
    status !== "replay-loading"
  );
}

export function ListenerSurface(props: ListenerSurfaceProps) {
  const [view] = useListenerView();
  const [size] = useTextSize();

  return (
    <div
      className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-4 px-4 pb-[max(16px,env(safe-area-inset-bottom))] pt-3"
      data-testid="listener-surface"
      data-view={view}
      lang={props.uiLang}
    >
      <header className="flex flex-col gap-0.5">
        <h1 className="truncate text-xl font-semibold leading-tight text-ink" title={props.title}>
          {props.title}
        </h1>
        {props.badge ? (
          <p className="text-sm text-silk" data-testid="listener-badge">
            {props.badge}
          </p>
        ) : null}
      </header>

      {view === "receiver" ? (
        <ReceiverBody {...props} size={size} />
      ) : (
        <CaptionsBody {...props} size={size} />
      )}

      <StatusLine {...props} />
      <StatusAnnouncer {...props} />

      {props.notice ? (
        <p className="rounded-md border border-amber bg-amber-wash px-3 py-2 text-[15px] text-ink">
          {props.notice}
        </p>
      ) : null}

      {props.transport}

      <ThumbBar {...props} />

      {props.footer}
    </div>
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

/** The one visible status line: what the audio is doing right now. */
function StatusLine({ t, status, tone, statusDetail }: ListenerSurfaceProps) {
  const text = status === "live" ? t.status.live.tally : t.status[status].line;
  const box =
    tone === "warn"
      ? "rounded-md border border-amber bg-amber-wash px-3 py-2"
      : tone === "error"
        ? "rounded-md border border-error-ink bg-error-wash px-3 py-2"
        : "";
  return (
    <p className={`flex items-start gap-2.5 text-lg ${box}`} data-testid="listener-status-line">
      <span className={`mt-[0.45em] h-3 w-3 shrink-0 rounded-full ${DOT_CLASS[tone]}`} />
      <span className="min-w-0">
        <span
          className={`font-semibold ${tone === "error" ? "text-error-ink" : "text-ink"}`}
          data-testid="listener-tally"
          data-tone={tone}
        >
          {text}
        </span>
        {statusDetail ? <span className="text-silk"> {statusDetail}</span> : null}
      </span>
    </p>
  );
}

/* --------------------------------------------------------------- language */

function Chevron() {
  return (
    <svg aria-hidden width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 6l4 4 4-4" />
    </svg>
  );
}

/**
 * The current language. When the event has other languages it is the
 * button that changes it; on a direct link it is a plain label.
 */
function LanguageControl({
  props,
  large = false,
}: {
  props: ListenerSurfaceProps;
  large?: boolean;
}) {
  const { t, channel } = props;
  const [open, setOpen] = useState(false);
  const canSwitch = props.channels.length > 1 || Boolean(props.changeLanguageHref);

  const inner = large ? (
    <>
      <span className="font-cond text-[76px] font-bold leading-[0.85] tracking-tight text-ink" aria-hidden>
        {channel.code.toUpperCase()}
      </span>
      <span className="min-w-0 flex-1 pb-1">
        <span className="block truncate text-xl font-semibold text-ink" lang={channel.lang}>
          {channel.label}
        </span>
        {canSwitch ? (
          <span className="mt-0.5 flex items-center gap-1 text-[15px] text-silk">
            {t.changeLanguage} <Chevron />
          </span>
        ) : null}
      </span>
    </>
  ) : (
    <>
      <span className="min-w-0 flex-1 truncate text-lg font-semibold text-ink" lang={channel.lang}>
        {channel.label}
      </span>
      {canSwitch ? (
        <span className="text-silk">
          <Chevron />
        </span>
      ) : null}
    </>
  );

  const cls = large
    ? "-m-2 flex min-h-14 min-w-0 items-end gap-4 rounded-md p-2 text-left"
    : "flex min-h-14 w-full min-w-0 items-center gap-3 rounded-md border border-line bg-panel px-4 text-left";

  if (!canSwitch) {
    return (
      <div className={cls} data-testid="language-current">
        {inner}
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${channel.label}. ${t.changeLanguage}`}
        data-testid="language-button"
        className={`${cls} hover:bg-panel-2`}
      >
        {inner}
      </button>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={t.changeLanguage}
        closeLabel={t.close}
        testId="language-sheet"
        lang={props.uiLang}
      >
        <ul className="flex flex-col gap-2">
          {props.channels.map((c) => (
            <li key={c.code}>
              <ChannelItem channel={c} onPicked={() => setOpen(false)} />
            </li>
          ))}
        </ul>
        {props.changeLanguageHref ? (
          <Link
            href={props.changeLanguageHref}
            className="flex min-h-11 items-center font-semibold text-ink underline underline-offset-4"
          >
            {t.languageSelection}
          </Link>
        ) : null}
      </Sheet>
    </>
  );
}

function ChannelItem({ channel: c, onPicked }: { channel: ListenerChannel; onPicked: () => void }) {
  const cls = `flex min-h-14 w-full items-center gap-3 rounded-md border px-4 text-left ${
    c.active ? "border-green bg-panel-2" : "border-line bg-panel hover:bg-panel-2"
  }`;
  const inner = (
    <>
      <span className="min-w-0 flex-1 truncate text-lg font-semibold text-ink" lang={c.lang}>
        {c.label}
      </span>
      {c.stateLabel ? <span className="shrink-0 text-[15px] text-silk">{c.stateLabel}</span> : null}
      {c.active ? <span aria-hidden className="h-3 w-3 shrink-0 rounded-full bg-green" /> : null}
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
      onClick={() => {
        onPicked();
        if (!c.active) c.onSelect?.();
      }}
      aria-current={c.active ? "true" : undefined}
      className={cls}
      data-testid={`channel-${c.code}`}
    >
      {inner}
    </button>
  );
}

/* ------------------------------------------------------------------ views */

function ReceiverBody(props: ListenerSurfaceProps & { size: TextSize }) {
  const { t, status, tone, level, lines, size } = props;
  const sz = SIZES[size];
  const stale = staleCaptions(status);
  return (
    <>
      <section
        aria-label={props.channel.label}
        className="flex flex-col gap-4 rounded-lg border border-line bg-panel p-4"
        data-testid="receiver-card"
      >
        <LanguageControl props={props} large />
        <div>
          <HMeter level={signalTone(tone) ? level : null} label={t.audioLevel} testId="listener-meter" />
          <div className="mt-2 flex justify-between gap-2 text-[15px] text-silk">
            <span>{t.audioLevel}</span>
            {!signalTone(tone) ? (
              <span>{t.noSignal}</span>
            ) : props.delaySeconds != null ? (
              <span className="tabular">{t.delay(props.delaySeconds.toFixed(1))}</span>
            ) : null}
          </div>
        </div>
      </section>

      <CaptionStack t={t} lang={props.channel.lang} testId="caption-tail" gap="gap-2">
        {!props.captionsAvailable ? (
          <p className="text-base text-silk">{t.noCaptions}</p>
        ) : lines.length === 0 ? (
          status === "live" || status === "replay-playing" ? (
            <p className="text-base text-silk">{t.captionsPending}</p>
          ) : null
        ) : (
          lines.map((line, i) => {
            const current = i === lines.length - 1;
            return (
              <CaptionLineText
                key={line.id}
                text={line.text}
                role={current ? (stale ? "stale" : "current") : "old"}
                size={current ? sz.rCur : sz.rOld}
              />
            );
          })
        )}
      </CaptionStack>
    </>
  );
}

function CaptionsBody(props: ListenerSurfaceProps & { size: TextSize }) {
  const { t, status, lines, size } = props;
  const sz = SIZES[size];
  const stale = staleCaptions(status);

  return (
    <>
      <LanguageControl props={props} />
      <CaptionStack t={t} lang={props.channel.lang} testId="caption-stage" gap="gap-3">
        {!props.captionsAvailable ? (
          <p className="text-lg text-silk">{t.noCaptions}</p>
        ) : lines.length === 0 ? (
          <p className="text-lg text-silk">{t.captionsPending}</p>
        ) : (
          lines.map((line, i) => {
            const current = i === lines.length - 1;
            return (
              <CaptionLineText
                key={line.id}
                text={line.text}
                role={current ? (stale ? "stale" : "current") : "old"}
                size={current ? sz.cur : sz.old}
              />
            );
          })
        )}
      </CaptionStack>
    </>
  );
}

/** One caption line; memoised so a long history re-renders only what changed. */
const CaptionLineText = memo(function CaptionLineText({
  text,
  role,
  size,
}: {
  text: string;
  role: "current" | "stale" | "old";
  size: number;
}) {
  return (
    <p
      className={role === "current" ? "font-bold text-ink" : role === "stale" ? "font-bold text-silk" : "text-dim"}
      style={{ fontSize: size, lineHeight: 1.3 }}
    >
      {text}
    </p>
  );
});

/**
 * Caption lines stacked from the top, right under the language control.
 * The stack takes the free height between that control and the status
 * line; while the lines fit they keep their place at the top. Once they
 * overflow, the box follows the newest line and older lines move up under
 * a fade. Scrolling up reads back through the session; the box then stays
 * put and "Back to latest" returns to the newest line.
 */
const FADE_PX = 40;
const MIN_STACK_PX = 112;

function CaptionStack({
  t,
  lang,
  testId,
  gap,
  children,
}: {
  t: ListenerStrings;
  lang: string;
  testId: string;
  gap: string;
  children: ReactNode;
}) {
  // The box never gets shorter than the newest line plus the fade above it,
  // so on a short screen the page scrolls before that line is cut.
  const [minHeight, setMinHeight] = useState<number | undefined>(undefined);
  const onMeasure = useCallback((content: HTMLElement) => {
    const newest = content.lastElementChild as HTMLElement | null;
    setMinHeight(newest ? Math.max(MIN_STACK_PX, newest.offsetHeight + FADE_PX) : undefined);
  }, []);
  const { scrollRef, contentRef, following, overflow, resume } = useFollowScroll(onMeasure);

  return (
    <div
      className="relative min-h-28 flex-1 basis-0 font-caption"
      style={{ minHeight }}
      lang={lang}
      data-testid={testId}
      data-overflow={overflow ? "true" : "false"}
      data-following={following ? "true" : "false"}
    >
      <div
        ref={scrollRef}
        role="log"
        aria-live="off"
        aria-label={t.captionHistory}
        tabIndex={0}
        data-testid="caption-scroll"
        className={`absolute inset-0 overflow-y-auto overscroll-contain [scrollbar-width:thin] ${
          overflow && following ? FOLLOW_FADE : ""
        }`}
      >
        <div ref={contentRef} className={`flex flex-col ${gap}`}>
          {children}
        </div>
      </div>
      <LatestButton visible={!following} label={t.backToLatest} onClick={resume} testId="caption-latest" />
    </div>
  );
}

function ThumbBar({ t, primary, uiLang, onUiLang, onLeave }: ListenerSurfaceProps) {
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
      <ListenerOptions t={t} uiLang={uiLang} onUiLang={onUiLang} onStop={onLeave} />
    </div>
  );
}
