/**
 * Operator-facing description of a failure: what happened and the fix.
 * The raw message is kept as a detail line for the operator only; listener
 * pages never show server or engine messages.
 *
 * No imports, so it runs under `node --test` as well as in the browser.
 */

export type ErrorCopy = {
  title: string;
  fix: string;
  detail: string;
};

/** Pull `{"error": "..."}` out of a message that embeds a JSON body. */
export function extractServerMessage(raw: string): string {
  const start = raw.indexOf("{");
  if (start >= 0) {
    try {
      const parsed = JSON.parse(raw.slice(start)) as { error?: unknown };
      if (typeof parsed.error === "string") return parsed.error;
      if (
        parsed.error &&
        typeof parsed.error === "object" &&
        typeof (parsed.error as { message?: unknown }).message === "string"
      ) {
        return (parsed.error as { message: string }).message;
      }
    } catch {
      // not JSON
    }
  }
  return raw;
}

const RULES: Array<{ test: RegExp; title: string; fix: string }> = [
  {
    test: /OPENAI_API_KEY/,
    title: "Translation engine not configured",
    fix: "Set OPENAI_API_KEY in .env.local and restart the server. Original audio mode works without it.",
  },
  {
    test: /LIVEKIT_API_KEY|LIVEKIT_API_SECRET/,
    title: "Room server credentials missing",
    fix: "Set LIVEKIT_API_KEY and LIVEKIT_API_SECRET in .env.local and restart the server.",
  },
  {
    test: /NotAllowedError|Permission denied|permission/i,
    title: "Microphone access blocked",
    fix: "Allow microphone access for this site in the browser settings, then retry.",
  },
  {
    test: /NotFoundError|Requested device not found|OverconstrainedError/i,
    title: "Input device not found",
    fix: "Reconnect the input or choose another one under Change input, then retry.",
  },
  {
    test: /NotReadableError|Could not start audio source/i,
    title: "Input device busy",
    fix: "Close other applications that use the microphone, then retry.",
  },
  {
    test: /gave up after/i,
    title: "Translation stopped after repeated reconnection attempts",
    fix: "Start translation again. If it fails again, check the network connection.",
  },
  {
    test: /Session creation failed \((401|403)\)/,
    title: "Translation key refused",
    fix: "Check that the API key is valid and has access to the realtime translation model.",
  },
  {
    test: /Session creation failed \(429\)/,
    title: "Translation quota exceeded",
    fix: "Check the account's rate limits and balance, then retry.",
  },
  {
    test: /Session creation failed|SDP exchange failed|client_secret/i,
    title: "Translation engine refused the session",
    fix: "Retry. If it persists, check the engine status and the server log.",
  },
  {
    test: /Unsupported target language/i,
    title: "Language not supported by the engine",
    fix: "Choose another language in Setup.",
  },
  {
    test: /could not establish|websocket|signal|ECONNREFUSED|Failed to fetch|NetworkError|timed out|timeout/i,
    title: "Room server unreachable",
    fix: "Check that LiveKit is running and that NEXT_PUBLIC_LIVEKIT_URL points to it.",
  },
  {
    test: /WebRTC connection failed/i,
    title: "Connection to the translation engine dropped",
    fix: "Reconnection runs on its own. If it gives up, start translation again.",
  },
];

export function describeOperatorError(scope: string, raw: string): ErrorCopy {
  const detail = extractServerMessage(raw).slice(0, 300);
  for (const rule of RULES) {
    if (rule.test.test(raw) || rule.test.test(detail)) {
      return { title: rule.title, fix: rule.fix, detail };
    }
  }
  return {
    title: `${scope} error`,
    fix: "Retry. If it persists, check the server log.",
    detail,
  };
}
