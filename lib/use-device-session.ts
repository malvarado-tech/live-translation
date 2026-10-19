"use client";

/**
 * Phone integrations for the listener: keep the screen on while listening
 * (Screen Wake Lock API) and describe the stream on the lock screen and in
 * the notification shade (Media Session API). Both are optional: browsers
 * without them simply skip the call.
 */
import { useEffect, useRef } from "react";

type WakeLockSentinelLike = {
  released: boolean;
  release: () => Promise<void>;
  addEventListener?: (type: "release", cb: () => void) => void;
};

type WakeLockNavigator = Navigator & {
  wakeLock?: { request: (type: "screen") => Promise<WakeLockSentinelLike> };
};

/** Hold a screen wake lock while `active`, re-acquiring it after the tab
 *  becomes visible again (browsers release it on hide). */
export function useWakeLock(active: boolean): void {
  const sentinel = useRef<WakeLockSentinelLike | null>(null);

  useEffect(() => {
    if (!active) return;
    const nav = navigator as WakeLockNavigator;
    if (!nav.wakeLock) return;
    let cancelled = false;

    const acquire = async () => {
      if (cancelled || document.visibilityState !== "visible") return;
      if (sentinel.current && !sentinel.current.released) return;
      try {
        sentinel.current = await nav.wakeLock!.request("screen");
      } catch {
        // Denied (battery saver, iframe policy): the page still works.
      }
    };
    const onVisibility = () => void acquire();

    void acquire();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      const s = sentinel.current;
      sentinel.current = null;
      if (s && !s.released) void s.release().catch(() => {});
    };
  }, [active]);
}

export type MediaSessionInfo = {
  title: string;
  artist: string;
  album?: string;
  playing: boolean;
  onPlay?: () => void;
  onPause?: () => void;
};

/** Lock-screen metadata and play/pause handlers while `info` is set. */
export function useMediaSession(info: MediaSessionInfo | null): void {
  const handlers = useRef<Pick<MediaSessionInfo, "onPlay" | "onPause">>({});
  useEffect(() => {
    handlers.current = { onPlay: info?.onPlay, onPause: info?.onPause };
  });

  const title = info?.title ?? null;
  const artist = info?.artist ?? null;
  const album = info?.album ?? null;
  const playing = info?.playing ?? false;

  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    const ms = navigator.mediaSession;
    if (title === null) {
      ms.metadata = null;
      return;
    }
    try {
      ms.metadata = new MediaMetadata({
        title,
        artist: artist ?? "",
        album: album ?? "",
      });
      ms.setActionHandler("play", () => handlers.current.onPlay?.());
      ms.setActionHandler("pause", () => handlers.current.onPause?.());
    } catch {
      // Older implementations may reject some actions.
    }
    return () => {
      try {
        ms.setActionHandler("play", null);
        ms.setActionHandler("pause", null);
        ms.metadata = null;
      } catch {
        // ignore
      }
    };
  }, [title, artist, album]);

  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    try {
      navigator.mediaSession.playbackState = title === null ? "none" : playing ? "playing" : "paused";
    } catch {
      // ignore
    }
  }, [title, playing]);
}
