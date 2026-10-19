/**
 * Event and room naming.
 *
 * A room carries one language of one event and is named
 * `<event-slug>-<language-code>`. The event page lists the rooms of an event
 * that currently have a publisher connected.
 *
 * This module has no imports so it can run in the browser, on the server and
 * under `node --test` alike.
 */

/** Lowercase alphanumerics and single dashes, at most 64 characters. */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);
}

export function eventRoomName(eventSlug: string, languageCode: string): string {
  return `${eventSlug}-${languageCode}`;
}

/** Every room name the event could use, one per known language code. */
export function eventRoomCandidates(
  eventSlug: string,
  languageCodes: readonly string[],
): string[] {
  if (!eventSlug) return [];
  return languageCodes.map((code) => eventRoomName(eventSlug, code));
}

/**
 * Language code of `roomName` if it is exactly `<eventSlug>-<code>` for one of
 * the known codes, otherwise null. Exact matching keeps events apart even when
 * one slug is a prefix of another (`demo` vs `demo-2`).
 */
export function languageOfRoom(
  roomName: string,
  eventSlug: string,
  languageCodes: readonly string[],
): string | null {
  if (!eventSlug) return null;
  const prefix = `${eventSlug}-`;
  if (!roomName.startsWith(prefix)) return null;
  const code = roomName.slice(prefix.length);
  return languageCodes.includes(code) ? code : null;
}

export type RoomParticipantSummary = {
  /** Whether this participant's token allows publishing. */
  canPublish: boolean;
};

export type LiveLanguage = {
  code: string;
  label: string;
  room: string;
};

/**
 * Languages of an event that are live: the room exists and at least one
 * participant in it can publish (the operator). Rooms created only by
 * listeners, which hold subscribe-only tokens, are not listed. The result
 * follows the order of `languages`.
 */
export function pickLiveLanguages(
  eventSlug: string,
  languages: ReadonlyArray<{ code: string; label: string }>,
  participantsByRoom: ReadonlyMap<string, readonly RoomParticipantSummary[]>,
): LiveLanguage[] {
  if (!eventSlug) return [];
  const codes = languages.map((l) => l.code);
  const live: LiveLanguage[] = [];
  for (const lang of languages) {
    const room = eventRoomName(eventSlug, lang.code);
    if (languageOfRoom(room, eventSlug, codes) !== lang.code) continue;
    const participants = participantsByRoom.get(room);
    if (!participants || !participants.some((p) => p.canPublish)) continue;
    live.push({ code: lang.code, label: lang.label, room });
  }
  return live;
}

export type RoomParticipantDetail = RoomParticipantSummary & {
  /** Participant attributes (the operator publishes its status there). */
  attributes?: Readonly<Record<string, string>>;
};

export type RoomStatusSummary = {
  /** Connected participants that cannot publish (listeners). */
  listeners: number;
  /** The operator's raw status attributes, or null if none publish one. */
  attributes: Readonly<Record<string, string>> | null;
};

/**
 * Listener count and the operator's status attributes for one room. The
 * first publisher that carries an `lt_state` attribute wins.
 */
export function summarizeRoom(
  participants: readonly RoomParticipantDetail[],
): RoomStatusSummary {
  let listeners = 0;
  let attributes: Readonly<Record<string, string>> | null = null;
  for (const p of participants) {
    if (!p.canPublish) {
      listeners++;
      continue;
    }
    // The server SDK spells attribute keys in camel case (ltState).
    const state = p.attributes?.lt_state ?? p.attributes?.ltState;
    if (!attributes && p.attributes && typeof state === "string") {
      attributes = p.attributes;
    }
  }
  return { listeners, attributes };
}
