/**
 * Small in-memory fixed-window rate limiter.
 *
 * State lives in the server process, so with several instances each one
 * enforces its own limit. That is enough to keep a public endpoint from being
 * used to hammer the LiveKit API; it is not an abuse-proof quota.
 */
export type RateLimiter = {
  /** Records one hit for `key` and returns whether it is allowed. */
  hit: (key: string, now?: number) => boolean;
  size: () => number;
};

export function createRateLimiter(opts: {
  limit: number;
  windowMs: number;
  /** Upper bound on tracked keys; the oldest windows are dropped first. */
  maxKeys?: number;
}): RateLimiter {
  const { limit, windowMs } = opts;
  const maxKeys = opts.maxKeys ?? 10_000;
  const windows = new Map<string, { start: number; count: number }>();

  function prune(now: number) {
    for (const [key, w] of windows) {
      if (now - w.start >= windowMs) windows.delete(key);
    }
    while (windows.size >= maxKeys) {
      const oldest = windows.keys().next().value;
      if (oldest === undefined) break;
      windows.delete(oldest);
    }
  }

  return {
    hit(key, now = Date.now()) {
      let w = windows.get(key);
      if (!w || now - w.start >= windowMs) {
        if (!w && windows.size >= maxKeys) prune(now);
        w = { start: now, count: 0 };
        windows.delete(key);
        windows.set(key, w);
      }
      w.count += 1;
      return w.count <= limit;
    },
    size: () => windows.size,
  };
}
