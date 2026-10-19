"use client";

import Link from "next/link";
import {
  use,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import {
  OperatorBody,
  SessionActions,
  SessionBar,
  type AlertModel,
  type ListenerPreview,
  type OperatorModel,
  type StripModel,
} from "@/components/operator/views";
import { TelemetryPanel } from "@/components/telemetry-panel";
import { Button, buttonClass, HMeter, Segmented, type TallyTone } from "@/components/ui/controls";
import {
  applySinkId,
  DEFAULTS as AUDIO_DEFAULTS,
  useAudioDevices,
} from "@/lib/audio-devices";
import {
  mimeToExtension,
  startRecorder,
  type RecorderHandle,
} from "@/lib/audio-recorder";
import { appendCaption, captionLines, emptyCaptions } from "@/lib/captions";
import { describeOperatorError } from "@/lib/error-copy";
import { eventRoomName, slugify } from "@/lib/event-rooms";
import { languageLabel, TARGET_LANGUAGES } from "@/lib/languages";
import { LISTENER_STRINGS, uiLangForRoom, type ListenerStatusKey } from "@/lib/listener-strings";
import { startPublisher, type Publisher, type PublisherStatus } from "@/lib/livekit-publisher";
import { startSession, type RealtimeEvent, type RealtimeSession } from "@/lib/realtime";
import {
  broadcastStateOf,
  describeSession,
  initialSession,
  sessionReducer,
  type BroadcastState,
} from "@/lib/session-machine";
import { statusAttributes, type ChannelMode } from "@/lib/session-status";
import {
  formatDuration,
  SessionTelemetry,
  type ConnState,
  type TelemetrySnapshot,
} from "@/lib/telemetry";
import { formatDb, primeAudio, useAudioLevel } from "@/lib/use-audio-level";

const LIVEKIT_ENABLED = Boolean(process.env.NEXT_PUBLIC_LIVEKIT_URL);
const MAX_ENGINE_RECONNECTS = 3;
const EVENT_POLL_MS = 5_000;
const INPUT_SILENCE_ALERT_MS = 10_000;
const OUTPUT_SILENCE_ALERT_MS = 15_000;

type Monitor = "program" | "source" | "mute";

type RemoteLanguage = {
  code: string;
  label: string;
  room: string;
  status?: {
    state?: string | null;
    mode?: string | null;
    listeners?: number;
    sinceMs?: number | null;
    responseMs?: number | null;
  };
};

type LogEntry = { atMs: number; text: string };

function param(v: string | string[] | undefined): string {
  return typeof v === "string" ? v : "";
}

function clockOf(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function secs(ms: number | null | undefined): string | null {
  return ms == null ? null : `${(ms / 1000).toFixed(1)} s`;
}

const BROADCAST_TO_DISPLAY: Record<BroadcastState, ListenerStatusKey> = {
  waiting: "waiting",
  live: "live",
  paused: "paused",
  reconnecting: "translation-reconnecting",
  interrupted: "interrupted",
  ended: "ended",
};

function toConnState(s: PublisherStatus | RealtimeEventStatus): ConnState {
  if (s === "creating-session" || s === "negotiating" || s === "reconnecting") return "connecting";
  return s;
}
type RealtimeEventStatus = Extract<RealtimeEvent, { type: "status" }>["status"];

export default function OperatorPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const sp = use(searchParams);

  /* ------------------------------------------------------- configuration */
  const [eventId, setEventId] = useState(() => param(sp.event) || "demo");
  const [eventTitle, setEventTitle] = useState(() => param(sp.title).slice(0, 120));
  const [targetLanguage, setTargetLanguage] = useState(() => {
    const l = param(sp.lang);
    return TARGET_LANGUAGES.some((t) => t.code === l) ? l : "en";
  });
  const [mode, setMode] = useState<ChannelMode>(() =>
    param(sp.mode) === "original" ? "original" : "translate",
  );
  const [captureSource, setCaptureSource] = useState(false);
  // Disables browser echo cancellation, noise suppression and automatic
  // gain control. Right for clean line-level feeds (mixing desk, virtual
  // cable); wrong for laptop mics in noisy rooms.
  const [rawAudio, setRawAudio] = useState(false);
  const [monitor, setMonitor] = useState<Monitor>("program");
  const [broadcastToTab, setBroadcastToTab] = useState(true);
  const [listenerBaseUrl, setListenerBaseUrl] = useState<string>(() =>
    (process.env.NEXT_PUBLIC_LISTENER_BASE_URL ?? "").replace(/\/+$/, ""),
  );
  const audioDevices = useAudioDevices();

  /* ------------------------------------------------------------- session */
  const [session, dispatch] = useReducer(sessionReducer, initialSession);
  const view = describeSession(session, LIVEKIT_ENABLED);
  const [publisherStatus, setPublisherStatus] = useState<PublisherStatus | "idle">("idle");
  const [participantCount, setParticipantCount] = useState(0);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [source, setSource] = useState(emptyCaptions);
  const [target, setTarget] = useState(emptyCaptions);
  const [micStream, setMicStream] = useState<MediaStream | null>(null);
  const [outputStream, setOutputStream] = useState<MediaStream | null>(null);
  const [previewStream, setPreviewStream] = useState<MediaStream | null>(null);
  const [remote, setRemote] = useState<RemoteLanguage[]>([]);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [showInputPicker, setShowInputPicker] = useState(false);
  const [copied, setCopied] = useState<"event" | "room" | null>(null);
  const [addLang, setAddLang] = useState("");

  const telemetryRef = useRef<SessionTelemetry | null>(null);
  if (telemetryRef.current === null) telemetryRef.current = new SessionTelemetry();
  const [telemetrySnapshot, setTelemetrySnapshot] = useState<TelemetrySnapshot | null>(null);
  const [savedBenchmarkPath, setSavedBenchmarkPath] = useState<string | null>(null);

  const programAudioRef = useRef<HTMLAudioElement | null>(null);
  const broadcastAudioRef = useRef<HTMLAudioElement | null>(null);
  const sourceAudioRef = useRef<HTMLAudioElement | null>(null);

  const engineRef = useRef<RealtimeSession | null>(null);
  const publisherRef = useRef<Publisher | null>(null);
  const micRef = useRef<MediaStream | null>(null);
  const stoppingRef = useRef(false);
  const lastEngineErrorRef = useRef<string>("");
  const phaseRef = useRef(session.phase);
  const sessionStartRef = useRef<number | null>(null);

  const micRecorderRef = useRef<RecorderHandle | null>(null);
  const outRecorderRef = useRef<RecorderHandle | null>(null);
  const recordingsRef = useRef<{ mic: Blob[]; openai: Blob[]; gemini: Blob[]; mimeType: string }>({
    mic: [],
    openai: [],
    gemini: [],
    mimeType: "audio/webm",
  });

  useEffect(() => {
    phaseRef.current = session.phase;
  }, [session.phase]);

  const inputLevel = useAudioLevel(micStream ?? previewStream);
  const outputLevel = useAudioLevel(outputStream);

  const eventSlug = slugify(eventId || "demo");
  const room = useMemo(() => eventRoomName(eventSlug, targetLanguage), [eventSlug, targetLanguage]);
  const base = listenerBaseUrl || (typeof window !== "undefined" ? window.location.origin : "");
  const eventUrl = base ? `${base}/e/${eventSlug}` : "";
  const roomUrl = base ? `${base}/listen/${room}` : "";
  const langLabel = languageLabel(targetLanguage);

  /* --------------------------------------------------------------- clock */
  useEffect(() => {
    const id = setInterval(() => {
      setNow(Date.now());
      if (telemetryRef.current) setTelemetrySnapshot(telemetryRef.current.snapshot());
    }, 1000);
    return () => clearInterval(id);
  }, []);

  const addLog = useCallback((text: string) => {
    const start = sessionStartRef.current ?? Date.now();
    setLog((prev) => [...prev.slice(-49), { atMs: Date.now() - start, text }]);
  }, []);

  /* ------------------------------------------------------------- monitor */
  useEffect(() => {
    const usingSpecificOutput = Boolean(audioDevices.selectedOutput);
    const program = monitor === "program";
    const original = mode === "original";
    if (sourceAudioRef.current) {
      sourceAudioRef.current.muted = !(monitor === "source" || (program && original));
    }
    if (programAudioRef.current) programAudioRef.current.muted = !(program && !original);
    if (broadcastAudioRef.current) {
      broadcastAudioRef.current.muted = !broadcastToTab || !program || original || !usingSpecificOutput;
    }
  }, [monitor, mode, broadcastToTab, audioDevices.selectedOutput]);

  useEffect(() => {
    if (!audioDevices.outputSupported) return;
    void applySinkId(sourceAudioRef.current, audioDevices.selectedOutput);
    void applySinkId(programAudioRef.current, audioDevices.selectedOutput);
  }, [audioDevices.selectedOutput, audioDevices.outputSupported]);

  /* --------------------------------------------------- status to listeners */
  const broadcast = broadcastStateOf(session);
  useEffect(() => {
    const pub = publisherRef.current;
    if (!pub || !broadcast) return;
    void pub.setStatus(
      statusAttributes({
        state: broadcast,
        title: eventTitle.trim() || null,
        lang: targetLanguage,
        mode,
        sinceMs: session.liveSince,
        responseMs: mode === "translate" ? latencyMs : null,
      }),
    );
  }, [broadcast, eventTitle, targetLanguage, mode, session.liveSince, latencyMs]);

  /* ------------------------------------------- other languages of the event */
  useEffect(() => {
    if (!LIVEKIT_ENABLED || !session.hasRoom) return;
    let stopped = false;
    const load = async () => {
      try {
        const resp = await fetch(`/api/event-languages?event=${encodeURIComponent(eventSlug)}`, {
          cache: "no-store",
        });
        if (!resp.ok) return;
        const data = (await resp.json()) as { languages?: RemoteLanguage[] };
        if (!stopped && Array.isArray(data.languages)) setRemote(data.languages);
      } catch {
        // keep the last list
      }
    };
    const first = setTimeout(() => void load(), 0);
    const id = setInterval(() => void load(), EVENT_POLL_MS);
    return () => {
      stopped = true;
      clearTimeout(first);
      clearInterval(id);
    };
  }, [session.hasRoom, eventSlug]);

  /* ---------------------------------------------------------- telemetry */
  const startTelemetryIfNeeded = useCallback(() => {
    const tel = telemetryRef.current;
    if (!tel || tel.snapshot().running) return;
    tel.start({
      eventId: eventSlug,
      targetLanguage,
      engines: ["openai"],
      captureSource: captureSource && mode === "translate",
    });
    recordingsRef.current = { mic: [], openai: [], gemini: [], mimeType: "audio/webm" };
    sessionStartRef.current = Date.now();
    setLog([]);
    setSavedBenchmarkPath(null);
    setTelemetrySnapshot(tel.snapshot());
  }, [eventSlug, targetLanguage, captureSource, mode]);

  const stopSegmentRecorders = useCallback(async () => {
    const recs = recordingsRef.current;
    const stops: Promise<void>[] = [];
    const mic = micRecorderRef.current;
    const out = outRecorderRef.current;
    micRecorderRef.current = null;
    outRecorderRef.current = null;
    if (mic) {
      recs.mimeType = mic.mimeType;
      stops.push(mic.stop().then((b) => void (b && recs.mic.push(b))));
    }
    if (out) {
      recs.mimeType = out.mimeType;
      stops.push(out.stop().then((b) => void (b && recs.openai.push(b))));
    }
    await Promise.allSettled(stops);
  }, []);

  // Finalize telemetry and write the report to benchmarks/{stamp}/, with
  // audio and SRT/VTT when recordings exist.
  const finalizeTelemetry = useCallback(async () => {
    const tel = telemetryRef.current;
    if (!tel || !tel.snapshot().running) return;
    tel.stop();
    setTelemetrySnapshot(tel.snapshot());
    const report = tel.report();
    const recs = recordingsRef.current;
    const hasAudio = recs.mic.length > 0 || recs.openai.length > 0;
    try {
      let resp: Response;
      if (hasAudio) {
        const form = new FormData();
        form.append("report", JSON.stringify(report));
        const ext = mimeToExtension(recs.mimeType);
        form.append("extension", ext);
        recs.mic.forEach((b, i) => form.append(`audio-mic-${i + 1}`, b, `audio-mic-${i + 1}.${ext}`));
        recs.openai.forEach((b, i) =>
          form.append(`audio-openai-${i + 1}`, b, `audio-openai-${i + 1}.${ext}`),
        );
        resp = await fetch("/api/save-benchmark", { method: "POST", body: form });
      } else {
        resp = await fetch("/api/save-benchmark", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(report),
        });
      }
      const data = (await resp.json().catch(() => ({}))) as { markdown?: string; folder?: string };
      if (resp.ok) setSavedBenchmarkPath(data.folder ?? data.markdown ?? "(saved)");
    } catch {
      // The report is a convenience; failing to write it is not a session fault.
    }
  }, []);

  /* ------------------------------------------------------------ teardown */
  const teardownTranslation = useCallback(async () => {
    stoppingRef.current = true;
    try {
      await engineRef.current?.stop();
    } catch {
      // ignore
    }
    engineRef.current = null;
    await stopSegmentRecorders();
    try {
      await publisherRef.current?.unpublishTrack();
    } catch {
      // ignore
    }
    micRef.current?.getTracks().forEach((t) => t.stop());
    micRef.current = null;
    setMicStream(null);
    setOutputStream(null);
    if (sourceAudioRef.current) sourceAudioRef.current.srcObject = null;
    stoppingRef.current = false;
  }, [stopSegmentRecorders]);

  /* ------------------------------------------------------------ room */
  const handleOpenRoom = useCallback(async () => {
    primeAudio();
    dispatch({ type: "open-room" });
    setParticipantCount(0);
    setRemote([]);
    startTelemetryIfNeeded();
    try {
      publisherRef.current = await startPublisher({
        room,
        onEvent: (e) => {
          const tel = telemetryRef.current;
          if (e.type === "status") {
            setPublisherStatus(e.status);
            tel?.recordConnState("livekit", toConnState(e.status));
          } else if (e.type === "participant-count") {
            setParticipantCount(e.count);
            tel?.recordListenerCount(e.count);
          } else if (e.type === "error") {
            tel?.recordError("LiveKit", e.message);
          } else if (e.type === "lost") {
            tel?.recordError("LiveKit", e.message);
            publisherRef.current = null;
            dispatch({ type: "room-lost", message: e.message });
            void teardownTranslation();
          }
        },
      });
      dispatch({ type: "room-opened" });
      addLog("Room opened");
    } catch (err) {
      publisherRef.current = null;
      dispatch({ type: "room-failed", message: err instanceof Error ? err.message : String(err) });
      addLog("Room failed to open");
    }
  }, [room, startTelemetryIfNeeded, teardownTranslation, addLog]);

  const handleEngineEvent = useCallback(
    (event: RealtimeEvent) => {
      const tel = telemetryRef.current;
      const at = sessionStartRef.current ? Date.now() - sessionStartRef.current : null;
      switch (event.type) {
        case "status":
          tel?.recordConnState("openai", toConnState(event.status));
          if (event.status === "live") {
            dispatch({ type: "engine-live", at: Date.now() });
          } else if (event.status === "closed" && !stoppingRef.current) {
            const p = phaseRef.current;
            if (p === "live" || p === "reconnecting") {
              dispatch({ type: "engine-lost", message: lastEngineErrorRef.current || "Translation engine closed." });
            }
          }
          break;
        case "source-transcript":
          setSource((prev) => appendCaption(prev, event.delta, at));
          tel?.recordTranscript("openai", "source", event.delta);
          break;
        case "translated-transcript":
          setTarget((prev) => appendCaption(prev, event.delta, at));
          tel?.recordActivity("openai");
          tel?.recordTranscript("openai", "translated", event.delta);
          if (publisherRef.current) void publisherRef.current.publishCaption(event.delta);
          break;
        case "first-audio-received":
          setLatencyMs(event.latencyMs);
          tel?.recordLatency("openai", event.latencyMs);
          break;
        case "token-expiry":
          tel?.recordTokenExpiry("openai", event.expiresAtMs);
          break;
        case "reconnect":
          dispatch({ type: "engine-reconnecting", attempt: event.attempt, max: MAX_ENGINE_RECONNECTS });
          tel?.recordReconnect("openai", event.attempt, event.delayMs);
          break;
        case "error":
          lastEngineErrorRef.current = event.message;
          tel?.recordError("OpenAI", event.message);
          break;
      }
    },
    [],
  );

  const handleStart = useCallback(async () => {
    primeAudio();
    dispatch({ type: "start" });
    setSource(emptyCaptions);
    setTarget(emptyCaptions);
    setLatencyMs(null);
    lastEngineErrorRef.current = "";
    startTelemetryIfNeeded();
    previewStream?.getTracks().forEach((t) => t.stop());
    setPreviewStream(null);

    let mic: MediaStream;
    try {
      const constraints: MediaTrackConstraints = {
        echoCancellation: !rawAudio,
        noiseSuppression: !rawAudio,
        autoGainControl: !rawAudio,
      };
      if (audioDevices.selectedInput) constraints.deviceId = { exact: audioDevices.selectedInput };
      mic = await navigator.mediaDevices.getUserMedia({ audio: constraints, video: false });
    } catch (err) {
      const e = err as Error;
      dispatch({ type: "start-failed", scope: "Input", message: `${e.name ?? "Error"}: ${e.message}` });
      addLog("Input not available");
      return;
    }
    micRef.current = mic;
    setMicStream(mic);
    if (sourceAudioRef.current) {
      sourceAudioRef.current.srcObject = mic;
      sourceAudioRef.current.play().catch(() => {});
    }
    if (!audioDevices.hasPermission) void audioDevices.refresh();
    micRecorderRef.current = startRecorder({ stream: mic });

    if (mode === "original") {
      // The speaker's own audio goes straight to the room; no engine, no cost.
      setOutputStream(mic);
      try {
        if (publisherRef.current) await publisherRef.current.publishTrack(mic.getAudioTracks()[0]);
        dispatch({ type: "engine-live", at: Date.now() });
        addLog(`${targetLanguage.toUpperCase()} original audio on air`);
      } catch (err) {
        dispatch({ type: "start-failed", scope: "Room", message: err instanceof Error ? err.message : String(err) });
        await teardownTranslation();
      }
      return;
    }

    try {
      engineRef.current = await startSession({
        targetLanguage,
        captureSource,
        audioSink: programAudioRef.current,
        broadcastSink: broadcastAudioRef.current,
        micStream: mic,
        onEvent: handleEngineEvent,
        onTrack: async (track) => {
          const prev = outRecorderRef.current;
          outRecorderRef.current = null;
          if (prev) void prev.stop().then((b) => void (b && recordingsRef.current.openai.push(b)));
          const stream = new MediaStream([track]);
          outRecorderRef.current = startRecorder({ stream });
          setOutputStream(stream);
          if (!publisherRef.current) return;
          try {
            await publisherRef.current.publishTrack(track);
          } catch (err) {
            telemetryRef.current?.recordError("LiveKit", err instanceof Error ? err.message : String(err));
          }
        },
      });
      addLog(`${targetLanguage.toUpperCase()} on air`);
    } catch (err) {
      engineRef.current = null;
      dispatch({
        type: "start-failed",
        scope: "Translation",
        message: lastEngineErrorRef.current || (err instanceof Error ? err.message : String(err)),
      });
      addLog("Translation failed to start");
      await teardownTranslation();
    }
  }, [
    targetLanguage,
    captureSource,
    rawAudio,
    mode,
    audioDevices,
    previewStream,
    handleEngineEvent,
    startTelemetryIfNeeded,
    teardownTranslation,
    addLog,
  ]);

  const handleStop = useCallback(async () => {
    dispatch({ type: "stop" });
    await teardownTranslation();
    if (!publisherRef.current) await finalizeTelemetry();
    dispatch({ type: "stopped" });
    addLog(publisherRef.current ? "Paused" : "Stopped");
  }, [teardownTranslation, finalizeTelemetry, addLog]);

  const handleClose = useCallback(async () => {
    setConfirmEnd(false);
    dispatch({ type: "close" });
    await teardownTranslation();
    const pub = publisherRef.current;
    publisherRef.current = null;
    if (pub) {
      try {
        await pub.setStatus(
          statusAttributes({ state: "ended", title: eventTitle.trim() || null, lang: targetLanguage, mode }),
        );
      } catch {
        // ignore
      }
      try {
        await pub.stop();
      } catch {
        // ignore
      }
    }
    setPublisherStatus("closed");
    setParticipantCount(0);
    setRemote([]);
    await finalizeTelemetry();
    dispatch({ type: "closed" });
  }, [teardownTranslation, finalizeTelemetry, eventTitle, targetLanguage, mode]);

  const handleMark = useCallback(() => {
    telemetryRef.current?.recordMark();
    const snap = telemetryRef.current?.snapshot() ?? null;
    setTelemetrySnapshot(snap);
    const last = captionLines(source).at(-1)?.text ?? captionLines(target).at(-1)?.text;
    addLog(`Mark ${snap?.marksCount ?? ""}${last ? ` · “${last.slice(0, 40)}”` : ""}`);
  }, [source, target, addLog]);

  useEffect(() => {
    return () => {
      void publisherRef.current?.stop();
      void engineRef.current?.stop();
      void micRecorderRef.current?.stop();
      void outRecorderRef.current?.stop();
      micRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const toggleTest = useCallback(async () => {
    if (previewStream) {
      previewStream.getTracks().forEach((t) => t.stop());
      setPreviewStream(null);
      return;
    }
    primeAudio();
    try {
      const constraints: MediaTrackConstraints = {
        echoCancellation: !rawAudio,
        noiseSuppression: !rawAudio,
        autoGainControl: !rawAudio,
      };
      if (audioDevices.selectedInput) constraints.deviceId = { exact: audioDevices.selectedInput };
      const s = await navigator.mediaDevices.getUserMedia({ audio: constraints, video: false });
      setPreviewStream(s);
      if (!audioDevices.hasPermission) void audioDevices.refresh();
    } catch (err) {
      const e = err as Error;
      dispatch({ type: "start" });
      dispatch({ type: "start-failed", scope: "Input", message: `${e.name ?? "Error"}: ${e.message}` });
    }
  }, [previewStream, rawAudio, audioDevices]);

  // Release the test stream when leaving the page.
  useEffect(() => () => previewStream?.getTracks().forEach((t) => t.stop()), [previewStream]);

  /* ------------------------------------------------------- primary action */
  type PrimaryAction = {
    label: string;
    onClick: () => void;
    disabled?: boolean;
    tone?: "primary" | "default";
  } | null;
  const primary = useMemo((): PrimaryAction => {
    if (view.busy) return { label: view.label, onClick: () => {}, disabled: true };
    if (view.canStop) {
      return { label: session.hasRoom ? "Pause" : "Stop", onClick: () => void handleStop(), tone: "default" as const };
    }
    if (view.canStart) {
      return {
        label: mode === "original" ? "Start original audio" : "Start translation",
        onClick: () => void handleStart(),
      };
    }
    if (view.canOpenRoom) return { label: "Open room", onClick: () => void handleOpenRoom() };
    return null;
  }, [view, session.hasRoom, mode, handleStop, handleStart, handleOpenRoom]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && el.closest("input, textarea, select, button, a, [role=radio], [contenteditable=true]")) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.code === "Space") {
        if (primary && !primary.disabled) {
          e.preventDefault();
          primary.onClick();
        }
      } else if (e.key === "m" || e.key === "M") {
        if (telemetryRef.current?.snapshot().running) handleMark();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [primary, handleMark]);

  const copy = useCallback(async (which: "event" | "room") => {
    const url = which === "event" ? eventUrl : roomUrl;
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(which);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      // ignore
    }
  }, [eventUrl, roomUrl]);

  /* -------------------------------------------------------------- model */
  const live = session.phase === "live";
  const onAirMs = session.liveSince ? now - session.liveSince : 0;
  const uptimeMs = telemetrySnapshot?.running ? telemetrySnapshot.uptimeMs : 0;
  const remoteOthers = remote.filter((r) => r.code !== targetLanguage);
  const remoteListeners = remoteOthers.reduce((n, r) => n + (r.status?.listeners ?? 0), 0);
  const listenersTotal = participantCount + remoteListeners;
  const inputLabel =
    audioDevices.inputs.find((d) => d.deviceId === audioDevices.selectedInput)?.label ??
    AUDIO_DEFAULTS.inputLabel;
  const inputActive = inputLevel.active;

  const alert: AlertModel | null = (() => {
    if (session.error) {
      const c = describeOperatorError(session.error.scope, session.error.message);
      return {
        severity: "fault",
        title: c.title,
        body: c.fix,
        detail: c.detail,
        actions: (
          <>
            {view.canStart ? (
              <Button tone="primary" onClick={() => void handleStart()} testId="alert-retry">
                Retry
              </Button>
            ) : view.canOpenRoom ? (
              <Button tone="primary" onClick={() => void handleOpenRoom()} testId="alert-retry">
                Retry
              </Button>
            ) : null}
            <Button tone="ghost" onClick={() => dispatch({ type: "dismiss" })} testId="alert-dismiss">
              Dismiss
            </Button>
          </>
        ),
      };
    }
    if (publisherStatus === "reconnecting" && session.hasRoom) {
      return {
        severity: "warn",
        title: "Room connection reconnecting",
        body: "Listeners hear silence until the connection returns. It retries on its own.",
      };
    }
    if (session.phase === "reconnecting" && session.reconnect) {
      return {
        severity: "warn",
        title: `${langLabel} is reconnecting, attempt ${session.reconnect.attempt} of ${session.reconnect.max}`,
        body: `${participantCount} ${participantCount === 1 ? "listener hears" : "listeners hear"} silence. It retries on its own; Pause and Start restart it by hand.`,
      };
    }
    if (live && inputActive && inputLevel.silentMs > INPUT_SILENCE_ALERT_MS) {
      return {
        severity: "warn",
        title: `No input signal for ${Math.round(inputLevel.silentMs / 1000)} s`,
        body: "Check the speaker's microphone and cable, or change the input.",
        actions: (
          <Button tone="warn" onClick={() => setShowInputPicker(true)}>
            Change input
          </Button>
        ),
      };
    }
    if (
      live &&
      mode === "translate" &&
      outputLevel.active &&
      outputLevel.silentMs > OUTPUT_SILENCE_ALERT_MS &&
      inputLevel.silentMs < 2000
    ) {
      return {
        severity: "warn",
        title: `No translated audio for ${Math.round(outputLevel.silentMs / 1000)} s`,
        body: "The input has signal. Output usually resumes at the next phrase; Pause and Start restart the engine.",
      };
    }
    if (live && inputLevel.clipping) {
      return {
        severity: "warn",
        title: "Input clipping",
        body: "Lower the gain at the mixer or on the audio interface.",
      };
    }
    return null;
  })();

  const localTally: { tone: TallyTone; text: string } = (() => {
    switch (session.phase) {
      case "live":
        return mode === "original" ? { tone: "original", text: "Original" } : { tone: "onair", text: "On air" };
      case "reconnecting":
        return { tone: "warn", text: view.label };
      case "starting":
      case "opening":
      case "stopping":
      case "closing":
        return { tone: "warn", text: view.label };
      case "room-open":
        return { tone: "standby", text: session.everLive ? "Paused" : "Standby" };
      case "failed":
        return { tone: "fault", text: "Fault" };
      default:
        return { tone: "off", text: "Off" };
    }
  })();

  const inputStrip: StripModel = {
    key: "input",
    code: micStream ? (rawAudio ? "Raw audio" : "Browser processing on") : previewStream ? "Input test" : "Not captured",
    label: inputLabel.length > 28 ? `${inputLabel.slice(0, 27)}…` : inputLabel,
    tally: !inputActive
      ? { tone: "off", text: "No capture" }
      : inputLevel.silentMs > INPUT_SILENCE_ALERT_MS
        ? { tone: "warn", text: "No signal" }
        : inputLevel.clipping
          ? { tone: "warn", text: "Clipping" }
          : { tone: "onair", text: "Signal ok" },
    level: inputActive ? inputLevel.level : null,
    stats: [
      { label: "Peak", value: inputActive ? formatDb(inputLevel.peakDb) : "None" },
      { label: "Clip", value: inputLevel.clipping ? "Yes" : "None", tone: inputLevel.clipping ? "warn" : undefined },
      {
        label: "Last speech",
        value: !inputActive ? "None" : inputLevel.silentMs < 1500 ? "Now" : `${Math.round(inputLevel.silentMs / 1000)} s ago`,
        tone: inputActive && inputLevel.silentMs > INPUT_SILENCE_ALERT_MS ? "warn" : undefined,
      },
    ],
    meta: !inputActive
      ? "Not captured"
      : `${inputLevel.silentMs < 1500 ? "Speaking" : `Silent ${Math.round(inputLevel.silentMs / 1000)} s`} · peak ${formatDb(inputLevel.peakDb)}`,
    fault: inputActive && live && inputLevel.silentMs > INPUT_SILENCE_ALERT_MS,
    actions: (
      <>
        <Button size="sm" onClick={() => setShowInputPicker((v) => !v)} ariaPressed={showInputPicker}>
          Change input
        </Button>
        <Button
          size="sm"
          tone={monitor === "source" ? "live" : "ghost"}
          ariaPressed={monitor === "source"}
          onClick={() => setMonitor((m) => (m === "source" ? "program" : "source"))}
          disabled={!micStream}
        >
          {monitor === "source" ? "Listening" : "Listen"}
        </Button>
      </>
    ),
  };

  const responseText =
    mode === "original" ? "Original audio" : secs(latencyMs) ?? (live ? "Measuring" : "Not measured");

  const localStrip: StripModel = {
    key: targetLanguage,
    code: targetLanguage,
    label: mode === "original" ? `${langLabel}, original audio` : langLabel,
    lang: targetLanguage,
    tally: localTally,
    level: outputLevel.active ? outputLevel.level : null,
    stats: [
      { label: "Response", value: responseText, tone: mode === "original" || latencyMs == null ? "dim" : undefined },
      { label: "Listeners", value: LIVEKIT_ENABLED ? String(participantCount) : "No room" },
      { label: "On air", value: session.liveSince ? clockOf(onAirMs) : "Off", tone: session.liveSince ? undefined : "dim" },
    ],
    meta: [
      LIVEKIT_ENABLED ? `${participantCount} listening` : "No room server",
      mode === "original" ? "speaker audio" : latencyMs != null ? `${secs(latencyMs)} response` : null,
    ]
      .filter(Boolean)
      .join(" · "),
    fault: session.phase === "reconnecting" || session.phase === "failed",
    actions: (
      <>
        <Button
          size="sm"
          tone={monitor === "program" ? "live" : "default"}
          ariaPressed={monitor === "program"}
          onClick={() => setMonitor((m) => (m === "program" ? "mute" : "program"))}
          testId="monitor-local"
        >
          {monitor === "program" ? "Monitoring" : "Monitor"}
        </Button>
        {view.canStop ? (
          <Button size="sm" onClick={() => void handleStop()}>
            {session.hasRoom ? "Pause" : "Stop"}
          </Button>
        ) : view.canStart ? (
          <Button size="sm" onClick={() => void handleStart()}>
            Start
          </Button>
        ) : null}
      </>
    ),
  };

  const remoteStrips: StripModel[] = remoteOthers.map((r) => {
    const st = r.status?.state;
    const original = r.status?.mode === "original";
    const tally: { tone: TallyTone; text: string } =
      st === "live" || !st
        ? original
          ? { tone: "original", text: "Original" }
          : { tone: "onair", text: "On air" }
        : st === "reconnecting"
          ? { tone: "warn", text: "Reconnecting" }
          : st === "interrupted"
            ? { tone: "fault", text: "Interrupted" }
            : st === "paused"
              ? { tone: "standby", text: "Paused" }
              : { tone: "standby", text: "Standby" };
    const since = r.status?.sinceMs ?? null;
    return {
      key: r.code,
      code: r.code,
      label: original ? `${r.label}, original audio` : r.label,
      lang: r.code,
      tally,
      level: null,
      levelNote: "Level metered in its own tab",
      stats: [
        { label: "Response", value: original ? "Original audio" : secs(r.status?.responseMs) ?? "Not reported", tone: "dim" },
        { label: "Listeners", value: String(r.status?.listeners ?? 0) },
        { label: "On air", value: since ? clockOf(now - since) : "Off", tone: since ? undefined : "dim" },
      ],
      meta: `${r.status?.listeners ?? 0} listening${r.status?.responseMs ? ` · ${secs(r.status.responseMs)} response` : ""} · other tab`,
      fault: st === "reconnecting" || st === "interrupted",
      source: "Room server, refreshed every 5 s",
      actions: (
        <a
          href={`/listen/${encodeURIComponent(r.room)}`}
          target="_blank"
          rel="noopener"
          className={buttonClass("ghost", "sm")}
        >
          Monitor
        </a>
      ),
    };
  });

  const listenersSee: ListenerPreview[] = [];
  if (broadcast) {
    const key = BROADCAST_TO_DISPLAY[broadcast];
    const s = LISTENER_STRINGS[uiLangForRoom(targetLanguage)].status[key];
    listenersSee.push({
      code: targetLanguage,
      text: s.tally,
      tone: broadcast === "live" ? "ok" : broadcast === "reconnecting" || broadcast === "interrupted" ? "warn" : "dim",
      lang: uiLangForRoom(targetLanguage),
    });
  }
  for (const r of remoteOthers) {
    const st = (r.status?.state ?? "live") as BroadcastState;
    const key = BROADCAST_TO_DISPLAY[st] ?? "live";
    listenersSee.push({
      code: r.code,
      text: LISTENER_STRINGS[uiLangForRoom(r.code)].status[key].tally,
      tone: st === "live" ? "ok" : st === "reconnecting" || st === "interrupted" ? "warn" : "dim",
      lang: uiLangForRoom(r.code),
    });
  }

  const usedCodes = new Set([targetLanguage, ...remoteOthers.map((r) => r.code)]);
  const addable = TARGET_LANGUAGES.filter((l) => !usedCodes.has(l.code));
  const addCode = addable.some((l) => l.code === addLang) ? addLang : (addable[0]?.code ?? "");
  const addHref = `/operator?event=${encodeURIComponent(eventSlug)}&lang=${encodeURIComponent(addCode)}${
    eventTitle.trim() ? `&title=${encodeURIComponent(eventTitle.trim())}` : ""
  }`;

  const sourceLines = captionLines(source);
  const targetLines = captionLines(target);

  const model: OperatorModel = {
    input: inputStrip,
    channels: [localStrip, ...remoteStrips],
    alert,
    okLine: live ? "Input, output and room checked continuously" : "Input and room checked continuously",
    source:
      mode === "translate" && captureSource
        ? {
            title: "Source",
            badge: { text: inputLabel, tone: "dim" },
            lines: sourceLines,
            lang: "und",
            placeholder: "The speaker's words appear here.",
          }
        : null,
    target:
      mode === "original"
        ? {
            title: `${targetLanguage.toUpperCase()} · ${langLabel}, original audio`,
            badge: monitor === "program" ? { text: "In your headphones", tone: "ok" } : null,
            lines: [],
            lang: targetLanguage,
            placeholder: "Original audio channel: the speaker's audio goes to listeners as is, without a transcript.",
          }
        : {
            title: `${targetLanguage.toUpperCase()} · ${langLabel}`,
            badge: monitor === "program" ? { text: "In your headphones", tone: "ok" } : null,
            lines: targetLines,
            lang: targetLanguage,
            placeholder: live ? "Translation appears here." : "Translation appears here once it starts.",
          },
    qr:
      LIVEKIT_ENABLED && session.hasRoom && eventUrl
        ? {
            url: eventUrl,
            caption: `One code for every language of this event${
              remoteOthers.length ? ` (${[targetLanguage, ...remoteOthers.map((r) => r.code)].map((c) => c.toUpperCase()).join(", ")})` : ""
            }`,
            actions: (
              <>
                <Button size="sm" onClick={() => void copy("event")}>
                  {copied === "event" ? "Copied" : "Copy link"}
                </Button>
                <Button size="sm" tone="ghost" onClick={() => void copy("room")} title={roomUrl}>
                  {copied === "room" ? "Copied" : `Copy ${targetLanguage.toUpperCase()} link`}
                </Button>
              </>
            ),
          }
        : null,
    listenersSee,
    addLanguage:
      LIVEKIT_ENABLED && session.hasRoom && addable.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-sm text-silk">
            <span>Add language</span>
            <select
              value={addCode}
              onChange={(e) => setAddLang(e.target.value)}
              className="min-h-11 rounded-md border border-btn-line bg-panel px-2 text-[15px] text-ink"
            >
              {addable.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label} ({l.code})
                </option>
              ))}
            </select>
          </label>
          <a href={addHref} target="_blank" rel="noopener" className={buttonClass("default", "sm")} data-testid="add-language">
            Open in a new tab
          </a>
          <p className="w-full text-xs text-silk">Each language runs in its own operator tab with the same event ID.</p>
        </div>
      ) : null,
    log: log.map((e) => ({ at: clockOf(e.atMs), text: e.text })),
  };

  const tallyTone: TallyTone =
    view.tone === "onair"
      ? mode === "original"
        ? "original"
        : "onair"
      : view.tone === "warn" || view.tone === "busy"
        ? "warn"
        : view.tone === "fault"
          ? "fault"
          : view.tone === "standby"
            ? "standby"
            : "off";

  const statusLine =
    session.phase === "failed" && session.error
      ? `Fault: ${describeOperatorError(session.error.scope, session.error.message).title}`
      : view.label;

  return (
    <div className="flex flex-1 flex-col" data-testid="operator">
      <SessionBar
        tally={{ tone: tallyTone, text: view.label }}
        clock={clockOf(session.liveSince ? onAirMs : uptimeMs)}
        title={eventTitle.trim() || "Untitled event"}
        subtitle={`Event ${eventSlug} · ${langLabel}${mode === "original" ? " original audio" : ""}`}
        figures={[
          { label: "Listeners", value: LIVEKIT_ENABLED ? String(listenersTotal) : "None" },
          { label: "Billing", value: `$${(telemetrySnapshot?.estCostUsd ?? 0).toFixed(2)}` },
          { label: "Faults", value: String(telemetrySnapshot?.errors ?? 0), tone: (telemetrySnapshot?.errors ?? 0) > 0 ? "warn" : undefined },
        ]}
        actions={
          <SessionActions
            canMark={Boolean(telemetrySnapshot?.running)}
            onMark={handleMark}
            primary={primary}
            end={view.canClose ? { label: "End session", onClick: () => setConfirmEnd(true) } : null}
          />
        }
      />
      <p role="status" aria-live="polite" className="sr-only" data-testid="operator-status-live">
        {statusLine}
      </p>

      <main className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col gap-5 px-4 py-5">
        {confirmEnd ? (
          <div
            role="alertdialog"
            aria-labelledby="end-title"
            className="flex flex-wrap items-center gap-3 rounded-md border border-error-ink bg-error-wash px-5 py-4"
          >
            <p id="end-title" className="flex-1 text-base text-ink">
              <b>End the session?</b> Every listener of {targetLanguage.toUpperCase()} is disconnected and the session report is written.
            </p>
            <Button tone="primary" onClick={() => void handleClose()} testId="confirm-end">
              End session
            </Button>
            <Button tone="ghost" onClick={() => setConfirmEnd(false)}>
              Cancel
            </Button>
          </div>
        ) : null}

        {view.canConfigure ? (
          <SetupPanel
            eventId={eventId}
            setEventId={setEventId}
            eventTitle={eventTitle}
            setEventTitle={setEventTitle}
            targetLanguage={targetLanguage}
            setTargetLanguage={setTargetLanguage}
            mode={mode}
            setMode={setMode}
            captureSource={captureSource}
            setCaptureSource={setCaptureSource}
            rawAudio={rawAudio}
            setRawAudio={setRawAudio}
            listenerBaseUrl={listenerBaseUrl}
            setListenerBaseUrl={setListenerBaseUrl}
            audioDevices={audioDevices}
            testing={Boolean(previewStream)}
            onTest={() => void toggleTest()}
            inputLevel={previewStream ? inputLevel.level : null}
            primary={primary}
            alert={alert}
            room={room}
          />
        ) : null}

        {showInputPicker ? (
          <section className="flex flex-wrap items-end gap-3 rounded-md border border-line bg-panel p-4" aria-label="Change input">
            <DeviceSelect
              label="Input"
              value={audioDevices.selectedInput}
              onChange={audioDevices.setSelectedInput}
              defaultLabel={AUDIO_DEFAULTS.inputLabel}
              devices={audioDevices.inputs}
            />
            <Button size="sm" onClick={() => void audioDevices.requestPermission()}>
              {audioDevices.hasPermission ? "Refresh devices" : "Detect devices"}
            </Button>
            <p className="text-sm text-silk">
              {micStream ? "A new input applies at the next Start." : "Applies when translation starts."}
            </p>
            <Button size="sm" tone="ghost" onClick={() => setShowInputPicker(false)} className="ml-auto">
              Close
            </Button>
          </section>
        ) : null}

        {!view.canConfigure ? <OperatorBody model={model} /> : null}

        <details className="rounded-md border border-line bg-panel">
          <summary className="flex min-h-12 cursor-pointer items-center px-4 font-semibold text-ink">
            Session details and audio routing
          </summary>
          <div className="flex flex-col gap-4 border-t border-line p-4">
            <div className="flex flex-wrap items-end gap-4">
              <DeviceSelect
                label={`Monitor output${audioDevices.outputSupported ? "" : " (not supported in this browser)"}`}
                value={audioDevices.selectedOutput}
                onChange={audioDevices.setSelectedOutput}
                defaultLabel={AUDIO_DEFAULTS.outputLabel}
                devices={audioDevices.outputs}
                disabled={!audioDevices.outputSupported}
              />
              <Segmented
                label="Monitor"
                value={monitor}
                onChange={setMonitor}
                options={[
                  { value: "program", label: mode === "original" ? "Program" : "Translation" },
                  { value: "source", label: "Input" },
                  { value: "mute", label: "Mute" },
                ]}
              />
              <Check
                checked={broadcastToTab}
                onChange={setBroadcastToTab}
                label="Copy the translation to tab audio"
                hint="For screen sharing while the monitor goes to a specific output"
              />
            </div>
            <TelemetryPanel snapshot={telemetrySnapshot} savedBenchmarkPath={savedBenchmarkPath} />
            <p className="text-sm text-silk">
              Session reports and recordings are written to benchmarks/ on this machine when the session ends.
              {telemetrySnapshot?.running ? ` Running for ${formatDuration(telemetrySnapshot.uptimeMs)}.` : ""}
            </p>
          </div>
        </details>

        <p className="text-sm text-silk">
          Listener pages: <Link className="underline underline-offset-4" href={`/e/${eventSlug}`}>event page</Link>
          {" · "}
          <Link className="underline underline-offset-4" href={`/listen/${room}`}>{targetLanguage.toUpperCase()} only</Link>
          {" · "}
          <Link className="underline underline-offset-4" href="/replay/operator">replay demo</Link>
        </p>

        <audio ref={sourceAudioRef} autoPlay playsInline muted />
        <audio ref={programAudioRef} autoPlay playsInline />
        {/* Plays at the system default device so tab capture hears the
            translation while the monitor goes to a specific output. */}
        <audio ref={broadcastAudioRef} autoPlay playsInline />
      </main>
    </div>
  );
}

/* ------------------------------------------------------------------ setup */

type AudioDevicesApi = ReturnType<typeof useAudioDevices>;

function DeviceSelect({
  label,
  value,
  onChange,
  defaultLabel,
  devices,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  defaultLabel: string;
  devices: AudioDevicesApi["inputs"];
  disabled?: boolean;
}) {
  return (
    <label className="flex min-w-56 flex-col gap-1.5">
      <span className="text-sm font-medium text-silk">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="min-h-11 rounded-md border border-btn-line bg-panel px-3 text-[15px] text-ink disabled:opacity-50"
      >
        <option value="">{defaultLabel}</option>
        {devices.map((d) => (
          <option key={d.deviceId} value={d.deviceId}>
            {d.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5">
      <span className="text-sm font-medium text-silk">{label}</span>
      {children}
      {hint ? <span className="text-sm text-silk">{hint}</span> : null}
    </label>
  );
}

function Check({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <label className="flex min-h-11 cursor-pointer items-start gap-3">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--green)]"
      />
      <span>
        <span className="block text-[15px] font-medium text-ink">{label}</span>
        {hint ? <span className="block text-sm text-silk">{hint}</span> : null}
      </span>
    </label>
  );
}

const inputClass =
  "min-h-11 rounded-md border border-btn-line bg-panel px-3 text-[15px] text-ink placeholder:text-dim";

function SetupPanel(p: {
  eventId: string;
  setEventId: (v: string) => void;
  eventTitle: string;
  setEventTitle: (v: string) => void;
  targetLanguage: string;
  setTargetLanguage: (v: string) => void;
  mode: ChannelMode;
  setMode: (v: ChannelMode) => void;
  captureSource: boolean;
  setCaptureSource: (v: boolean) => void;
  rawAudio: boolean;
  setRawAudio: (v: boolean) => void;
  listenerBaseUrl: string;
  setListenerBaseUrl: (v: string) => void;
  audioDevices: AudioDevicesApi;
  testing: boolean;
  onTest: () => void;
  inputLevel: number | null;
  primary: { label: string; onClick: () => void; disabled?: boolean } | null;
  alert: AlertModel | null;
  room: string;
}) {
  return (
    <section className="flex flex-col gap-5" aria-label="Setup" data-testid="setup">
      {p.alert ? <AlertBox alert={p.alert} /> : null}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-4 rounded-md border border-line bg-panel p-5">
          <h2 className="font-cond text-xl font-semibold text-ink">Event and channel</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Event ID" hint={`Room ${p.room}`}>
              <input
                type="text"
                value={p.eventId}
                onChange={(e) => p.setEventId(e.target.value)}
                placeholder="demo"
                className={inputClass}
              />
            </Field>
            <Field label="Event title" hint="Shown to listeners">
              <input
                type="text"
                value={p.eventTitle}
                onChange={(e) => p.setEventTitle(e.target.value.slice(0, 120))}
                placeholder="Rice University address"
                className={inputClass}
              />
            </Field>
            <Field label="Language">
              <select
                value={p.targetLanguage}
                onChange={(e) => p.setTargetLanguage(e.target.value)}
                className={inputClass}
              >
                {TARGET_LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.label} ({l.code})
                  </option>
                ))}
              </select>
            </Field>
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-silk">Channel</span>
              <Segmented
                label="Channel"
                hideLabel
                value={p.mode}
                onChange={p.setMode}
                options={[
                  { value: "translate", label: "Translation" },
                  { value: "original", label: "Original audio" },
                ]}
              />
              <span className="text-sm text-silk">
                {p.mode === "original"
                  ? "The speaker's audio as is, for listeners of the source language. No engine cost."
                  : "Speech translated into the language above."}
              </span>
            </div>
          </div>
          {p.mode === "translate" ? (
            <Check
              checked={p.captureSource}
              onChange={p.setCaptureSource}
              label="Show the speaker's original words"
              hint="Adds a source transcript; raises the engine cost by about 50 %"
            />
          ) : null}
          <Field label="Listener base URL" hint="Reachable from phones, not localhost. Used for the QR code.">
            <input
              type="text"
              value={p.listenerBaseUrl}
              onChange={(e) => p.setListenerBaseUrl(e.target.value.trim().replace(/\/+$/, ""))}
              placeholder="http://192.168.1.50:3000"
              className={`${inputClass} font-mono text-sm`}
            />
          </Field>
        </div>

        <div className="flex flex-col gap-4 rounded-md border border-line bg-panel p-5">
          <h2 className="font-cond text-xl font-semibold text-ink">Input</h2>
          <DeviceSelect
            label="Microphone or line input"
            value={p.audioDevices.selectedInput}
            onChange={p.audioDevices.setSelectedInput}
            defaultLabel={AUDIO_DEFAULTS.inputLabel}
            devices={p.audioDevices.inputs}
          />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={p.onTest} ariaPressed={p.testing} testId="test-input">
              {p.testing ? "Stop input test" : "Test input"}
            </Button>
            <Button size="sm" tone="ghost" onClick={() => void p.audioDevices.requestPermission()}>
              {p.audioDevices.hasPermission ? "Refresh devices" : "Detect devices"}
            </Button>
          </div>
          <div>
            <HMeter level={p.inputLevel} segments={24} label="Input level" testId="setup-meter" />
            <p className="mt-1.5 text-sm text-silk">
              {p.testing ? "Input test running; speak into the microphone." : "Level appears during the input test."}
            </p>
          </div>
          <Check
            checked={p.rawAudio}
            onChange={p.setRawAudio}
            label="Raw audio"
            hint="Turns off browser echo cancellation, noise suppression and gain control. For clean line-level feeds."
          />
          {p.primary ? (
            <Button
              tone="primary"
              size="lg"
              onClick={p.primary.onClick}
              disabled={p.primary.disabled}
              className="mt-auto"
              testId="setup-primary"
            >
              {p.primary.label}
            </Button>
          ) : null}
          <p className="text-sm text-silk">
            {LIVEKIT_ENABLED
              ? "Open room publishes the QR code; listeners wait there until translation starts. Billing starts with translation."
              : "No room server configured: translation plays on this machine only."}
          </p>
        </div>
      </div>
    </section>
  );
}

function AlertBox({ alert }: { alert: AlertModel }) {
  const fault = alert.severity === "fault";
  return (
    <div
      role="alert"
      data-testid="alert-slot"
      data-state={alert.severity}
      className={`flex flex-wrap items-center gap-4 rounded-md border px-5 py-4 ${
        fault ? "border-error-ink bg-error-wash" : "border-amber bg-amber"
      }`}
    >
      <div className="min-w-0 flex-1">
        <p className={`text-lg font-bold ${fault ? "text-error-ink" : "text-on-amber"}`}>{alert.title}</p>
        <p className={`mt-1 text-[15px] ${fault ? "text-ink" : "text-on-amber"}`}>{alert.body}</p>
        {alert.detail ? <p className="mt-1 break-words font-mono text-[13px] text-silk">Detail: {alert.detail}</p> : null}
      </div>
      {alert.actions ? <div className="flex flex-wrap gap-2">{alert.actions}</div> : null}
    </div>
  );
}
