"use client";

import { formatClock } from "@/lib/replay";

/** Play/pause and position for a replay. */
export function Transport({
  t,
  duration,
  playing,
  onPlay,
  onPause,
  onSeek,
  labels,
  testId = "replay-transport",
}: {
  t: number;
  duration: number;
  playing: boolean;
  onPlay: () => void;
  onPause: () => void;
  onSeek: (s: number) => void;
  labels: { play: string; pause: string; position: string };
  testId?: string;
}) {
  return (
    <div
      className="flex items-center gap-3 rounded-lg border border-line bg-panel p-2"
      data-testid={testId}
    >
      <button
        type="button"
        onClick={playing ? onPause : onPlay}
        aria-label={playing ? labels.pause : labels.play}
        data-testid="replay-play"
        data-state={playing ? "playing" : "paused"}
        className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-primary text-on-primary"
      >
        {playing ? (
          <svg aria-hidden width="22" height="22" viewBox="0 0 22 22" fill="currentColor">
            <rect x="4" y="3" width="5" height="16" rx="1" />
            <rect x="13" y="3" width="5" height="16" rx="1" />
          </svg>
        ) : (
          <svg aria-hidden width="22" height="22" viewBox="0 0 22 22" fill="currentColor">
            <path d="M6 3.5v15a1 1 0 0 0 1.5.86l12-7.5a1 1 0 0 0 0-1.72l-12-7.5A1 1 0 0 0 6 3.5Z" />
          </svg>
        )}
      </button>
      <span className="tabular w-12 shrink-0 text-right font-cond text-lg text-ink" data-testid="replay-time">
        {formatClock(t)}
      </span>
      <input
        type="range"
        min={0}
        max={Math.max(1, duration)}
        step={0.1}
        value={Math.min(t, duration)}
        onChange={(e) => onSeek(Number(e.target.value))}
        aria-label={labels.position}
        aria-valuetext={`${formatClock(t)} / ${formatClock(duration)}`}
        data-testid="replay-scrub"
        className="h-11 min-w-0 flex-1 cursor-pointer accent-[var(--ink)]"
      />
      <span className="tabular w-12 shrink-0 font-cond text-lg text-silk">{formatClock(duration)}</span>
    </div>
  );
}
