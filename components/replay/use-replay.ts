"use client";

/**
 * Replay clock and manifest loading. The selected channel's <audio> element
 * is the clock: captions and position are read from its currentTime, and a
 * channel switch keeps the position and the play state.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { pickAudio, replayChannels, type ReplayChannel, type ReplayManifest } from "@/lib/replay";

export const REPLAY_BASE = "/replay";

export type ManifestState =
  | { kind: "loading" }
  | { kind: "ready"; manifest: ReplayManifest; channels: ReplayChannel[] }
  | { kind: "error" };

export function useReplayManifest(): ManifestState {
  const [state, setState] = useState<ManifestState>({ kind: "loading" });
  useEffect(() => {
    let cancelled = false;
    fetch(`${REPLAY_BASE}/manifest.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((m: ReplayManifest) => {
        if (!cancelled) setState({ kind: "ready", manifest: m, channels: replayChannels(m) });
      })
      .catch(() => {
        if (!cancelled) setState({ kind: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return state;
}

export function canPlayWebm(): boolean {
  if (typeof document === "undefined") return false;
  try {
    return document.createElement("audio").canPlayType('audio/webm; codecs="opus"') !== "";
  } catch {
    return false;
  }
}

export function audioUrl(channel: ReplayChannel | undefined, webm: boolean): string | null {
  if (!channel) return null;
  const file = pickAudio(channel.audio, webm);
  return file ? `${REPLAY_BASE}/${file}` : null;
}

/** Media element writes live outside components (see the lint rule on
 *  mutating values returned by hooks). */
export function setMediaTime(el: HTMLMediaElement, seconds: number): void {
  el.currentTime = seconds;
}

export function setMediaMuted(el: HTMLMediaElement, muted: boolean): void {
  el.muted = muted;
}

function loadSource(el: HTMLMediaElement, src: string): void {
  el.src = src;
  el.load();
}

export type ReplayPlayer = {
  /** Callback ref for the <audio> element. */
  attach: (el: HTMLAudioElement | null) => void;
  element: HTMLAudioElement | null;
  t: number;
  duration: number;
  playing: boolean;
  started: boolean;
  ended: boolean;
  loading: boolean;
  blocked: boolean;
  play: () => void;
  pause: () => void;
  seek: (seconds: number) => void;
};

/** Drives one <audio> element whose source is `src`. */
export function useReplayPlayer(src: string | null, fallbackDuration: number): ReplayPlayer {
  const [element, setElement] = useState<HTMLAudioElement | null>(null);
  const [t, setT] = useState(0);
  const [duration, setDuration] = useState(fallbackDuration);
  const [playing, setPlaying] = useState(false);
  const [started, setStarted] = useState(false);
  const [ended, setEnded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [blocked, setBlocked] = useState(false);
  const resumeRef = useRef<{ at: number; play: boolean }>({ at: 0, play: false });

  // Load a new source, keeping position and play state across switches.
  useEffect(() => {
    const el = element;
    if (!el || !src) return;
    const { at, play } = resumeRef.current;
    const onMeta = () => {
      try {
        setMediaTime(el, Math.min(at, Number.isFinite(el.duration) ? el.duration : at));
      } catch {
        // ignore
      }
      if (Number.isFinite(el.duration)) setDuration(el.duration);
      setLoading(false);
      if (play) el.play().catch(() => setBlocked(true));
    };
    el.addEventListener("loadedmetadata", onMeta, { once: true });
    loadSource(el, src);
    return () => el.removeEventListener("loadedmetadata", onMeta);
  }, [element, src]);

  // Element events and the clock.
  useEffect(() => {
    const el = element;
    if (!el) return;
    let raf = 0;
    let last = 0;
    const tick = (now: number) => {
      if (now - last > 90) {
        last = now;
        setT(el.currentTime);
      }
      raf = requestAnimationFrame(tick);
    };
    const onPlay = () => {
      setPlaying(true);
      setStarted(true);
      setEnded(false);
      setBlocked(false);
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(tick);
    };
    const onPause = () => {
      setPlaying(false);
      cancelAnimationFrame(raf);
      setT(el.currentTime);
    };
    const onEnded = () => {
      setEnded(true);
      setPlaying(false);
      cancelAnimationFrame(raf);
    };
    const onWaiting = () => setLoading(true);
    const onCanPlay = () => setLoading(false);
    const onSeeked = () => setT(el.currentTime);
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("ended", onEnded);
    el.addEventListener("waiting", onWaiting);
    el.addEventListener("canplay", onCanPlay);
    el.addEventListener("seeked", onSeeked);
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("ended", onEnded);
      el.removeEventListener("waiting", onWaiting);
      el.removeEventListener("canplay", onCanPlay);
      el.removeEventListener("seeked", onSeeked);
    };
  }, [element]);

  // Before a source switch, remember where we are.
  useEffect(() => {
    return () => {
      if (element) resumeRef.current = { at: element.currentTime, play: !element.paused };
    };
  }, [element, src]);

  const play = useCallback(() => {
    const el = element;
    if (!el) return;
    if (el.ended) setMediaTime(el, 0);
    el.play().catch(() => setBlocked(true));
  }, [element]);

  const pause = useCallback(() => element?.pause(), [element]);

  const seek = useCallback(
    (s: number) => {
      if (!element) return;
      setMediaTime(element, Math.max(0, s));
      setT(element.currentTime);
      setEnded(false);
    },
    [element],
  );

  return {
    attach: setElement,
    element,
    t,
    duration,
    playing,
    started,
    ended,
    loading,
    blocked,
    play,
    pause,
    seek,
  };
}
