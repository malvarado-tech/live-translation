"use client";

import {
  Room,
  RoomEvent,
  Track,
  type Participant,
  type RemoteAudioTrack,
  type RemoteTrack,
} from "livekit-client";
import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ListenerSurface, type ListenerChannel } from "@/components/listener/surface";
import { appendCaption, captionLines, emptyCaptions } from "@/lib/captions";
import { slugify } from "@/lib/event-rooms";
import { languageLabel, languageOfRoomName } from "@/lib/languages";
import {
  classifyDisconnect,
  deriveListenerDisplay,
  listenerTone,
  REJOIN_DELAYS_MS,
  type ListenerConnection,
  type OperatorSignal,
} from "@/lib/listener-health";
import { LISTENER_STRINGS, uiLangForRoom } from "@/lib/listener-strings";
import { CAPTION_TOPIC, type CaptionMessage } from "@/lib/livekit-publisher";
import { useUiLang } from "@/lib/prefs";
import { parseOperatorStatus, STATUS_ATTR } from "@/lib/session-status";
import { primeAudio, useAudioLevel } from "@/lib/use-audio-level";
import { useMediaSession, useWakeLock } from "@/lib/use-device-session";

type TokenResponse = { token?: string; url?: string; error?: string };

type EventLanguage = {
  code: string;
  label: string;
  room: string;
  status?: { state?: string | null; mode?: string | null };
};

type OperatorInfo = {
  present: boolean;
  seen: boolean;
  state: OperatorSignal | null;
  title: string | null;
  mode: "translate" | "original" | null;
  responseMs: number | null;
};

const NO_OPERATOR: OperatorInfo = {
  present: false,
  seen: false,
  state: null,
  title: null,
  mode: null,
  responseMs: null,
};

const CHANNEL_POLL_MS = 15_000;

function isOperator(p: Participant): boolean {
  return (
    typeof p.attributes?.[STATUS_ATTR.state] === "string" ||
    p.identity.startsWith("operator") ||
    Boolean(p.permissions?.canPublish)
  );
}

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
  // language switching. Only honoured when the room belongs to that event.
  const eventSlug = useMemo(() => {
    const slug = slugify(typeof eventParam === "string" ? eventParam : "");
    return slug && room.startsWith(`${slug}-`) ? slug : null;
  }, [eventParam, room]);

  const langCode = languageOfRoomName(room);
  const [uiLang, setUiLang] = useUiLang(uiLangForRoom(langCode));
  const t = LISTENER_STRINGS[uiLang];

  const [connection, setConnection] = useState<ListenerConnection>("idle");
  const [rejoinAttempt, setRejoinAttempt] = useState(0);
  const [operator, setOperator] = useState<OperatorInfo>(NO_OPERATOR);
  const [audioStream, setAudioStream] = useState<MediaStream | null>(null);
  const [muted, setMuted] = useState(false);
  const [captions, setCaptions] = useState(emptyCaptions);
  const [notice, setNotice] = useState<string | null>(null);
  const [channels, setChannels] = useState<EventLanguage[]>([]);
  const [eventTitle, setEventTitle] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const roomRef = useRef<Room | null>(null);
  const leavingRef = useRef(false);
  const rejoinTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptRef = useRef(0);
  const operatorSeenRef = useRef(false);
  const lastOperatorStateRef = useRef<OperatorSignal | null>(null);
  const connectRef = useRef<(rejoin: boolean) => Promise<void>>(async () => {});
  const decoder = useMemo(() => new TextDecoder(), []);

  const level = useAudioLevel(audioStream);

  useEffect(() => {
    document.documentElement.lang = uiLang;
  }, [uiLang]);

  const readOperator = useCallback((lk: Room) => {
    let found: Participant | null = null;
    lk.remoteParticipants.forEach((p) => {
      if (!found && isOperator(p)) found = p;
    });
    const p = found as Participant | null;
    if (p) {
      operatorSeenRef.current = true;
      const st = parseOperatorStatus(p.attributes);
      lastOperatorStateRef.current = st.state;
      setOperator({
        present: true,
        seen: true,
        state: st.state,
        title: st.title,
        mode: st.mode,
        responseMs: st.responseMs,
      });
    } else {
      setOperator((prev) => ({
        ...prev,
        present: false,
        seen: operatorSeenRef.current,
        state: lastOperatorStateRef.current === "ended" ? "ended" : prev.state,
      }));
    }
  }, []);

  const attachTrack = useCallback((track: RemoteTrack) => {
    if (!audioRef.current || track.kind !== Track.Kind.Audio) return;
    (track as RemoteAudioTrack).attach(audioRef.current);
    setAudioStream(new MediaStream([track.mediaStreamTrack]));
    audioRef.current.play().catch(() => {
      setNotice("blocked");
    });
  }, []);

  const clearRejoin = () => {
    if (rejoinTimer.current) {
      clearTimeout(rejoinTimer.current);
      rejoinTimer.current = null;
    }
  };

  const scheduleRejoin = useCallback(() => {
    clearRejoin();
    if (attemptRef.current >= REJOIN_DELAYS_MS.length) {
      setConnection("unavailable");
      return;
    }
    const delay = REJOIN_DELAYS_MS[attemptRef.current];
    attemptRef.current += 1;
    setRejoinAttempt(attemptRef.current);
    setConnection("rejoining");
    rejoinTimer.current = setTimeout(() => {
      rejoinTimer.current = null;
      void connectRef.current(true);
    }, delay);
  }, []);

  const connect = useCallback(
    async (rejoin: boolean) => {
      leavingRef.current = false;
      if (!rejoin) {
        attemptRef.current = 0;
        setRejoinAttempt(0);
      }
      setConnection(rejoin ? "rejoining" : "connecting");

      let tokenData: TokenResponse;
      try {
        const resp = await fetch(`/api/listen-token?room=${encodeURIComponent(room)}`, {
          cache: "no-store",
        });
        tokenData = (await resp.json().catch(() => ({}))) as TokenResponse;
        if (!resp.ok || !tokenData.token || !tokenData.url) {
          // A configuration problem on the server; retrying will not help.
          // The listener sees a plain "unavailable", never the server text.
          setConnection(rejoin ? "rejoining" : "unavailable");
          if (rejoin) scheduleRejoin();
          return;
        }
      } catch {
        // Network down: keep trying.
        scheduleRejoin();
        return;
      }

      const lk = new Room({ adaptiveStream: true, dynacast: false });
      lk.on(RoomEvent.TrackSubscribed, (track) => attachTrack(track))
        .on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
          try {
            if (track.kind === Track.Kind.Audio && audioRef.current) {
              (track as RemoteAudioTrack).detach(audioRef.current);
            }
          } catch {
            // ignore
          }
          setAudioStream(null);
        })
        .on(RoomEvent.DataReceived, (payload, _p, _k, topic) => {
          if (topic !== CAPTION_TOPIC) return;
          try {
            const msg = JSON.parse(decoder.decode(payload)) as CaptionMessage | undefined;
            if (msg?.kind === "caption" && typeof msg.delta === "string") {
              setCaptions((prev) => appendCaption(prev, msg.delta));
            }
          } catch {
            // Malformed payload: captions are best-effort.
          }
        })
        .on(RoomEvent.ParticipantConnected, () => readOperator(lk))
        .on(RoomEvent.ParticipantDisconnected, () => readOperator(lk))
        .on(RoomEvent.ParticipantAttributesChanged, () => readOperator(lk))
        .on(RoomEvent.Reconnecting, () => setConnection("reconnecting"))
        .on(RoomEvent.SignalReconnecting, () => setConnection("reconnecting"))
        .on(RoomEvent.Reconnected, () => {
          setConnection("connected");
          readOperator(lk);
        })
        .on(RoomEvent.Disconnected, (reason) => {
          if (roomRef.current === lk) roomRef.current = null;
          setAudioStream(null);
          if (leavingRef.current) {
            setConnection("left");
            return;
          }
          const kind = classifyDisconnect(reason as number | undefined);
          if (kind === "room-gone" || kind === "removed") {
            setConnection("ended");
          } else {
            // Network trouble or anything unexplained: rejoin, never "ended".
            scheduleRejoin();
          }
        });

      try {
        await lk.connect(tokenData.url!, tokenData.token!, { autoSubscribe: true });
      } catch {
        scheduleRejoin();
        return;
      }
      if (leavingRef.current) {
        void lk.disconnect();
        return;
      }
      roomRef.current = lk;
      attemptRef.current = 0;
      setRejoinAttempt(0);
      setConnection("connected");
      readOperator(lk);
      lk.remoteParticipants.forEach((participant) => {
        participant.trackPublications.forEach((pub) => {
          if (pub.isSubscribed && pub.track) attachTrack(pub.track);
        });
      });
    },
    [room, attachTrack, decoder, readOperator, scheduleRejoin],
  );

  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  const handleListen = useCallback(() => {
    setNotice(null);
    primeAudio();
    // Prime the element inside the tap so later track attachment can play
    // without another tap (iOS Safari).
    audioRef.current?.play().catch(() => {});
    if (roomRef.current) return;
    clearRejoin();
    void connect(false);
  }, [connect]);

  const handleLeave = useCallback(() => {
    leavingRef.current = true;
    clearRejoin();
    const lk = roomRef.current;
    roomRef.current = null;
    setAudioStream(null);
    if (lk) void lk.disconnect();
    setConnection("left");
  }, []);

  // Network back: try right away instead of waiting for the next backoff.
  useEffect(() => {
    const onOnline = () => {
      if (rejoinTimer.current) {
        clearRejoin();
        void connectRef.current(true);
      }
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, []);

  useEffect(() => {
    return () => {
      leavingRef.current = true;
      clearRejoin();
      void roomRef.current?.disconnect();
      roomRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (audioRef.current) audioRef.current.muted = muted;
  }, [muted]);

  // Other languages of the event, for the channel buttons.
  useEffect(() => {
    if (!eventSlug) return;
    let stopped = false;
    const load = async () => {
      try {
        const resp = await fetch(`/api/event-languages?event=${encodeURIComponent(eventSlug)}`, {
          cache: "no-store",
        });
        if (!resp.ok) return;
        const data = (await resp.json()) as { languages?: EventLanguage[]; title?: string | null };
        if (stopped) return;
        if (Array.isArray(data.languages)) setChannels(data.languages);
        if (typeof data.title === "string") setEventTitle(data.title);
      } catch {
        // keep the last list
      }
    };
    const first = setTimeout(() => void load(), 0);
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, CHANNEL_POLL_MS);
    return () => {
      stopped = true;
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [eventSlug]);

  const display = deriveListenerDisplay({
    connection,
    operatorPresent: operator.present,
    operatorSeen: operator.seen,
    operatorState: operator.state,
    hasAudio: audioStream !== null,
    silentMs: level.active ? level.silentMs : 0,
  });
  const tone = listenerTone(display);

  const channelList: ListenerChannel[] = useMemo(() => {
    if (!eventSlug) return [];
    const list = channels.some((c) => c.room === room)
      ? channels
      : [...channels, { code: langCode ?? "", label: languageLabel(langCode ?? ""), room }];
    return list.map((c, i) => ({
      code: c.code,
      label: c.label,
      lang: c.code,
      number: i + 1,
      active: c.room === room,
      href: `/listen/${encodeURIComponent(c.room)}?event=${encodeURIComponent(eventSlug)}`,
    }));
  }, [channels, eventSlug, room, langCode]);

  const channelNumber = channelList.find((c) => c.active)?.number ?? null;
  const title = operator.title ?? eventTitle ?? t.liveTranslation;
  const label = langCode ? languageLabel(langCode) : t.liveTranslation;
  const connected = connection === "connected" || connection === "reconnecting" || connection === "rejoining";

  useWakeLock(connected);
  useMediaSession(
    connected
      ? {
          title: `${label} · ${title}`,
          artist: t.liveTranslation,
          playing: !muted,
          onPlay: () => setMuted(false),
          onPause: () => setMuted(true),
        }
      : null,
  );

  const lines = useMemo(() => captionLines(captions), [captions]);

  return (
    <>
      <ListenerSurface
        t={t}
        uiLang={uiLang}
        onUiLang={setUiLang}
        title={title}
        subtitle={operator.title || eventTitle ? t.liveTranslation : null}
        channel={{
          code: langCode ?? "--",
          label: operator.mode === "original" ? `${label}, ${t.originalAudio}` : label,
          number: channelNumber,
          lang: langCode ?? uiLang,
        }}
        status={display}
        tone={tone}
        statusDetail={display === "network-reconnecting" && rejoinAttempt > 0 ? t.attempt(rejoinAttempt, REJOIN_DELAYS_MS.length) : null}
        level={level.active ? level.level : null}
        delaySeconds={operator.responseMs != null ? operator.responseMs / 1000 : null}
        lines={lines}
        captionsAvailable={operator.mode !== "original"}
        channels={channelList}
        primary={
          connected && !notice
            ? { kind: "mute", muted, onToggle: () => setMuted((m) => !m) }
            : { kind: "listen", onClick: handleListen, busy: connection === "connecting" }
        }
        onLeave={connected ? handleLeave : null}
        changeLanguageHref={eventSlug ? `/e/${encodeURIComponent(eventSlug)}` : null}
        notice={notice ? t.audioBlocked : null}
        footer={
          connection === "idle" ? (
            <p className="text-center text-[15px] text-silk">{t.headphones}</p>
          ) : null
        }
      />
      <audio ref={audioRef} autoPlay playsInline />
    </>
  );
}
