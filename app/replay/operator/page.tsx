"use client";

/**
 * Read-only operator replay: the Desk and Rows views driven by the recorded
 * session in /replay instead of a live room. All channels play in step from
 * the source recording's clock; each is metered, and the monitor button
 * chooses which one is heard. No keys, no server routes.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  OperatorBody,
  SessionBar,
  type OperatorModel,
  type StripModel,
} from "@/components/operator/views";
import { Transport } from "@/components/replay/transport";
import { audioUrl, setMediaMuted, setMediaTime, useReplayManifest } from "@/components/replay/use-replay";
import { Button, Kbd } from "@/components/ui/controls";
import { LISTENER_STRINGS, uiLangForRoom } from "@/lib/listener-strings";
import { cuesUntil, type ReplayChannel } from "@/lib/replay";
import { getAudioContext, primeAudio } from "@/lib/use-audio-level";

type Levels = Record<string, number>;

const DRIFT_S = 0.2;

function clock(s: number): string {
  const v = Math.max(0, Math.floor(s));
  return `${String(Math.floor(v / 3600)).padStart(2, "0")}:${String(Math.floor((v % 3600) / 60)).padStart(2, "0")}:${String(v % 60).padStart(2, "0")}`;
}

export default function OperatorReplayPage() {
  const state = useReplayManifest();
  const channels = useMemo(() => (state.kind === "ready" ? state.channels : []), [state]);
  const [monitor, setMonitor] = useState("es");
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [levels, setLevels] = useState<Levels>({});
  const elements = useRef<Record<string, HTMLAudioElement | null>>({});
  const gains = useRef<Record<string, GainNode>>({});
  const graphReady = useRef(false);

  const source = channels.find((c) => c.original) ?? null;
  const duration = state.kind === "ready" ? state.manifest.duration_s : 0;

  const buildGraph = useCallback(() => {
    if (graphReady.current) return;
    const ctx = getAudioContext();
    if (!ctx) return;
    graphReady.current = true;
    const analysers: Record<string, AnalyserNode> = {};
    for (const c of channels) {
      const el = elements.current[c.code];
      if (!el) continue;
      try {
        const src = ctx.createMediaElementSource(el);
        const an = ctx.createAnalyser();
        an.fftSize = 1024;
        const g = ctx.createGain();
        g.gain.value = 0;
        src.connect(an);
        src.connect(g);
        g.connect(ctx.destination);
        analysers[c.code] = an;
        gains.current[c.code] = g;
      } catch {
        // Without Web Audio the replay still plays; meters stay dark.
      }
    }
    const buf = new Float32Array(1024);
    let last = 0;
    const tick = (now: number) => {
      if (now - last > 80) {
        last = now;
        const next: Levels = {};
        for (const [code, an] of Object.entries(analysers)) {
          an.getFloatTimeDomainData(buf);
          let sum = 0;
          for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
          const rms = Math.sqrt(sum / buf.length);
          const db = rms > 0 ? 20 * Math.log10(rms) : -Infinity;
          next[code] = Math.max(0, Math.min(1, (db + 60) / 60));
        }
        setLevels(next);
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, [channels]);

  // Which channel is heard.
  useEffect(() => {
    for (const [code, g] of Object.entries(gains.current)) g.gain.setValueAtTime(code === monitor ? 1 : 0, g.context.currentTime);
    // Before the graph exists, fall back to element muting.
    if (!graphReady.current) {
      for (const [code, el] of Object.entries(elements.current)) if (el) setMediaMuted(el, code !== monitor);
    }
  }, [monitor, playing]);

  // The source recording is the clock; the other channels follow it.
  useEffect(() => {
    if (!source) return;
    const master = elements.current[source.code];
    if (!master) return;
    let raf = 0;
    let last = 0;
    const tick = (now: number) => {
      if (now - last > 100) {
        last = now;
        setT(master.currentTime);
        for (const c of channels) {
          const el = elements.current[c.code];
          if (!el || el === master) continue;
          if (Math.abs(el.currentTime - master.currentTime) > DRIFT_S) setMediaTime(el, master.currentTime);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const onEnded = () => setPlaying(false);
    master.addEventListener("ended", onEnded);
    return () => {
      cancelAnimationFrame(raf);
      master.removeEventListener("ended", onEnded);
    };
  }, [source, channels]);

  const play = useCallback(() => {
    primeAudio();
    buildGraph();
    const master = source ? elements.current[source.code] : null;
    if (master?.ended) setMediaTime(master, 0);
    for (const c of channels) {
      const el = elements.current[c.code];
      if (!el) continue;
      if (master && el !== master) setMediaTime(el, master.currentTime);
      el.play().catch(() => {});
    }
    setPlaying(true);
  }, [channels, source, buildGraph]);

  const pause = useCallback(() => {
    for (const el of Object.values(elements.current)) el?.pause();
    setPlaying(false);
  }, []);

  const seek = useCallback((s: number) => {
    for (const el of Object.values(elements.current)) if (el) setMediaTime(el, s);
    setT(s);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && el.closest("input, textarea, select, button, a, [role=radio]")) return;
      if (e.code === "Space") {
        e.preventDefault();
        if (playing) pause();
        else play();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [playing, play, pause]);

  const linesOf = (c: ReplayChannel | null | undefined) =>
    c ? cuesUntil(c.cues, t).map((q) => ({ id: q.id, text: q.text, at: q.start * 1000 })) : [];

  const translated = channels.filter((c) => !c.original);
  const monitored = channels.find((c) => c.code === monitor) ?? translated[0];
  const base = typeof window !== "undefined" ? window.location.origin : "";

  const strip = (c: ReplayChannel): StripModel => ({
    key: c.code,
    code: c.code,
    label: c.original ? `${c.label}, original audio` : c.label,
    lang: c.bcp47,
    tally: playing
      ? c.original
        ? { tone: "original", text: "Original" }
        : { tone: "replay", text: "Replay" }
      : { tone: "standby", text: "Paused" },
    level: playing ? (levels[c.code] ?? 0) : null,
    stats: [
      { label: "Voice", value: c.original ? "Speaker" : "AI-generated", tone: "dim" },
      { label: "Listeners", value: "Replay", tone: "dim" },
      { label: "Position", value: clock(t) },
    ],
    meta: c.original ? "Speaker audio · recorded" : "Translated voice · AI-generated · recorded",
    actions: (
      <Button
        size="sm"
        tone={monitor === c.code ? "live" : "default"}
        ariaPressed={monitor === c.code}
        onClick={() => setMonitor(c.code)}
        testId={`monitor-${c.code}`}
      >
        {monitor === c.code ? "Monitoring" : "Monitor"}
      </Button>
    ),
  });

  const model: OperatorModel | null = source
    ? {
        input: {
          key: "input",
          code: "Recorded input",
          label: "1962 recording",
          tally: playing ? { tone: "onair", text: "Signal" } : { tone: "off", text: "Paused" },
          level: playing ? (levels[source.code] ?? 0) : null,
          stats: [
            { label: "Source", value: "Recording" },
            { label: "Language", value: "English" },
            { label: "Position", value: clock(t) },
          ],
          meta: "Recorded speech, public domain",
        },
        channels: [...translated, source].map(strip),
        alert: null,
        okLine: "Replay of a recorded session; live checks run only during a session.",
        source: { title: "Source · English", lines: linesOf(source), lang: "en", placeholder: "Playback has not started." },
        target: monitored && !monitored.original
          ? {
              title: `${monitored.code.toUpperCase()} · ${monitored.label}`,
              badge: { text: "In your headphones", tone: "ok" },
              lines: linesOf(monitored),
              lang: monitored.bcp47,
              placeholder: "Playback has not started.",
            }
          : null,
        qr: base
          ? {
              url: `${base}/replay`,
              caption: "Listener replay on a phone",
            }
          : null,
        listenersSee: translated.map((c) => ({
          code: c.code,
          text: LISTENER_STRINGS[uiLangForRoom(c.code)].status[playing ? "replay-playing" : "replay-paused"].tally,
          tone: playing ? "ok" : "dim",
          lang: uiLangForRoom(c.code),
        })),
        log: [],
      }
    : null;

  return (
    <div className="flex flex-1 flex-col" data-testid="operator-replay">
      <SessionBar
        tally={{ tone: "replay", text: "Replay" }}
        clock={clock(t)}
        title="Rice University address"
        subtitle="Replay · 1962 recording · AI-generated translation and voice"
        figures={[
          { label: "Channels", value: String(channels.length) },
          { label: "Length", value: clock(duration) },
        ]}
        actions={
          <Button tone="primary" onClick={playing ? pause : play} ariaKeyShortcuts="Space" testId="primary-action">
            {playing ? "Pause" : "Play"} <Kbd>Space</Kbd>
          </Button>
        }
      />
      <main className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col gap-5 px-4 py-5">
        <p className="rounded-md border border-line-strong px-4 py-2 text-[15px] text-ink" data-testid="replay-label">
          Read-only replay. Nothing is broadcast; levels and captions come from the recorded files.
        </p>
        <Transport
          t={t}
          duration={duration}
          playing={playing}
          onPlay={play}
          onPause={pause}
          onSeek={seek}
          labels={{ play: "Play", pause: "Pause", position: "Position" }}
        />
        {state.kind === "error" ? (
          <p role="alert" className="text-error-ink">The replay files could not be loaded.</p>
        ) : model ? (
          <OperatorBody model={model} />
        ) : (
          <p className="text-silk">Loading the replay.</p>
        )}
        {state.kind === "ready" ? (
          <p className="text-sm text-silk">{state.manifest.source.attribution}</p>
        ) : null}
      </main>
      {channels.map((c) => (
        <audio
          key={c.code}
          ref={(el) => {
            elements.current[c.code] = el;
          }}
          /* MP3 for every channel: one format keeps server and client markup equal. */
          src={audioUrl(c, false) ?? undefined}
          preload="auto"
          playsInline
        />
      ))}
    </div>
  );
}
