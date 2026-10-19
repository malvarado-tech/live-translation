/**
 * Server-side lookup of the live languages of an event.
 *
 * Never import from a client module: it reads the LiveKit API secret.
 *
 * Results are cached per event for a few seconds and concurrent lookups for
 * the same event share one request, so the number of LiveKit API calls does
 * not grow with the number of listeners polling the event page. A global
 * budget caps upstream refreshes when many different event names are
 * requested.
 */
import { RoomServiceClient } from "livekit-server-sdk";
import {
  eventRoomCandidates,
  pickLiveLanguages,
  summarizeRoom,
  type LiveLanguage,
  type RoomParticipantDetail,
} from "@/lib/event-rooms";
import { parseOperatorStatus, type OperatorStatus } from "@/lib/session-status";
import { TARGET_LANGUAGES } from "@/lib/languages";
import { createRateLimiter } from "@/lib/rate-limit";

const CACHE_TTL_MS = 5_000;
const CACHE_MAX_ENTRIES = 500;
const UPSTREAM_REFRESHES_PER_MINUTE = 120;

/** Public per-language status shown on the event page and operator desk. */
export type LanguageStatus = {
  state: OperatorStatus["state"];
  mode: OperatorStatus["mode"];
  listeners: number;
  sinceMs: number | null;
  responseMs: number | null;
};

export type EventLanguage = LiveLanguage & { status?: LanguageStatus };

export type EventLanguagesResult = {
  configured: boolean;
  /** Event title published by an operator, if any. */
  title?: string | null;
  languages: EventLanguage[];
};

export class UpstreamBusyError extends Error {
  constructor() {
    super("Too many lookups right now.");
  }
}

const cache = new Map<string, { at: number; value: EventLanguagesResult }>();
const inflight = new Map<string, Promise<EventLanguagesResult>>();
const upstreamBudget = createRateLimiter({
  limit: UPSTREAM_REFRESHES_PER_MINUTE,
  windowMs: 60_000,
  maxKeys: 1,
});

let client: RoomServiceClient | null = null;
let clientKey = "";

/** HTTP(S) base URL of the LiveKit server API, or "" when not configured. */
export function livekitApiHost(env: NodeJS.ProcessEnv = process.env): string {
  const raw = (env.LIVEKIT_API_URL || env.NEXT_PUBLIC_LIVEKIT_URL || "").trim();
  if (!raw) return "";
  return raw.replace(/^ws:\/\//i, "http://").replace(/^wss:\/\//i, "https://");
}

function getClient(): RoomServiceClient | null {
  const host = livekitApiHost();
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  if (!host || !apiKey || !apiSecret) return null;
  const key = `${host}|${apiKey}`;
  if (!client || clientKey !== key) {
    client = new RoomServiceClient(host, apiKey, apiSecret);
    clientKey = key;
  }
  return client;
}

async function lookup(
  svc: RoomServiceClient,
  eventSlug: string,
): Promise<EventLanguagesResult> {
  const candidates = eventRoomCandidates(
    eventSlug,
    TARGET_LANGUAGES.map((l) => l.code),
  );
  const rooms = await svc.listRooms(candidates);
  const candidateSet = new Set(candidates);
  const participantsByRoom = new Map<string, RoomParticipantDetail[]>();
  await Promise.all(
    rooms
      .filter((r) => candidateSet.has(r.name))
      .map(async (r) => {
        const participants = await svc.listParticipants(r.name);
        participantsByRoom.set(
          r.name,
          participants.map((p) => ({
            canPublish: Boolean(p.permission?.canPublish),
            attributes: p.attributes ?? {},
          })),
        );
      }),
  );
  let title: string | null = null;
  const languages: EventLanguage[] = pickLiveLanguages(
    eventSlug,
    TARGET_LANGUAGES,
    participantsByRoom,
  ).map((lang) => {
    const summary = summarizeRoom(participantsByRoom.get(lang.room) ?? []);
    const op = parseOperatorStatus(summary.attributes);
    if (!title && op.title) title = op.title;
    return {
      ...lang,
      status: {
        state: op.state,
        mode: op.mode,
        listeners: summary.listeners,
        sinceMs: op.sinceMs,
        responseMs: op.responseMs,
      },
    };
  });
  return { configured: true, title, languages };
}

export async function getEventLanguages(
  eventSlug: string,
): Promise<EventLanguagesResult> {
  const svc = getClient();
  if (!svc) return { configured: false, languages: [] };

  const now = Date.now();
  const cached = cache.get(eventSlug);
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.value;

  const pending = inflight.get(eventSlug);
  if (pending) return pending;

  if (!upstreamBudget.hit("global", now)) {
    if (cached) return cached.value;
    throw new UpstreamBusyError();
  }

  const request = lookup(svc, eventSlug)
    .then((value) => {
      if (cache.size >= CACHE_MAX_ENTRIES) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest);
      }
      cache.delete(eventSlug);
      cache.set(eventSlug, { at: Date.now(), value });
      return value;
    })
    .finally(() => {
      inflight.delete(eventSlug);
    });
  inflight.set(eventSlug, request);
  return request;
}
