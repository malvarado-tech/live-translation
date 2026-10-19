"use client";

import Link from "next/link";
import { use, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { buttonClass, Segmented, toggleClass } from "@/components/ui/controls";
import { slugify, type LiveLanguage } from "@/lib/event-rooms";
import {
  LISTENER_STRINGS,
  uiLangForBrowser,
  type ListenerLang,
  type ListenerStrings,
} from "@/lib/listener-strings";
import { useListenerView, useTheme, useUiLang } from "@/lib/prefs";

const POLL_INTERVAL_MS = 15_000;

type PickerLanguage = LiveLanguage & {
  status?: {
    state?: string | null;
    mode?: string | null;
    listeners?: number;
  };
};

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; languages: PickerLanguage[] }
  | { kind: "error"; languages: PickerLanguage[] };

type EventLanguagesResponse = {
  languages?: PickerLanguage[];
  title?: string | null;
  error?: string;
};

const noop = () => () => {};

function useBrowserLang(): ListenerLang {
  return useSyncExternalStore(
    noop,
    () => uiLangForBrowser(navigator.languages ?? [navigator.language]),
    () => "en",
  );
}

function stateOf(lang: PickerLanguage, t: ListenerStrings): { text: string; live: boolean } {
  const s = lang.status?.state;
  if (lang.status?.mode === "original" && (s === "live" || !s)) {
    return { text: t.channelStates.live, live: true };
  }
  switch (s) {
    case "paused":
      return { text: t.channelStates.paused, live: false };
    case "waiting":
      return { text: t.channelStates.waiting, live: false };
    case "reconnecting":
    case "interrupted":
      return { text: t.channelStates.reconnecting, live: false };
    default:
      return { text: t.channelStates.live, live: true };
  }
}

export default function EventPage({
  params,
}: {
  params: Promise<{ event: string }>;
}) {
  const { event: rawEvent } = use(params);
  const event = slugify(decodeURIComponent(rawEvent));

  const browserLang = useBrowserLang();
  const [uiLang, setUiLang] = useUiLang(browserLang);
  const t = LISTENER_STRINGS[uiLang];
  const other = LISTENER_STRINGS[uiLang === "es" ? "en" : "es"];
  const [view, setView] = useListenerView();
  const [theme, setTheme] = useTheme();

  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [title, setTitle] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const lastLanguages = useRef<PickerLanguage[]>([]);

  useEffect(() => {
    document.documentElement.lang = uiLang;
  }, [uiLang]);

  const load = useCallback(async () => {
    if (!event) {
      setState({ kind: "ready", languages: [] });
      return;
    }
    setRefreshing(true);
    try {
      const resp = await fetch(
        `/api/event-languages?event=${encodeURIComponent(event)}`,
        { cache: "no-store" },
      );
      const data = (await resp.json().catch(() => ({}))) as EventLanguagesResponse;
      if (!resp.ok) throw new Error("lookup failed");
      const languages = Array.isArray(data.languages) ? data.languages : [];
      lastLanguages.current = languages;
      if (typeof data.title === "string" && data.title) setTitle(data.title);
      setState({ kind: "ready", languages });
    } catch {
      // The listener never sees server messages; the last list stays.
      setState({ kind: "error", languages: lastLanguages.current });
    } finally {
      setRefreshing(false);
    }
  }, [event]);

  useEffect(() => {
    // Initial load plus polling, so languages opened later show up without
    // a reload. Polling pauses while the tab is hidden.
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer === null) timer = setInterval(() => void load(), POLL_INTERVAL_MS);
    };
    const stop = () => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void load();
        start();
      } else {
        stop();
      }
    };
    const first = setTimeout(() => void load(), 0);
    start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearTimeout(first);
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [load]);

  const languages = state.kind === "loading" ? [] : state.languages;

  return (
    <div
      className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-5 px-4 pb-[max(16px,env(safe-area-inset-bottom))] pt-4"
      data-testid="picker"
      data-view={view}
      lang={uiLang}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {title ? <p className="text-[15px] text-silk">{t.liveTranslation}</p> : null}
          <p className="text-2xl font-semibold leading-tight text-ink [overflow-wrap:anywhere]">
            {title ?? t.liveTranslation}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setUiLang(uiLang === "es" ? "en" : "es")}
          lang={uiLang === "es" ? "en" : "es"}
          aria-label={uiLang === "es" ? "Interface in English" : "Interfaz en español"}
          title={t.interfaceLanguage}
          data-testid="ui-lang-toggle"
          className={`${buttonClass("ghost", "sm")} min-w-12 shrink-0 font-cond text-base tracking-wide`}
        >
          {uiLang === "es" ? "EN" : "ES"}
        </button>
      </header>

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

      <div>
        <h1 className="text-[34px] font-bold leading-tight text-ink">{t.languageSelection}</h1>
        <p className="text-lg text-silk" lang={uiLang === "es" ? "en" : "es"}>
          {other.languageSelection}
        </p>
      </div>

      <p role="status" aria-live="polite" className="sr-only">
        {state.kind === "loading"
          ? t.checking
          : languages.length === 0
            ? t.noLiveLanguages
            : languages.map((l) => l.label).join(", ")}
      </p>

      {state.kind === "error" ? (
        <div
          role="alert"
          data-testid="languages-error"
          className="rounded-md border border-amber bg-amber-wash px-4 py-3 text-base text-ink"
        >
          {t.pickerError}
        </div>
      ) : null}

      {state.kind === "loading" ? (
        <p className="text-lg text-silk" data-testid="languages-loading">
          {t.checking}
        </p>
      ) : languages.length > 0 ? (
        <ul className="flex flex-col gap-3" data-testid="language-list">
          {languages.map((lang, i) => {
            const st = stateOf(lang, t);
            const href = `/listen/${encodeURIComponent(lang.room)}?event=${encodeURIComponent(event)}`;
            return (
              <li key={lang.code}>
                {view === "receiver" ? (
                  <Link
                    href={href}
                    className="grid min-h-24 grid-cols-[28px_84px_1fr] items-center gap-2 rounded-lg border border-line bg-panel px-4 transition hover:bg-panel-2"
                  >
                    <span className="font-cond text-2xl text-silk" aria-hidden>
                      {i + 1}
                    </span>
                    <span className="font-cond text-5xl font-bold text-ink" aria-hidden>
                      {lang.code.toUpperCase()}
                    </span>
                    <span className="flex min-w-0 flex-col">
                      <span className="text-xl font-semibold text-ink" lang={lang.code}>
                        {lang.label}
                      </span>
                      <span className="flex items-center gap-2 text-lg text-silk">
                        <span aria-hidden className={`h-3 w-3 rounded-full ${st.live ? "bg-onair" : "bg-dim"}`} />
                        {st.text}
                      </span>
                    </span>
                  </Link>
                ) : (
                  <Link
                    href={href}
                    className="flex min-h-20 items-center gap-3 rounded-2xl border border-line bg-panel px-4 transition hover:bg-panel-2"
                  >
                    <span className="rounded-full bg-primary px-2.5 py-0.5 font-cond text-lg font-bold text-on-primary" aria-hidden>
                      {lang.code.toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-2xl font-bold text-ink" lang={lang.code}>
                      {lang.label}
                    </span>
                    <span className="flex shrink-0 items-center gap-2 text-lg text-ink">
                      <span aria-hidden className={`h-3 w-3 rounded-full ${st.live ? "bg-green" : "bg-dim"}`} />
                      {st.text}
                    </span>
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <div
          className="flex flex-col gap-1 rounded-lg border border-dashed border-line-strong px-4 py-5"
          data-testid="no-live-languages"
        >
          <p className="text-xl font-semibold text-ink">{t.noLiveLanguages}</p>
          <p className="text-base text-silk">{t.noLiveLanguagesDetail}</p>
        </div>
      )}

      <div className="mt-auto flex flex-col gap-3">
        <p className="rounded-lg border border-line bg-panel px-4 py-3 text-base text-silk">
          {t.headphones}
        </p>
        <button
          type="button"
          onClick={() => void load()}
          disabled={refreshing}
          className={`${buttonClass("default", "lg")} w-full`}
        >
          {refreshing ? t.refreshing : t.refresh}
        </button>
      </div>
    </div>
  );
}
