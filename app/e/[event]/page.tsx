"use client";

import Link from "next/link";
import { use, useCallback, useEffect, useRef, useState } from "react";
import { slugify, type LiveLanguage } from "@/lib/event-rooms";

const POLL_INTERVAL_MS = 15_000;

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; languages: LiveLanguage[] }
  | { kind: "error"; message: string; languages: LiveLanguage[] };

type EventLanguagesResponse = {
  languages?: LiveLanguage[];
  error?: string;
};

export default function EventPage({
  params,
}: {
  params: Promise<{ event: string }>;
}) {
  const { event: rawEvent } = use(params);
  const event = slugify(decodeURIComponent(rawEvent));

  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [refreshing, setRefreshing] = useState(false);
  const lastLanguages = useRef<LiveLanguage[]>([]);

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
      if (!resp.ok) {
        throw new Error(data.error ?? "Could not load the languages.");
      }
      const languages = Array.isArray(data.languages) ? data.languages : [];
      lastLanguages.current = languages;
      setState({ kind: "ready", languages });
    } catch (err) {
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
        languages: lastLanguages.current,
      });
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
    // First load on the next tick, through the same path as the timer.
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
    <div className="flex flex-1 flex-col items-center justify-center bg-zinc-50 px-6 py-10 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <main className="flex w-full max-w-md flex-col gap-6 rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <header className="flex flex-col gap-1 text-center">
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-emerald-700 dark:text-emerald-400">
            Listener
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">
            Choose a language
          </h1>
          <p className="font-mono text-xs text-zinc-500 dark:text-zinc-400">
            event: {event || "unknown"}
          </p>
        </header>

        {state.kind === "error" ? (
          <div
            role="alert"
            data-testid="languages-error"
            className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-200"
          >
            {state.message}
          </div>
        ) : null}

        {state.kind === "loading" ? (
          <p
            className="text-center text-sm text-zinc-500 dark:text-zinc-400"
            data-testid="languages-loading"
          >
            Checking which languages are live…
          </p>
        ) : languages.length > 0 ? (
          <ul className="flex flex-col gap-3" data-testid="language-list">
            {languages.map((lang) => (
              <li key={lang.code}>
                <Link
                  href={`/listen/${encodeURIComponent(lang.room)}?event=${encodeURIComponent(event)}`}
                  className="flex h-14 w-full items-center justify-between rounded-xl border border-zinc-200 bg-white px-5 text-base font-semibold shadow-sm transition hover:border-emerald-500 hover:bg-emerald-50 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-emerald-950 dark:focus:ring-offset-zinc-900"
                >
                  <span lang={lang.code}>{lang.label}</span>
                  <span className="flex items-center gap-2 text-xs font-medium text-zinc-500 dark:text-zinc-400">
                    <span
                      className="inline-block h-2 w-2 rounded-full bg-emerald-500"
                      aria-hidden
                    />
                    Live · {lang.code}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <div
            className="flex flex-col gap-1 rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-5 text-center dark:border-zinc-800 dark:bg-zinc-950"
            data-testid="no-live-languages"
          >
            <p className="text-sm font-medium">No live languages right now.</p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Languages appear here as soon as they go live. This page checks
              again every 15 seconds.
            </p>
          </div>
        )}

        <button
          type="button"
          onClick={() => void load()}
          disabled={refreshing}
          className="flex h-11 w-full items-center justify-center rounded-xl bg-zinc-200 text-sm font-medium text-zinc-900 transition hover:bg-zinc-300 disabled:opacity-60 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700"
        >
          {refreshing ? "Checking…" : "Refresh"}
        </button>

        <p className="text-center text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
          Pick a language, then tap Listen. You can come back here to switch
          languages at any time.
        </p>
      </main>
    </div>
  );
}
