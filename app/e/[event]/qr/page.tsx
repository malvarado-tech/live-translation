"use client";

/**
 * Full-screen QR page for a projector: the event code, its short URL, the
 * event title and the languages that are live. No controls besides a small
 * link back to the event page; it runs in its own tab or window and keeps
 * the language list current on its own.
 *
 * `?lang=xx` points the code at one language of the event instead of the
 * event page. `?base=` sets the listener base URL when the operator uses
 * one other than the configured default.
 */
import Link from "next/link";
import { QRCodeSVG } from "qrcode.react";
import { use, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { eventRoomName, slugify, type LiveLanguage } from "@/lib/event-rooms";
import { languageLabel, TARGET_LANGUAGES } from "@/lib/languages";
import { channelState, LISTENER_STRINGS } from "@/lib/listener-strings";

const POLL_INTERVAL_MS = 15_000;
const ES = LISTENER_STRINGS.es;
const EN = LISTENER_STRINGS.en;

type QrLanguage = LiveLanguage & {
  status?: { state?: string | null; mode?: string | null; listeners?: number };
};

type Load =
  | { kind: "loading" }
  | { kind: "ready"; configured: boolean; languages: QrLanguage[] };

const noop = () => () => {};

function useOrigin(): string {
  return useSyncExternalStore(noop, () => window.location.origin, () => "");
}

/** An http(s) origin with an optional path, or "" when the value is not one. */
function cleanBase(raw: string | null | undefined): string {
  if (!raw) return "";
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return "";
    return `${u.origin}${u.pathname}`.replace(/\/+$/, "");
  } catch {
    return "";
  }
}

export default function QrPage({
  params,
  searchParams,
}: {
  params: Promise<{ event: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { event: rawEvent } = use(params);
  const sp = use(searchParams);
  const event = slugify(decodeURIComponent(rawEvent));
  const langParam = typeof sp.lang === "string" ? sp.lang : "";
  const lang = TARGET_LANGUAGES.some((l) => l.code === langParam) ? langParam : null;
  const origin = useOrigin();
  const base =
    cleanBase(typeof sp.base === "string" ? sp.base : null) ||
    cleanBase(process.env.NEXT_PUBLIC_LISTENER_BASE_URL) ||
    origin;

  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [title, setTitle] = useState<string | null>(null);
  const last = useRef<Load>({ kind: "loading" });

  const refresh = useCallback(async () => {
    if (!event) {
      setLoad({ kind: "ready", configured: false, languages: [] });
      return;
    }
    try {
      const resp = await fetch(`/api/event-languages?event=${encodeURIComponent(event)}`, { cache: "no-store" });
      const data = (await resp.json().catch(() => ({}))) as {
        configured?: boolean;
        languages?: QrLanguage[];
        title?: string | null;
      };
      if (!resp.ok) throw new Error("lookup failed");
      if (typeof data.title === "string" && data.title) setTitle(data.title);
      const next: Load = {
        kind: "ready",
        configured: data.configured !== false,
        languages: Array.isArray(data.languages) ? data.languages : [],
      };
      last.current = next;
      setLoad(next);
    } catch {
      // A projector shows the last list it had; a failed refresh is not news.
      if (last.current.kind === "loading") setLoad({ kind: "ready", configured: true, languages: [] });
    }
  }, [event]);

  useEffect(() => {
    const first = setTimeout(() => void refresh(), 0);
    const id = setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [refresh]);

  const shownTitle = title ?? `${ES.liveTranslation} · ${EN.liveTranslation}`;
  useEffect(() => {
    document.title = `QR · ${shownTitle}`;
  }, [shownTitle]);

  const target = !base
    ? ""
    : lang
      ? `${base}/listen/${eventRoomName(event, lang)}?event=${encodeURIComponent(event)}`
      : `${base}/e/${event}`;
  const shortUrl = target.replace(/^https?:\/\//, "");
  const languages = load.kind === "ready" ? load.languages : [];

  return (
    <div className="flex min-h-dvh flex-col bg-bg px-4 pb-6 pt-3 sm:px-8" data-testid="qr-page">
      <nav className="flex">
        <Link
          href={`/e/${event}`}
          className="inline-flex min-h-11 items-center text-[15px] font-semibold text-silk underline underline-offset-4"
          data-testid="qr-back"
        >
          <span lang="es">Página del evento</span>
          <span aria-hidden className="px-1.5">·</span>
          <span lang="en">Event page</span>
        </Link>
      </nav>

      <main className="mx-auto grid w-full max-w-[1800px] flex-1 grid-cols-1 items-center gap-8 lg:grid-cols-[auto_minmax(0,1fr)] lg:gap-16">
        <div className="flex justify-center">
          <div className="rounded-lg bg-white p-[clamp(12px,2.5vmin,32px)] shadow-sm" data-testid="qr-code">
            {target ? (
              <QRCodeSVG
                value={target}
                size={720}
                level="M"
                marginSize={2}
                fgColor="#0a0c10"
                bgColor="#ffffff"
                title={shortUrl}
                className="block h-[min(76vh,84vw)] max-h-[860px] w-[min(76vh,84vw)] max-w-[860px]"
              />
            ) : (
              <div className="h-[min(76vh,84vw)] w-[min(76vh,84vw)] max-w-[860px]" aria-hidden />
            )}
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          <div className="flex flex-col gap-2">
            {title ? (
              <p className="text-[clamp(18px,2.2vw,32px)] text-silk">
                <span lang="es">{ES.liveTranslation}</span> · <span lang="en">{EN.liveTranslation}</span>
                {lang ? ` · ${languageLabel(lang)}` : ""}
              </p>
            ) : null}
            <h1
              className="text-[clamp(30px,4.4vw,72px)] font-semibold leading-[1.05] text-ink"
              data-testid="qr-title"
            >
              {shownTitle}
            </h1>
          </div>

          <p
            className="break-all font-cond text-[clamp(30px,4.6vw,80px)] font-bold leading-none text-ink"
            data-testid="qr-url"
          >
            {shortUrl}
          </p>

          <section aria-labelledby="qr-languages-heading" className="flex flex-col gap-3">
            <h2 id="qr-languages-heading" className="text-[clamp(17px,1.8vw,26px)] text-silk">
              <span lang="es">{ES.languageSelection}</span> · <span lang="en">{EN.languageSelection}</span>
            </h2>
            <div aria-live="polite">
              {load.kind === "loading" ? (
                <p className="text-[clamp(17px,1.8vw,26px)] text-silk">
                  <span lang="es">{ES.checking}</span> · <span lang="en">{EN.checking}</span>
                </p>
              ) : languages.length > 0 ? (
                <ul className="flex flex-wrap gap-3" data-testid="qr-languages">
                  {languages.map((l) => {
                    const st = channelState(l.status, l.code === "es" ? ES : EN);
                    return (
                      <li
                        key={l.code}
                        className={`flex items-center gap-3 rounded-md border bg-panel px-4 py-2.5 ${
                          lang === l.code ? "border-primary ring-2 ring-primary" : "border-line"
                        }`}
                      >
                        <span aria-hidden className={`h-3.5 w-3.5 shrink-0 rounded-full ${st.live ? "bg-onair" : "bg-dim"}`} />
                        <span className="text-[clamp(20px,2.2vw,34px)] font-semibold text-ink" lang={l.code}>
                          {l.label}
                        </span>
                        <span className="text-[clamp(15px,1.4vw,22px)] text-silk" lang={l.code === "es" ? "es" : "en"}>
                          {st.text}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <div
                  className="flex flex-col gap-1 rounded-md border border-dashed border-line-strong px-4 py-3"
                  data-testid="qr-empty"
                >
                  <p className="text-[clamp(20px,2.2vw,34px)] font-semibold text-ink">
                    <span lang="es">{ES.noLiveLanguages}</span> · <span lang="en">{EN.noLiveLanguages}</span>
                  </p>
                  <p className="text-[clamp(15px,1.4vw,22px)] text-silk">
                    {load.configured ? (
                      <>
                        <span lang="es">Los idiomas aparecen aquí al iniciar la transmisión.</span>{" "}
                        <span lang="en">Languages appear here when the broadcast starts.</span>
                      </>
                    ) : (
                      <>
                        <span lang="es">Servidor de salas sin configurar.</span>{" "}
                        <span lang="en">Room server not configured.</span>
                      </>
                    )}
                  </p>
                </div>
              )}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
