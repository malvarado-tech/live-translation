"use client";

import Link from "next/link";
import { use, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ListenerOptions } from "@/components/listener/options";
import { buttonClass } from "@/components/ui/controls";
import { slugify, type LiveLanguage } from "@/lib/event-rooms";
import {
  channelState,
  LISTENER_STRINGS,
  uiLangForBrowser,
  type ListenerLang,
} from "@/lib/listener-strings";
import { useListenerView, useUiLang } from "@/lib/prefs";

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
  const [view] = useListenerView();

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
      className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-5 px-4 pb-[max(16px,env(safe-area-inset-bottom))] pt-3"
      data-testid="picker"
      data-view={view}
      lang={uiLang}
    >
      <h1 className="truncate text-2xl font-semibold leading-tight text-ink" title={title ?? t.liveTranslation}>
        {title ?? t.liveTranslation}
      </h1>

      <h2 className="text-lg text-silk">
        <span className="font-semibold text-ink">{t.languageSelection}</span>
        {" · "}
        <span lang={uiLang === "es" ? "en" : "es"}>{other.languageSelection}</span>
      </h2>

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
          {languages.map((lang) => {
            const st = channelState(lang.status, t);
            const href = `/listen/${encodeURIComponent(lang.room)}?event=${encodeURIComponent(event)}`;
            return (
              <li key={lang.code}>
                <Link
                  href={href}
                  className="flex min-h-20 items-center gap-3 rounded-lg border border-line bg-panel px-4 transition hover:bg-panel-2"
                >
                  <span className="min-w-0 flex-1 truncate text-2xl font-bold text-ink" lang={lang.code}>
                    {lang.label}
                  </span>
                  <span className="flex shrink-0 items-center gap-2 text-lg text-ink">
                    <span aria-hidden className={`h-3 w-3 rounded-full ${st.live ? "bg-onair" : "bg-dim"}`} />
                    {st.text}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <div
          className="flex flex-col gap-3 rounded-lg border border-dashed border-line-strong px-4 py-5"
          data-testid="no-live-languages"
        >
          <div className="flex flex-col gap-1">
            <p className="text-xl font-semibold text-ink">{t.noLiveLanguages}</p>
            <p className="text-base text-silk">{t.noLiveLanguagesDetail}</p>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            disabled={refreshing}
            className={`${buttonClass("default", "lg")} w-full`}
          >
            {refreshing ? t.refreshing : t.refresh}
          </button>
        </div>
      )}

      <div className="mt-auto flex">
        <ListenerOptions t={t} uiLang={uiLang} onUiLang={setUiLang} showTextSize={false} className="flex-1" />
      </div>
    </div>
  );
}
