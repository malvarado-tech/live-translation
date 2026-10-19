"use client";

import {
  Room,
  RoomEvent,
  Track,
  type RemoteAudioTrack,
  type RemoteTrack,
  type RemoteTrackPublication,
} from "livekit-client";
import Link from "next/link";
import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { slugify } from "@/lib/event-rooms";
import { CAPTION_TOPIC, type CaptionMessage } from "@/lib/livekit-publisher";

type ListenerStatus =
  | "idle"
  | "fetching-token"
  | "connecting"
  | "waiting-for-audio"
  | "playing"
  | "ended"
  | "error";

type TokenResponse = {
  token?: string;
  url?: string;
  error?: string;
};

const STATUS_LABEL: Record<ListenerStatus, string> = {
  idle: "Tap Listen to start",
  "fetching-token": "Connecting…",
  connecting: "Joining room…",
  "waiting-for-audio": "Waiting for the speaker…",
  playing: "Live",
  ended: "Session ended",
  error: "Error",
};

const STATUS_DOT_CLASS: Record<ListenerStatus, string> = {
  idle: "bg-zinc-400",
  "fetching-token": "bg-amber-400 animate-pulse",
  connecting: "bg-amber-400 animate-pulse",
  "waiting-for-audio": "bg-amber-400 animate-pulse",
  playing: "bg-emerald-500 animate-pulse",
  ended: "bg-zinc-400",
  error: "bg-rose-500",
};

export default function ListenerPage({
  params,
  searchParams,
}: {
  params: Promise<{ room: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { room } = use(params);
  const { event: eventParam } = use(searchParams);
  // Set when the page was opened from the event page (/e/[event]); enables
  // the "Change language" link back to it. Only honoured when the room
  // belongs to that event.
  const eventSlug = useMemo(() => {
    const slug = slugify(typeof eventParam === "string" ? eventParam : "");
    return slug && room.startsWith(`${slug}-`) ? slug : null;
  }, [eventParam, room]);

  const [status, setStatus] = useState<ListenerStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [captions, setCaptions] = useState("");
  const [showCaptions, setShowCaptions] = useState(true);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const roomRef = useRef<Room | null>(null);
  const captionScrollRef = useRef<HTMLDivElement | null>(null);
  const captionDecoder = useMemo(() => new TextDecoder(), []);

  const prettyRoom = useMemo(() => room, [room]);

  useEffect(() => {
    if (captionScrollRef.current) {
      captionScrollRef.current.scrollTop =
        captionScrollRef.current.scrollHeight;
    }
  }, [captions]);

  const attachTrack = useCallback((track: RemoteTrack) => {
    if (!audioRef.current) return;
    if (track.kind !== Track.Kind.Audio) return;
    (track as RemoteAudioTrack).attach(audioRef.current);
    setStatus("playing");
    setErrorMessage(null);
  }, []);

  const handleStart = useCallback(async () => {
    setErrorMessage(null);
    setStatus("fetching-token");

    try {
      const tokenResp = await fetch(
        `/api/listen-token?room=${encodeURIComponent(room)}`,
      );
      const tokenData = (await tokenResp.json()) as TokenResponse;
      if (!tokenResp.ok || !tokenData.token || !tokenData.url) {
        throw new Error(tokenData.error ?? "Could not get a listener token.");
      }

      const lkRoom = new Room({
        adaptiveStream: true,
        dynacast: false,
      });

      lkRoom
        .on(RoomEvent.TrackSubscribed, (track) => attachTrack(track))
        .on(
          RoomEvent.TrackUnsubscribed,
          (track: RemoteTrack, _pub: RemoteTrackPublication) => {
            try {
              if (track.kind === Track.Kind.Audio && audioRef.current) {
                (track as RemoteAudioTrack).detach(audioRef.current);
              }
            } catch {
              // ignore
            }
            setStatus("waiting-for-audio");
          },
        )
        .on(RoomEvent.DataReceived, (payload, _participant, _kind, topic) => {
          if (topic !== CAPTION_TOPIC) return;
          try {
            const msg = JSON.parse(captionDecoder.decode(payload)) as
              | CaptionMessage
              | undefined;
            if (msg?.kind === "caption" && typeof msg.delta === "string") {
              setCaptions((prev) => prev + msg.delta);
            }
          } catch {
            // Malformed payload — ignore. Captions are best-effort.
          }
        })
        .on(RoomEvent.Disconnected, () => {
          setStatus("ended");
        });

      setStatus("connecting");
      await lkRoom.connect(tokenData.url, tokenData.token, {
        autoSubscribe: true,
      });
      roomRef.current = lkRoom;

      lkRoom.remoteParticipants.forEach((participant) => {
        participant.trackPublications.forEach((pub) => {
          if (pub.isSubscribed && pub.track) {
            attachTrack(pub.track);
          }
        });
      });

      setStatus((current) =>
        current === "playing" ? current : "waiting-for-audio",
      );

      if (audioRef.current) {
        try {
          // This play() is a *primer* — it runs inside the user-gesture context
          // so that when LiveKit later attaches a real track via track.attach()
          // it can play without a second tap (iOS Safari requirement).
          await audioRef.current.play();
        } catch (err) {
          // If there's no srcObject yet, the rejection is expected (nothing to
          // play; the primer still unlocked the element). Only surface the
          // "tap to unmute" hint when there's actually a source the browser
          // refused to play.
          if (audioRef.current.srcObject) {
            setErrorMessage(
              `Tap the screen to unmute audio. (${(err as Error).message})`,
            );
          }
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setErrorMessage(message);
      setStatus("error");
    }
  }, [room, attachTrack]);

  const handleStop = useCallback(async () => {
    try {
      await roomRef.current?.disconnect();
    } finally {
      roomRef.current = null;
      setStatus("ended");
    }
  }, []);

  useEffect(() => {
    return () => {
      void roomRef.current?.disconnect();
      roomRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.muted = muted;
      audioRef.current.volume = volume;
    }
  }, [muted, volume]);

  const showStart = status === "idle" || status === "ended" || status === "error";

  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-zinc-50 px-6 py-10 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <main className="flex w-full max-w-md flex-col gap-6 rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <header className="flex flex-col gap-1 text-center">
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-emerald-700 dark:text-emerald-400">
            Listener
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">
            Live translation
          </h1>
          <p className="font-mono text-xs text-zinc-500 dark:text-zinc-400">
            room: {prettyRoom}
          </p>
          {eventSlug ? (
            <Link
              href={`/e/${encodeURIComponent(eventSlug)}`}
              className="mt-1 text-sm font-medium text-emerald-700 underline-offset-4 hover:underline dark:text-emerald-400"
            >
              Change language
            </Link>
          ) : null}
        </header>

        <div className="flex items-center justify-center gap-2 text-sm font-medium">
          <span
            className={`inline-block h-2.5 w-2.5 rounded-full ${STATUS_DOT_CLASS[status]}`}
            aria-hidden
          />
          <span>{STATUS_LABEL[status]}</span>
        </div>

        {errorMessage ? (
          <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-200">
            {errorMessage}
          </div>
        ) : null}

        {showStart ? (
          <button
            type="button"
            onClick={handleStart}
            className="flex h-14 w-full items-center justify-center rounded-xl bg-emerald-600 text-base font-semibold text-white shadow-sm transition hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 dark:focus:ring-offset-zinc-900"
          >
            Listen
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={handleStop}
              className="flex h-12 w-full items-center justify-center rounded-xl bg-zinc-200 text-sm font-medium text-zinc-900 transition hover:bg-zinc-300 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700"
            >
              Disconnect
            </button>

            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={muted}
                  onChange={(e) => setMuted(e.target.checked)}
                  className="h-4 w-4 rounded border-zinc-300 text-emerald-600 focus:ring-emerald-500"
                />
                <span>Mute</span>
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={showCaptions}
                  onChange={(e) => setShowCaptions(e.target.checked)}
                  className="h-4 w-4 rounded border-zinc-300 text-emerald-600 focus:ring-emerald-500"
                />
                <span>Captions</span>
              </label>
              <div className="flex min-w-40 flex-1 items-center gap-2 text-sm">
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  Vol
                </span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={volume}
                  onChange={(e) => setVolume(Number(e.target.value))}
                  className="min-w-0 flex-1 accent-emerald-600"
                />
              </div>
            </div>

            {showCaptions ? (
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  <span>Captions</span>
                  {captions ? (
                    <button
                      type="button"
                      onClick={() => setCaptions("")}
                      className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
                    >
                      Clear
                    </button>
                  ) : null}
                </div>
                <div
                  ref={captionScrollRef}
                  className="h-44 overflow-y-auto rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm leading-relaxed text-zinc-900 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100"
                >
                  {captions ? (
                    <span className="whitespace-pre-wrap">{captions}</span>
                  ) : (
                    <span className="text-zinc-400 dark:text-zinc-600">
                      Waiting for translated text…
                    </span>
                  )}
                </div>
              </div>
            ) : null}
          </>
        )}

        <p className="text-center text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
          Plug in your headphones, then tap Listen. iOS needs an explicit tap
          before audio can start.
        </p>
      </main>

      <audio ref={audioRef} autoPlay playsInline />
    </div>
  );
}
