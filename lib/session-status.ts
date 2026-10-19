/**
 * Operator-to-listener status channel.
 *
 * The operator's room participant carries a few attributes (LiveKit
 * participant attributes, synced to everyone in the room, including people
 * who join later). Listeners read them to tell "the speaker paused" from
 * "the translation is reconnecting" from "the audio dropped"; the event
 * page and the operator desk read them through the server API.
 *
 * No imports, so it runs under `node --test` as well as in the browser.
 */

export const STATUS_ATTR = {
  state: "lt_state",
  title: "lt_title",
  lang: "lt_lang",
  mode: "lt_mode",
  since: "lt_since",
  response: "lt_response_ms",
} as const;

export const BROADCAST_STATES = [
  "waiting",
  "live",
  "paused",
  "reconnecting",
  "interrupted",
  "ended",
] as const;

export type OperatorBroadcastState = (typeof BROADCAST_STATES)[number];

/** "translate" = speech translation; "original" = the speaker's own audio. */
export type ChannelMode = "translate" | "original";

export type OperatorStatus = {
  state: OperatorBroadcastState | null;
  title: string | null;
  lang: string | null;
  mode: ChannelMode | null;
  /** ms timestamp when the channel went on air, if it is on air. */
  sinceMs: number | null;
  /** Last measured first-response time of the translation, ms. */
  responseMs: number | null;
};

export const MAX_TITLE_LENGTH = 120;

function cleanText(v: string | undefined, max: number): string | null {
  if (typeof v !== "string") return null;
  // Strip control characters; attributes come from another browser.
  const s = v.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);
  return s || null;
}

function cleanNumber(v: string | undefined): number | null {
  if (typeof v !== "string" || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** `lt_state` -> `ltState`: the server SDK returns attribute keys in this
 *  form (protobuf JSON naming), while browsers see them as set. */
function camel(key: string): string {
  return key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

/** The value of an attribute under either key spelling. */
export function attr(
  attrs: Readonly<Record<string, string>>,
  key: string,
): string | undefined {
  return attrs[key] ?? attrs[camel(key)];
}

/** Parse attributes defensively. Unknown or malformed values become null. */
export function parseOperatorStatus(
  attrs: Readonly<Record<string, string>> | undefined | null,
): OperatorStatus {
  const raw = attrs ?? {};
  const a: Record<string, string | undefined> = {};
  for (const key of Object.values(STATUS_ATTR)) a[key] = attr(raw, key);
  const state = a[STATUS_ATTR.state];
  const mode = a[STATUS_ATTR.mode];
  const lang = cleanText(a[STATUS_ATTR.lang], 12);
  return {
    state: (BROADCAST_STATES as readonly (string | undefined)[]).includes(state)
      ? (state as OperatorBroadcastState)
      : null,
    title: cleanText(a[STATUS_ATTR.title], MAX_TITLE_LENGTH),
    lang: lang && /^[a-z]{2,3}(-[a-z0-9]{2,8})?$/i.test(lang) ? lang : null,
    mode: mode === "translate" || mode === "original" ? mode : null,
    sinceMs: cleanNumber(a[STATUS_ATTR.since]),
    responseMs: cleanNumber(a[STATUS_ATTR.response]),
  };
}

/** Serialise a status for `localParticipant.setAttributes`. */
export function statusAttributes(s: {
  state: OperatorBroadcastState;
  title?: string | null;
  lang?: string | null;
  mode?: ChannelMode | null;
  sinceMs?: number | null;
  responseMs?: number | null;
}): Record<string, string> {
  return {
    [STATUS_ATTR.state]: s.state,
    [STATUS_ATTR.title]: (s.title ?? "").slice(0, MAX_TITLE_LENGTH),
    [STATUS_ATTR.lang]: s.lang ?? "",
    [STATUS_ATTR.mode]: s.mode ?? "",
    [STATUS_ATTR.since]: s.sinceMs != null ? String(Math.round(s.sinceMs)) : "",
    [STATUS_ATTR.response]:
      s.responseMs != null ? String(Math.round(s.responseMs)) : "",
  };
}
