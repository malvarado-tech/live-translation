"use client";

import { QRCodeSVG } from "qrcode.react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TelemetryPanel } from "@/components/telemetry-panel";
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
import {
  startGeminiSession,
  type GeminiEvent,
  type GeminiSession,
  type GeminiStatus,
} from "@/lib/gemini-live";
import { startPublisher, type Publisher } from "@/lib/livekit-publisher";
import {
  startSession,
  type RealtimeEvent,
  type RealtimeSession,
  type RealtimeStatus,
} from "@/lib/realtime";
import {
  SessionTelemetry,
  type ConnState,
  type EngineId,
  type TelemetrySnapshot,
} from "@/lib/telemetry";

const TARGET_LANGUAGES: Array<{ code: string; label: string }> = [
  { code: "en", label: "English" },
  { code: "es", label: "Español" },
  { code: "pt", label: "Português" },
  { code: "fr", label: "Français" },
  { code: "de", label: "Deutsch" },
  { code: "it", label: "Italiano" },
  { code: "ja", label: "日本語" },
  { code: "ko", label: "한국어" },
  { code: "zh", label: "中文" },
  { code: "ru", label: "Русский" },
  { code: "hi", label: "हिन्दी" },
  { code: "id", label: "Bahasa Indonesia" },
  { code: "vi", label: "Tiếng Việt" },
];

type EngineStatus = RealtimeStatus | GeminiStatus;

const STATUS_LABEL: Record<EngineStatus, string> = {
  idle: "Idle",
  "creating-session": "Creating session…",
  negotiating: "Negotiating…",
  live: "Live",
  closed: "Closed",
  error: "Error",
};

const STATUS_DOT_CLASS: Record<EngineStatus, string> = {
  idle: "bg-zinc-400",
  "creating-session": "bg-amber-400 animate-pulse",
  negotiating: "bg-amber-400 animate-pulse",
  live: "bg-emerald-500 animate-pulse",
  closed: "bg-zinc-400",
  error: "bg-rose-500",
};

type MonitorChoice = "source" | "openai" | "gemini" | "both" | "mute";

/**
 * Session phase:
 *  - idle:        nothing running; operator configures event ID, language, devices
 *  - room-open:   LiveKit room is up, QR/link live, listeners can connect and wait.
 *                 No OpenAI/Gemini sessions → no billing.
 *  - translating: translation sessions running, audio publishing to the room.
 * With LiveKit configured: idle → room-open → translating ⇄ room-open → idle.
 * Without LiveKit: idle ⇄ translating (no room concept).
 */
type SessionPhase = "idle" | "room-open" | "translating";

const LIVEKIT_ENABLED = Boolean(process.env.NEXT_PUBLIC_LIVEKIT_URL);

/** RealtimeStatus / GeminiStatus → telemetry ConnState. */
function toConnState(s: RealtimeStatus | GeminiStatus): ConnState {
  if (s === "creating-session" || s === "negotiating") return "connecting";
  return s;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);
}

export default function OperatorPage() {
  const [eventId, setEventId] = useState("demo");
  const [targetLanguage, setTargetLanguage] = useState("en");
  // The Gemini Live engine is hidden in the UI and this state stays `false`.
  // The engine code is kept in lib/gemini-live.ts.
  const [useGemini] = useState(false);
  const [captureSource, setCaptureSource] = useState(false);
  // When true, disable browser-side echo cancellation / noise suppression /
  // automatic gain control. Default off — those defaults are right for noisy
  // laptop mics. Flip ON for already-clean inputs (VB-Audio Cable, line feed
  // from a venue mixing board) where DSP introduces pumping / clipping
  // artifacts instead of fixing anything.
  const [rawAudio, setRawAudio] = useState(false);
  const [monitor, setMonitor] = useState<MonitorChoice>("openai");
  const [broadcastToTab, setBroadcastToTab] = useState(true);
  const [phase, setPhase] = useState<SessionPhase>("idle");
  const audioDevices = useAudioDevices();

  const [openaiStatus, setOpenaiStatus] = useState<RealtimeStatus>("idle");
  const [geminiStatus, setGeminiStatus] = useState<GeminiStatus>("idle");
  const [publisherStatus, setPublisherStatus] = useState<
    "idle" | "connecting" | "live" | "closed" | "error"
  >("idle");
  const [participantCount, setParticipantCount] = useState(0);

  const [sourceTranscript, setSourceTranscript] = useState("");
  const [openaiTranscript, setOpenaiTranscript] = useState("");
  const [geminiTranscript, setGeminiTranscript] = useState("");
  const [openaiLatencyMs, setOpenaiLatencyMs] = useState<number | null>(null);
  const [geminiLatencyMs, setGeminiLatencyMs] = useState<number | null>(null);
  const [errorMessages, setErrorMessages] = useState<string[]>([]);

  const [listenerBaseUrl, setListenerBaseUrl] = useState<string>("");
  const [copied, setCopied] = useState(false);
  // Set while an auto-reconnect is pending or in flight. Cleared when the
  // session goes back to `live` or `closed`. Displayed as an amber banner so
  // operators see what's happening without it looking like a hard error.
  const [reconnectInfo, setReconnectInfo] = useState<string | null>(null);

  const telemetryRef = useRef<SessionTelemetry | null>(null);
  if (telemetryRef.current === null) {
    telemetryRef.current = new SessionTelemetry();
  }
  const [telemetrySnapshot, setTelemetrySnapshot] =
    useState<TelemetrySnapshot | null>(null);
  const [savedBenchmarkPath, setSavedBenchmarkPath] = useState<string | null>(
    null,
  );

  const openaiAudioRef = useRef<HTMLAudioElement | null>(null);
  const geminiAudioRef = useRef<HTMLAudioElement | null>(null);
  const openaiBroadcastAudioRef = useRef<HTMLAudioElement | null>(null);
  const geminiBroadcastAudioRef = useRef<HTMLAudioElement | null>(null);
  // Mic monitoring — lets the operator hear the raw input audio (to verify
  // the mic is picking up cleanly). Independent of the translation playback.
  const sourceAudioRef = useRef<HTMLAudioElement | null>(null);
  const sourceScrollRef = useRef<HTMLDivElement | null>(null);
  const openaiScrollRef = useRef<HTMLDivElement | null>(null);
  const geminiScrollRef = useRef<HTMLDivElement | null>(null);

  const openaiSessionRef = useRef<RealtimeSession | null>(null);
  const geminiSessionRef = useRef<GeminiSession | null>(null);
  const publisherRef = useRef<Publisher | null>(null);
  const sharedMicRef = useRef<MediaStream | null>(null);

  // MediaRecorder handles — one per stream per Start→Stop cycle. Multiple
  // cycles within a session accumulate into the per-engine Blob arrays.
  const micRecorderRef = useRef<RecorderHandle | null>(null);
  const openaiRecorderRef = useRef<RecorderHandle | null>(null);
  const geminiRecorderRef = useRef<RecorderHandle | null>(null);
  const recordingsRef = useRef<{
    mic: Blob[];
    openai: Blob[];
    gemini: Blob[];
    mimeType: string;
  }>({ mic: [], openai: [], gemini: [], mimeType: "audio/webm" });

  useEffect(() => {
    // Prefer the configured LAN base URL so the QR/link work on phones
    // regardless of whether the operator opened this on localhost or the LAN IP.
    // Fall back to however they navigated here.
    const configured = process.env.NEXT_PUBLIC_LISTENER_BASE_URL;
    const base = (configured || window.location.origin).replace(/\/+$/, "");
    setListenerBaseUrl(base);
  }, []);

  // Poll the telemetry recorder once a second for the live panel.
  useEffect(() => {
    const interval = setInterval(() => {
      if (telemetryRef.current) {
        setTelemetrySnapshot(telemetryRef.current.snapshot());
      }
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (sourceScrollRef.current) {
      sourceScrollRef.current.scrollTop =
        sourceScrollRef.current.scrollHeight;
    }
  }, [sourceTranscript]);
  useEffect(() => {
    if (openaiScrollRef.current) {
      openaiScrollRef.current.scrollTop =
        openaiScrollRef.current.scrollHeight;
    }
  }, [openaiTranscript]);
  useEffect(() => {
    if (geminiScrollRef.current) {
      geminiScrollRef.current.scrollTop =
        geminiScrollRef.current.scrollHeight;
    }
  }, [geminiTranscript]);

  // Apply monitor selection to audio sinks.
  // Primary sinks play at the selected output device (or system default).
  // Broadcast sinks always play at system default; they exist to feed tab audio
  // when the primary sink is routed to a non-default device. Muted when the
  // broadcastToTab toggle is off OR when the user is already on the default
  // device (the primary already provides tab audio in that case).
  useEffect(() => {
    const shouldHearSource = monitor === "source";
    const shouldHearOpenai = monitor === "openai" || monitor === "both";
    const shouldHearGemini = monitor === "gemini" || monitor === "both";
    const usingSpecificOutput = Boolean(audioDevices.selectedOutput);

    if (sourceAudioRef.current) {
      sourceAudioRef.current.muted = !shouldHearSource;
    }
    if (openaiAudioRef.current) {
      openaiAudioRef.current.muted = !shouldHearOpenai;
    }
    if (geminiAudioRef.current) {
      geminiAudioRef.current.muted = !shouldHearGemini;
    }
    if (openaiBroadcastAudioRef.current) {
      openaiBroadcastAudioRef.current.muted =
        !broadcastToTab || !shouldHearOpenai || !usingSpecificOutput;
    }
    if (geminiBroadcastAudioRef.current) {
      geminiBroadcastAudioRef.current.muted =
        !broadcastToTab || !shouldHearGemini || !usingSpecificOutput;
    }
  }, [monitor, broadcastToTab, audioDevices.selectedOutput]);

  // Route audio output to the selected device (Chrome/Edge/Firefox only).
  // Only the PRIMARY sinks get setSinkId; broadcast sinks always use the default.
  useEffect(() => {
    if (!audioDevices.outputSupported) return;
    void applySinkId(sourceAudioRef.current, audioDevices.selectedOutput);
    void applySinkId(openaiAudioRef.current, audioDevices.selectedOutput);
    void applySinkId(geminiAudioRef.current, audioDevices.selectedOutput);
  }, [audioDevices.selectedOutput, audioDevices.outputSupported]);

  const room = useMemo(() => {
    const slug = slugify(eventId || "demo");
    return `${slug}-${targetLanguage}`;
  }, [eventId, targetLanguage]);

  const listenerUrl = useMemo(() => {
    const base = listenerBaseUrl.replace(/\/+$/, "");
    if (!base) return "";
    return `${base}/listen/${room}`;
  }, [listenerBaseUrl, room]);

  const targetLanguageLabel = useMemo(
    () =>
      TARGET_LANGUAGES.find((l) => l.code === targetLanguage)?.label ??
      targetLanguage,
    [targetLanguage],
  );

  const pushError = useCallback((scope: string, message: string) => {
    setErrorMessages((prev) => [...prev, `${scope}: ${message}`]);
  }, []);

  const handleOpenaiEvent = useCallback((event: RealtimeEvent) => {
    const tel = telemetryRef.current;
    switch (event.type) {
      case "status":
        setOpenaiStatus(event.status);
        tel?.recordConnState("openai", toConnState(event.status));
        // Clear the auto-reconnect banner once we're definitively back to a
        // steady state (or fully closed).
        if (event.status === "live" || event.status === "closed") {
          setReconnectInfo(null);
        }
        break;
      case "source-transcript":
        setSourceTranscript((prev) => prev + event.delta);
        tel?.recordTranscript("openai", "source", event.delta);
        break;
      case "translated-transcript":
        setOpenaiTranscript((prev) => prev + event.delta);
        tel?.recordActivity("openai");
        tel?.recordTranscript("openai", "translated", event.delta);
        // Fan the caption out to listeners over the LiveKit data channel.
        // No-op in no-LiveKit mode (publisherRef is null).
        if (publisherRef.current) {
          void publisherRef.current.publishCaption(event.delta);
        }
        break;
      case "first-audio-received":
        setOpenaiLatencyMs(event.latencyMs);
        tel?.recordLatency("openai", event.latencyMs);
        break;
      case "token-expiry":
        tel?.recordTokenExpiry("openai", event.expiresAtMs);
        break;
      case "reconnect":
        setReconnectInfo(
          `Auto-reconnecting OpenAI (attempt ${event.attempt}/3, in ${Math.round(event.delayMs / 1000)}s)…`,
        );
        tel?.recordReconnect("openai", event.attempt, event.delayMs);
        break;
      case "error":
        pushError("OpenAI", event.message);
        tel?.recordError("OpenAI", event.message);
        break;
    }
  }, [pushError]);

  const handleGeminiEvent = useCallback((event: GeminiEvent) => {
    const tel = telemetryRef.current;
    switch (event.type) {
      case "status":
        setGeminiStatus(event.status);
        tel?.recordConnState("gemini", toConnState(event.status));
        break;
      case "source-transcript":
        // Gemini also emits source transcript; show it only if OpenAI didn't.
        setSourceTranscript((prev) => prev || event.delta);
        tel?.recordTranscript("gemini", "source", event.delta);
        break;
      case "translated-transcript":
        setGeminiTranscript((prev) => prev + event.delta);
        tel?.recordActivity("gemini");
        tel?.recordTranscript("gemini", "translated", event.delta);
        break;
      case "first-audio-received":
        setGeminiLatencyMs(event.latencyMs);
        tel?.recordLatency("gemini", event.latencyMs);
        break;
      case "token-expiry":
        tel?.recordTokenExpiry("gemini", event.expiresAtMs);
        break;
      case "error":
        pushError("Gemini", event.message);
        tel?.recordError("Gemini", event.message);
        break;
    }
  }, [pushError]);

  const handleMark = useCallback(() => {
    telemetryRef.current?.recordMark();
    // Force a snapshot refresh so the panel shows the new count immediately.
    setTelemetrySnapshot(telemetryRef.current?.snapshot() ?? null);
  }, []);

  /** Stop any active per-stream recorders and stash their Blobs. */
  const stopSegmentRecorders = useCallback(async () => {
    const recs = recordingsRef.current;
    const stops: Promise<void>[] = [];
    const mic = micRecorderRef.current;
    const openai = openaiRecorderRef.current;
    const gemini = geminiRecorderRef.current;
    micRecorderRef.current = null;
    openaiRecorderRef.current = null;
    geminiRecorderRef.current = null;
    if (mic) {
      recs.mimeType = mic.mimeType;
      stops.push(
        mic.stop().then((blob) => {
          if (blob) recs.mic.push(blob);
        }),
      );
    }
    if (openai) {
      recs.mimeType = openai.mimeType;
      stops.push(
        openai.stop().then((blob) => {
          if (blob) recs.openai.push(blob);
        }),
      );
    }
    if (gemini) {
      recs.mimeType = gemini.mimeType;
      stops.push(
        gemini.stop().then((blob) => {
          if (blob) recs.gemini.push(blob);
        }),
      );
    }
    await Promise.allSettled(stops);
  }, []);

  // Start the telemetry recorder if it isn't already running. Called from
  // handleOpenRoom (LiveKit flow) or handleStartTranslation (no-LiveKit flow) —
  // whichever begins the session.
  const startTelemetryIfNeeded = useCallback(() => {
    const tel = telemetryRef.current;
    if (!tel || tel.snapshot().running) return;
    const engines: EngineId[] = useGemini ? ["openai", "gemini"] : ["openai"];
    tel.start({
      eventId: slugify(eventId || "demo"),
      targetLanguage,
      engines,
      captureSource,
    });
    // Fresh session = fresh per-engine recording buffers.
    recordingsRef.current = {
      mic: [],
      openai: [],
      gemini: [],
      mimeType: "audio/webm",
    };
    setSavedBenchmarkPath(null);
    setTelemetrySnapshot(tel.snapshot());
  }, [useGemini, eventId, targetLanguage, captureSource]);

  // Finalize telemetry and write the benchmark to benchmarks/{stamp}/.
  // If audio recordings were captured this session, upload as multipart so the
  // server writes audio + SRT/VTT alongside the JSON/Markdown report.
  const finalizeTelemetry = useCallback(async () => {
    const tel = telemetryRef.current;
    if (!tel) return;
    tel.stop();
    setTelemetrySnapshot(tel.snapshot());
    const report = tel.report();
    const recs = recordingsRef.current;
    const hasAudio =
      recs.mic.length > 0 || recs.openai.length > 0 || recs.gemini.length > 0;
    try {
      let resp: Response;
      if (hasAudio) {
        const form = new FormData();
        form.append("report", JSON.stringify(report));
        const ext = mimeToExtension(recs.mimeType);
        form.append("extension", ext);
        recs.mic.forEach((b, i) =>
          form.append(`audio-mic-${i + 1}`, b, `audio-mic-${i + 1}.${ext}`),
        );
        recs.openai.forEach((b, i) =>
          form.append(
            `audio-openai-${i + 1}`,
            b,
            `audio-openai-${i + 1}.${ext}`,
          ),
        );
        recs.gemini.forEach((b, i) =>
          form.append(
            `audio-gemini-${i + 1}`,
            b,
            `audio-gemini-${i + 1}.${ext}`,
          ),
        );
        resp = await fetch("/api/save-benchmark", {
          method: "POST",
          body: form,
        });
      } else {
        resp = await fetch("/api/save-benchmark", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(report),
        });
      }
      const data = (await resp.json()) as {
        markdown?: string;
        folder?: string;
        error?: string;
      };
      if (resp.ok) {
        setSavedBenchmarkPath(data.folder ?? data.markdown ?? "(saved)");
      } else if (data.error) {
        pushError("Benchmark", data.error);
      }
    } catch (err) {
      pushError(
        "Benchmark",
        err instanceof Error ? err.message : String(err),
      );
    }
  }, [pushError]);

  // Phase 1 — connect to the LiveKit room (creates it, holds it open). The
  // QR/link become live; listeners can connect and wait. No translation yet.
  const handleOpenRoom = useCallback(async () => {
    setErrorMessages([]);
    setParticipantCount(0);
    startTelemetryIfNeeded();
    try {
      publisherRef.current = await startPublisher({
        room,
        onEvent: (e) => {
          const tel = telemetryRef.current;
          if (e.type === "status") {
            setPublisherStatus(e.status);
            tel?.recordConnState("livekit", e.status);
          } else if (e.type === "participant-count") {
            setParticipantCount(e.count);
            tel?.recordListenerCount(e.count);
          } else if (e.type === "error") {
            pushError("LiveKit", e.message);
            tel?.recordError("LiveKit", e.message);
          }
        },
      });
      setPhase("room-open");
    } catch (err) {
      publisherRef.current = null;
      pushError(
        "LiveKit",
        err instanceof Error ? err.message : String(err),
      );
    }
  }, [room, startTelemetryIfNeeded, pushError]);

  // Phase 2 — open the translation sessions and publish audio into the room.
  // Works both from room-open (LiveKit flow) and straight from idle (no-LiveKit).
  const handleStartTranslation = useCallback(async () => {
    setSourceTranscript("");
    setOpenaiTranscript("");
    setGeminiTranscript("");
    setOpenaiLatencyMs(null);
    setGeminiLatencyMs(null);
    setErrorMessages([]);
    startTelemetryIfNeeded(); // no-op if handleOpenRoom already started it

    let micStream: MediaStream | null = null;
    try {
      const audioConstraints: MediaTrackConstraints = {
        echoCancellation: !rawAudio,
        noiseSuppression: !rawAudio,
        autoGainControl: !rawAudio,
      };
      if (audioDevices.selectedInput) {
        audioConstraints.deviceId = { exact: audioDevices.selectedInput };
      }
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraints,
        video: false,
      });
      sharedMicRef.current = micStream;
      // Pipe the mic into the source-monitor audio element so the operator
      // can choose to listen to the raw input via the Monitor radio.
      if (sourceAudioRef.current) {
        sourceAudioRef.current.srcObject = micStream;
        sourceAudioRef.current.play().catch(() => {
          // Autoplay may need a user gesture — silently ignore; muted is the
          // default state until the operator picks Monitor=Source anyway.
        });
      }
      if (!audioDevices.hasPermission) {
        void audioDevices.refresh();
      }
    } catch (err) {
      pushError(
        "Mic",
        `Could not access microphone: ${(err as Error).message}`,
      );
      return;
    }

    setPhase("translating");

    // Start recording the source mic for this segment. (Recorders for the
    // translated audio start inside each engine's stream-ready callback.)
    micRecorderRef.current = startRecorder({ stream: micStream });

    try {
      openaiSessionRef.current = await startSession({
        targetLanguage,
        captureSource,
        audioSink: openaiAudioRef.current,
        broadcastSink: openaiBroadcastAudioRef.current,
        micStream,
        onEvent: handleOpenaiEvent,
        onTrack: async (track) => {
          // If an auto-reconnect produced a fresh translated track while a
          // recorder is still running on the old one, flush the old recorder
          // into the Blob array before starting a new one. Otherwise the old
          // recording is silently dropped on GC.
          const prev = openaiRecorderRef.current;
          openaiRecorderRef.current = null;
          if (prev) {
            void prev.stop().then((blob) => {
              if (blob) recordingsRef.current.openai.push(blob);
            });
          }
          openaiRecorderRef.current = startRecorder({
            stream: new MediaStream([track]),
          });
          // Publish into the already-connected room. In no-LiveKit mode
          // publisherRef is null and the translated audio just plays locally.
          if (!publisherRef.current) return;
          try {
            await publisherRef.current.publishTrack(track);
          } catch (err) {
            pushError(
              "LiveKit publisher",
              err instanceof Error ? err.message : String(err),
            );
          }
        },
      });
    } catch {
      openaiSessionRef.current = null;
    }

    if (useGemini) {
      try {
        geminiSessionRef.current = await startGeminiSession({
          targetLanguage,
          targetLanguageLabel,
          captureSource,
          audioSink: geminiAudioRef.current,
          broadcastSink: geminiBroadcastAudioRef.current,
          micStream,
          onEvent: handleGeminiEvent,
          onOutputStream: (stream) => {
            geminiRecorderRef.current = startRecorder({ stream });
          },
        });
      } catch {
        geminiSessionRef.current = null;
      }
    }
  }, [
    targetLanguage,
    targetLanguageLabel,
    useGemini,
    captureSource,
    rawAudio,
    handleOpenaiEvent,
    handleGeminiEvent,
    startTelemetryIfNeeded,
    pushError,
    audioDevices,
  ]);

  // Stop translation but keep the room open (listeners stay connected, see
  // "waiting for the speaker"). With no LiveKit there's no room — this ends
  // the session and writes the benchmark.
  const handleStopTranslation = useCallback(async () => {
    try {
      await openaiSessionRef.current?.stop();
    } catch {
      // ignore
    }
    try {
      await geminiSessionRef.current?.stop();
    } catch {
      // ignore
    }
    openaiSessionRef.current = null;
    geminiSessionRef.current = null;
    // Flush this segment's recorders into the per-engine Blob arrays. Must
    // happen AFTER session.stop() so the last audio chunk lands cleanly.
    await stopSegmentRecorders();
    try {
      await publisherRef.current?.unpublishTrack();
    } catch {
      // ignore
    }
    sharedMicRef.current?.getTracks().forEach((t) => t.stop());
    sharedMicRef.current = null;

    if (LIVEKIT_ENABLED && publisherRef.current) {
      setPhase("room-open");
    } else {
      await finalizeTelemetry();
      setPhase("idle");
    }
  }, [finalizeTelemetry, stopSegmentRecorders]);

  // Tear everything down: stop translation if running, disconnect the room,
  // finalize telemetry + write the benchmark.
  const handleCloseRoom = useCallback(async () => {
    try {
      await openaiSessionRef.current?.stop();
    } catch {
      // ignore
    }
    try {
      await geminiSessionRef.current?.stop();
    } catch {
      // ignore
    }
    openaiSessionRef.current = null;
    geminiSessionRef.current = null;
    await stopSegmentRecorders();
    sharedMicRef.current?.getTracks().forEach((t) => t.stop());
    sharedMicRef.current = null;
    try {
      await publisherRef.current?.stop();
    } catch {
      // ignore
    }
    publisherRef.current = null;
    setPublisherStatus("closed");
    await finalizeTelemetry();
    setPhase("idle");
  }, [finalizeTelemetry, stopSegmentRecorders]);

  useEffect(() => {
    return () => {
      void publisherRef.current?.stop();
      void openaiSessionRef.current?.stop();
      void geminiSessionRef.current?.stop();
      void micRecorderRef.current?.stop();
      void openaiRecorderRef.current?.stop();
      void geminiRecorderRef.current?.stop();
      sharedMicRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const handleCopyUrl = useCallback(async () => {
    if (!listenerUrl) return;
    try {
      await navigator.clipboard.writeText(listenerUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  }, [listenerUrl]);

  const roomOpen = phase !== "idle";
  const translating = phase === "translating";

  // Header status — phase-aware.
  const headerStatus: { label: string; dot: string } =
    phase === "idle"
      ? { label: "Idle", dot: "bg-zinc-400" }
      : phase === "room-open"
        ? {
            label:
              participantCount > 0
                ? `Room open · ${participantCount} listening`
                : "Room open · waiting for listeners",
            dot: "bg-sky-500",
          }
        : (() => {
            const os = deriveOverall(openaiStatus, geminiStatus);
            return { label: STATUS_LABEL[os], dot: STATUS_DOT_CLASS[os] };
          })();

  return (
    <div className="flex flex-1 flex-col bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <header className="border-b border-zinc-200 bg-white px-6 py-4 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">
              Operator
            </h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Live translation · OpenAI gpt-realtime-translate · LiveKit fan-out
            </p>
          </div>
          <div className="flex items-center gap-2 text-sm font-medium">
            <span
              className={`inline-block h-2.5 w-2.5 rounded-full ${headerStatus.dot}`}
              aria-hidden
            />
            <span>{headerStatus.label}</span>
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-6 py-8">
        <section className="grid grid-cols-1 gap-4 rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900 md:grid-cols-[1fr_1fr_auto_auto] md:items-end">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              Event ID
            </span>
            <input
              type="text"
              value={eventId}
              onChange={(e) => setEventId(e.target.value)}
              disabled={roomOpen}
              placeholder="demo"
              className="h-10 rounded-md border border-zinc-300 bg-white px-3 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-950"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              Target language
            </span>
            <select
              value={targetLanguage}
              onChange={(e) => setTargetLanguage(e.target.value)}
              disabled={roomOpen}
              className="h-10 rounded-md border border-zinc-300 bg-white px-3 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-950"
            >
              {TARGET_LANGUAGES.map((lang) => (
                <option key={lang.code} value={lang.code}>
                  {lang.label} ({lang.code})
                </option>
              ))}
            </select>
          </label>

          <label
            className="flex items-center gap-2 text-sm"
            title="Adds gpt-realtime-whisper for input transcription. Increases OpenAI API cost by ~50%."
          >
            <input
              type="checkbox"
              checked={captureSource}
              onChange={(e) => setCaptureSource(e.target.checked)}
              disabled={roomOpen}
              className="h-4 w-4 rounded border-zinc-300 text-emerald-600 focus:ring-emerald-500"
            />
            <span>
              Capture source{" "}
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                (+50% cost)
              </span>
            </span>
          </label>

          <div className="flex flex-col gap-2">
            {phase === "idle" ? (
              <button
                type="button"
                onClick={
                  LIVEKIT_ENABLED ? handleOpenRoom : handleStartTranslation
                }
                className="h-10 rounded-md bg-emerald-600 px-5 text-sm font-medium text-white shadow-sm transition hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 dark:focus:ring-offset-zinc-900"
              >
                {LIVEKIT_ENABLED ? "Open room" : "Start translation"}
              </button>
            ) : null}
            {phase === "room-open" ? (
              <>
                <button
                  type="button"
                  onClick={handleStartTranslation}
                  className="h-10 rounded-md bg-emerald-600 px-5 text-sm font-medium text-white shadow-sm transition hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 dark:focus:ring-offset-zinc-900"
                >
                  Start translation
                </button>
                <button
                  type="button"
                  onClick={handleCloseRoom}
                  className="h-10 rounded-md border border-zinc-300 bg-white px-5 text-sm font-medium shadow-sm transition hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-emerald-500 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800"
                >
                  Close room
                </button>
              </>
            ) : null}
            {phase === "translating" ? (
              <>
                <button
                  type="button"
                  onClick={handleStopTranslation}
                  className="h-10 rounded-md bg-rose-600 px-5 text-sm font-medium text-white shadow-sm transition hover:bg-rose-700 focus:outline-none focus:ring-2 focus:ring-rose-500 focus:ring-offset-2 dark:focus:ring-offset-zinc-900"
                >
                  Stop translation
                </button>
                <button
                  type="button"
                  onClick={handleCloseRoom}
                  className="h-10 rounded-md border border-zinc-300 bg-white px-5 text-sm font-medium shadow-sm transition hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-emerald-500 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800"
                >
                  Close room
                </button>
              </>
            ) : null}
          </div>
        </section>

        {/* Audio I/O selection */}
        <section className="grid grid-cols-1 gap-4 rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900 md:grid-cols-[1fr_1fr_auto] md:items-end">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              Microphone (input)
            </span>
            <select
              value={audioDevices.selectedInput}
              onChange={(e) => audioDevices.setSelectedInput(e.target.value)}
              disabled={translating}
              className="h-10 rounded-md border border-zinc-300 bg-white px-3 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-950"
            >
              <option value="">{AUDIO_DEFAULTS.inputLabel}</option>
              {audioDevices.inputs.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              Output (translation playback)
              {!audioDevices.outputSupported ? (
                <span className="ml-1 text-rose-500">
                  · not supported in this browser
                </span>
              ) : null}
            </span>
            <select
              value={audioDevices.selectedOutput}
              onChange={(e) => audioDevices.setSelectedOutput(e.target.value)}
              disabled={!audioDevices.outputSupported}
              className="h-10 rounded-md border border-zinc-300 bg-white px-3 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-950"
            >
              <option value="">{AUDIO_DEFAULTS.outputLabel}</option>
              {audioDevices.outputs.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>

          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium uppercase tracking-wide text-transparent">
              .
            </span>
            <button
              type="button"
              onClick={() => void audioDevices.requestPermission()}
              className="h-10 rounded-md border border-zinc-300 bg-white px-4 text-sm font-medium shadow-sm transition hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-emerald-500 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800"
              title={
                audioDevices.hasPermission
                  ? "Re-scan devices (e.g. after plugging a new mic)"
                  : "Request mic permission to see device names"
              }
            >
              {audioDevices.hasPermission ? "Refresh devices" : "Detect devices"}
            </button>
          </div>
          <label
            className="col-span-full flex items-center gap-2 text-sm"
            title="Disables browser echoCancellation / noiseSuppression / autoGainControl. Turn ON for clean digital inputs (VB-Audio Cable, line-level from a venue mixing board) where DSP introduces artifacts. Leave OFF for laptop mics in noisy rooms."
          >
            <input
              type="checkbox"
              checked={rawAudio}
              onChange={(e) => setRawAudio(e.target.checked)}
              disabled={translating}
              className="h-4 w-4 rounded border-zinc-300 text-emerald-600 focus:ring-emerald-500"
            />
            <span>
              Raw audio{" "}
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                (disable browser DSP. For VB-Cable / line-level feeds)
              </span>
            </span>
          </label>
        </section>

        {/* Monitor toggle */}
        <section className="flex flex-wrap items-center gap-3 rounded-lg border border-zinc-200 bg-white px-5 py-3 text-sm dark:border-zinc-800 dark:bg-zinc-900">
          <span className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Monitor:
          </span>
          {(
            [
              { value: "source", label: "Source" },
              { value: "openai", label: "Translation" },
              { value: "mute", label: "Mute" },
            ] as { value: MonitorChoice; label: string }[]
          ).map(({ value, label }) => (
            <label
              key={value}
              className="flex items-center gap-1.5 text-sm"
              title={
                value === "source"
                  ? "Listen to the raw mic input. Useful to verify the mic is picking up cleanly. Use headphones to avoid feedback."
                  : value === "openai"
                    ? "Listen to the OpenAI translated audio."
                    : "Silence both."
              }
            >
              <input
                type="radio"
                name="monitor"
                value={value}
                checked={monitor === value}
                onChange={() => setMonitor(value)}
                className="h-4 w-4 border-zinc-300 text-emerald-600 focus:ring-emerald-500"
              />
              {label}
            </label>
          ))}
          <label
            className="flex items-center gap-2 text-sm"
            title="Plays the translated audio to the system default device in addition to the selected output. Lets screen-share / tab-audio capture the translation even when you're monitoring through a specific headphone."
          >
            <input
              type="checkbox"
              checked={broadcastToTab}
              onChange={(e) => setBroadcastToTab(e.target.checked)}
              className="h-4 w-4 rounded border-zinc-300 text-emerald-600 focus:ring-emerald-500"
            />
            <span>
              Broadcast to tab audio{" "}
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                (for screen-share)
              </span>
            </span>
          </label>
        </section>

        {/* Mark moment — operator click bookmarks the current second in the
            transcript + telemetry log. Doubles as ground-truth latency
            samples ("I heard this start now"). */}
        {phase !== "idle" ? (
          <section className="flex flex-wrap items-center gap-3 rounded-lg border border-zinc-200 bg-white px-5 py-3 text-sm dark:border-zinc-800 dark:bg-zinc-900">
            <button
              type="button"
              onClick={handleMark}
              className="h-9 rounded-md bg-amber-500 px-4 text-sm font-medium text-white shadow-sm transition hover:bg-amber-600 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:ring-offset-2 dark:focus:ring-offset-zinc-900"
              title="Bookmark this moment in the transcript + event log. Use it to flag clip-worthy phrases or to drop a ground-truth latency sample."
            >
              📍 Mark moment
            </button>
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              {telemetrySnapshot?.marksCount ?? 0} mark
              {(telemetrySnapshot?.marksCount ?? 0) === 1 ? "" : "s"} placed
            </span>
            <span className="ml-auto text-xs text-zinc-500 dark:text-zinc-400">
              Marks land in <code className="font-mono">marks.json</code> + the
              event log at session end.
            </span>
          </section>
        ) : null}

        {errorMessages.length > 0 ? (
          <div className="rounded-lg border border-rose-300 bg-rose-50 p-4 text-sm text-rose-900 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-200">
            <strong className="font-semibold">Errors:</strong>
            <ul className="mt-1 list-disc pl-5">
              {errorMessages.map((m, i) => (
                <li key={i}>{m}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {reconnectInfo ? (
          <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
            {reconnectInfo}
          </div>
        ) : null}

        {LIVEKIT_ENABLED && roomOpen ? (
          <section className="grid grid-cols-1 gap-4 rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900 md:grid-cols-[auto_1fr] md:gap-6">
            <div className="flex items-center justify-center rounded-md bg-white p-3 ring-1 ring-zinc-200 dark:bg-zinc-50">
              {listenerUrl ? (
                <QRCodeSVG value={listenerUrl} size={176} includeMargin={false} />
              ) : null}
            </div>
            <div className="flex flex-col justify-center gap-3">
              <div className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                Listener link · room <code className="font-mono">{room}</code>
              </div>
              <label className="flex flex-col gap-1">
                <span className="text-[10px] uppercase tracking-wide text-zinc-400 dark:text-zinc-600">
                  Base URL: must be reachable from phones (not localhost)
                </span>
                <input
                  type="text"
                  value={listenerBaseUrl}
                  onChange={(e) => setListenerBaseUrl(e.target.value)}
                  placeholder="http://192.168.1.50:3000"
                  className="h-8 rounded-md border border-zinc-300 bg-white px-2 font-mono text-xs shadow-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 dark:border-zinc-700 dark:bg-zinc-950"
                />
              </label>
              <div className="break-all font-mono text-sm">
                {listenerUrl || "—"}
              </div>
              {phase === "room-open" ? (
                <div className="rounded-md border border-sky-300 bg-sky-50 px-3 py-2 text-xs text-sky-900 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-200">
                  Room is open. Share this link now. Listeners who connect will
                  hear &ldquo;waiting for the speaker&rdquo; until you click{" "}
                  <strong>Start translation</strong>.
                </div>
              ) : null}
              <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-500 dark:text-zinc-400">
                <button
                  type="button"
                  onClick={handleCopyUrl}
                  className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 font-medium shadow-sm hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800"
                >
                  {copied ? "Copied!" : "Copy URL"}
                </button>
                <span>
                  {participantCount} listener{participantCount === 1 ? "" : "s"}
                </span>
                <span>LiveKit: {publisherStatus}</span>
                <span>
                  Translation: {phase === "translating" ? "live" : "not started"}
                </span>
              </div>
            </div>
          </section>
        ) : null}

        <TelemetryPanel
          snapshot={telemetrySnapshot}
          geminiEnabled={useGemini}
          savedBenchmarkPath={savedBenchmarkPath}
        />

        <section className="grid flex-1 grid-cols-1 gap-4 md:grid-cols-2">
          <TranscriptPanel
            title="Source (detected)"
            text={sourceTranscript}
            scrollRef={sourceScrollRef}
            placeholder={
              captureSource
                ? "Speak into the microphone…"
                : "Source capture disabled (toggle on to enable; +50% OpenAI cost)"
            }
            badgeStatus={captureSource ? openaiStatus : "idle"}
            badgeLabel={captureSource ? "from OpenAI ASR" : "off"}
          />
          <TranscriptPanel
            title={`Translation → ${targetLanguageLabel}`}
            text={openaiTranscript}
            scrollRef={openaiScrollRef}
            placeholder="Translation…"
            badgeStatus={openaiStatus}
            badgeLabel={
              openaiLatencyMs !== null
                ? `Latency ${(openaiLatencyMs / 1000).toFixed(2)} s`
                : STATUS_LABEL[openaiStatus]
            }
          />
        </section>

        {/* Source-mic monitor — operator hears the raw input when
           Monitor=Source. Starts muted; the monitor-effect un-mutes on demand. */}
        <audio ref={sourceAudioRef} autoPlay playsInline muted />
        <audio ref={openaiAudioRef} autoPlay playsInline />
        <audio ref={geminiAudioRef} autoPlay playsInline />
        {/* Secondary audio elements always playing at the default device — they
           feed screen-share tab audio when the primary sinks are routed to a
           specific output (e.g., monitor headphones). Muted via useEffect when
           broadcastToTab is off or when no specific output is selected. */}
        <audio ref={openaiBroadcastAudioRef} autoPlay playsInline />
        <audio ref={geminiBroadcastAudioRef} autoPlay playsInline />

        <footer className="text-xs text-zinc-500 dark:text-zinc-400">
          OpenAI gpt-realtime-translate · self-hosted LiveKit · session
          reports and recordings are saved locally to benchmarks/.
        </footer>
      </main>
    </div>
  );
}

function deriveOverall(
  openai: RealtimeStatus,
  gemini: GeminiStatus,
): EngineStatus {
  const inProgress = (s: EngineStatus) =>
    s === "creating-session" || s === "negotiating";
  if (openai === "live" || gemini === "live") return "live";
  if (openai === "error" || gemini === "error") return "error";
  if (inProgress(openai) || inProgress(gemini)) return "creating-session";
  return "idle";
}

function TranscriptPanel({
  title,
  text,
  scrollRef,
  placeholder,
  badgeStatus,
  badgeLabel,
}: {
  title: string;
  text: string;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  placeholder: string;
  badgeStatus: EngineStatus;
  badgeLabel: string;
}) {
  return (
    <div className="flex h-72 flex-col overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 lg:h-96">
      <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-2 dark:border-zinc-800">
        <span className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          {title}
        </span>
        <span className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          <span
            className={`inline-block h-2 w-2 rounded-full ${STATUS_DOT_CLASS[badgeStatus]}`}
            aria-hidden
          />
          {badgeLabel}
        </span>
      </div>
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto whitespace-pre-wrap px-4 py-3 text-sm leading-relaxed"
      >
        {text ? (
          text
        ) : (
          <span className="text-zinc-400 dark:text-zinc-600">
            {placeholder}
          </span>
        )}
      </div>
    </div>
  );
}
