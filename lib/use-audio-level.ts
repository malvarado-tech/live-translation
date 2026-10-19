"use client";

/**
 * Live audio level of a MediaStream (mic, translated track, remote track)
 * or of an <audio> element (replay). An AnalyserNode is sampled on every
 * animation frame; React state is updated about 12 times a second.
 *
 * Remote WebRTC tracks only feed Web Audio in Chrome while they are also
 * attached to a media element, which the listener page already does.
 */
import { useEffect, useState } from "react";

export type AudioLevel = {
  /** 0..1, from -60 dBFS (0) to 0 dBFS (1), RMS with a short release. */
  level: number;
  /** Peak of the last second, dBFS (-Infinity when silent). */
  peakDb: number;
  /** A sample reached full scale in the last second. */
  clipping: boolean;
  /** ms since the signal was last above the silence threshold. */
  silentMs: number;
  /** An analyser is attached. */
  active: boolean;
};

const IDLE: AudioLevel = {
  level: 0,
  peakDb: -Infinity,
  clipping: false,
  silentMs: 0,
  active: false,
};

const FLOOR_DB = -60;
const SILENCE_DB = -50;
const UI_INTERVAL_MS = 80;

let sharedContext: AudioContext | null = null;

/** The page's AudioContext. Call `primeAudio()` inside a tap on iOS. */
export function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!sharedContext) {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) return null;
    try {
      sharedContext = new Ctor();
    } catch {
      return null;
    }
  }
  return sharedContext;
}

/** Resume the AudioContext from a user gesture. */
export function primeAudio(): void {
  const ctx = getAudioContext();
  if (ctx && ctx.state === "suspended") void ctx.resume().catch(() => {});
}

const elementSources = new WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>();

type Source = MediaStream | HTMLMediaElement | null;

export function useAudioLevel(source: Source): AudioLevel {
  const [value, setValue] = useState<AudioLevel>(IDLE);

  useEffect(() => {
    const ctx = getAudioContext();
    if (!source || !ctx) {
      // Reset through a frame so the effect body never sets state directly.
      const id = requestAnimationFrame(() => setValue(IDLE));
      return () => cancelAnimationFrame(id);
    }
    if (source instanceof MediaStream && source.getAudioTracks().length === 0) {
      const id = requestAnimationFrame(() => setValue(IDLE));
      return () => cancelAnimationFrame(id);
    }

    let node: AudioNode;
    let disconnectNode = true;
    try {
      if (source instanceof MediaStream) {
        node = ctx.createMediaStreamSource(source);
      } else {
        let el = elementSources.get(source);
        if (!el) {
          el = ctx.createMediaElementSource(source);
          // An element routed through Web Audio must stay connected to the
          // speakers, or it goes silent.
          el.connect(ctx.destination);
          elementSources.set(source, el);
        }
        node = el;
        disconnectNode = false;
      }
    } catch {
      const id = requestAnimationFrame(() => setValue(IDLE));
      return () => cancelAnimationFrame(id);
    }

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0;
    node.connect(analyser);
    const buf = new Float32Array(analyser.fftSize);

    let raf = 0;
    let smoothed = 0;
    let lastUi = 0;
    let lastSound = performance.now();
    let peakHold = 0;
    let peakAt = 0;
    let clipAt = -Infinity;

    const tick = (now: number) => {
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      let peak = 0;
      for (let i = 0; i < buf.length; i++) {
        const v = buf[i];
        sum += v * v;
        const a = v < 0 ? -v : v;
        if (a > peak) peak = a;
      }
      const rms = Math.sqrt(sum / buf.length);
      const db = rms > 0 ? 20 * Math.log10(rms) : -Infinity;
      const norm = Math.max(0, Math.min(1, (db - FLOOR_DB) / -FLOOR_DB));
      // Fast attack, slower release, like a console meter.
      smoothed = norm > smoothed ? norm : smoothed * 0.86 + norm * 0.14;
      if (db > SILENCE_DB) lastSound = now;
      if (peak >= peakHold || now - peakAt > 1000) {
        peakHold = peak;
        peakAt = now;
      }
      if (peak >= 0.99) clipAt = now;

      if (now - lastUi >= UI_INTERVAL_MS) {
        lastUi = now;
        setValue({
          level: smoothed,
          peakDb: peakHold > 0 ? 20 * Math.log10(peakHold) : -Infinity,
          clipping: now - clipAt < 1000,
          silentMs: Math.max(0, now - lastSound),
          active: true,
        });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      try {
        node.disconnect(analyser);
      } catch {
        // ignore
      }
      if (disconnectNode) {
        try {
          node.disconnect();
        } catch {
          // ignore
        }
      }
    };
  }, [source]);

  return value;
}

export function formatDb(db: number): string {
  if (!Number.isFinite(db)) return "-∞ dB";
  return `${Math.round(db)} dB`;
}
