/**
 * Operator-side LiveKit publisher.
 *
 * Two-phase by design:
 *   1. startPublisher() connects to the LiveKit room (creates it, holds it
 *      open). Listeners can join and wait. No audio yet.
 *   2. publisher.publishTrack(track) publishes a translated-audio track once
 *      translation actually starts. unpublishTrack() removes it (e.g. between
 *      speakers) without tearing down the room.
 *
 * This lets the operator share the listener link / QR before the talk begins,
 * and pause translation between speakers without dropping listeners.
 */
import {
  LocalAudioTrack,
  Room,
  RoomEvent,
  type RoomConnectOptions,
} from "livekit-client";

export type PublisherStatus =
  | "connecting"
  | "live"
  | "reconnecting"
  | "closed"
  | "error";

export type PublisherEvent =
  | { type: "status"; status: PublisherStatus }
  | { type: "error"; message: string }
  | { type: "participant-count"; count: number }
  /** The room connection dropped without stop() being called. */
  | { type: "lost"; message: string };

export type PublisherListener = (event: PublisherEvent) => void;

export type StartPublisherOptions = {
  room: string;
  onEvent?: PublisherListener;
  /** Optional override; otherwise hits /api/publish-token */
  tokenEndpoint?: string;
};

export type Publisher = {
  /** Publish (or replace) the translated-audio track into the room. */
  publishTrack: (track: MediaStreamTrack) => Promise<void>;
  /** Remove the published track but keep the room connection alive. */
  unpublishTrack: () => Promise<void>;
  /** Broadcast a caption delta to all listeners via the LiveKit data channel.
   *  Best-effort: swallows errors (a dropped caption never justifies tearing
   *  the room down). */
  publishCaption: (delta: string) => Promise<void>;
  /** Publish the operator's session status as participant attributes
   *  (see lib/session-status.ts). Best-effort, like captions. */
  setStatus: (attributes: Record<string, string>) => Promise<void>;
  /** Disconnect from the room entirely. */
  stop: () => Promise<void>;
};

/** Topic used on the LiveKit data channel for listener caption deltas. */
export const CAPTION_TOPIC = "captions";

/** Wire-format for caption messages on the data channel. */
export type CaptionMessage = {
  kind: "caption";
  delta: string;
  /** Operator-side ms timestamp; mostly informational. */
  t: number;
};

type TokenResponse = {
  token?: string;
  url?: string;
  error?: string;
};

export async function startPublisher(
  opts: StartPublisherOptions,
): Promise<Publisher> {
  const { room, onEvent } = opts;
  const tokenEndpoint = opts.tokenEndpoint ?? "/api/publish-token";

  function emit(event: PublisherEvent) {
    try {
      onEvent?.(event);
    } catch (err) {
      console.error("[livekit-publisher] listener threw", err);
    }
  }

  emit({ type: "status", status: "connecting" });

  const tokenResponse = await fetch(tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ room }),
  });
  const tokenData = (await tokenResponse.json()) as TokenResponse;
  if (!tokenResponse.ok || !tokenData.token || !tokenData.url) {
    const message = tokenData.error ?? "Failed to obtain publisher token.";
    emit({ type: "error", message });
    emit({ type: "status", status: "error" });
    throw new Error(message);
  }

  const lkRoom = new Room({ adaptiveStream: false, dynacast: false });
  let stopping = false;

  lkRoom
    .on(RoomEvent.ParticipantConnected, () => {
      emit({
        type: "participant-count",
        count: lkRoom.remoteParticipants.size,
      });
    })
    .on(RoomEvent.ParticipantDisconnected, () => {
      emit({
        type: "participant-count",
        count: lkRoom.remoteParticipants.size,
      });
    })
    .on(RoomEvent.Reconnecting, () => {
      emit({ type: "status", status: "reconnecting" });
    })
    .on(RoomEvent.Reconnected, () => {
      emit({ type: "status", status: "live" });
    })
    .on(RoomEvent.Disconnected, () => {
      emit({ type: "status", status: "closed" });
      if (!stopping) {
        emit({ type: "lost", message: "Connection to the room server was lost." });
      }
    });

  const connectOptions: RoomConnectOptions = { autoSubscribe: false };

  try {
    await lkRoom.connect(tokenData.url, tokenData.token, connectOptions);
    emit({ type: "status", status: "live" });
    emit({
      type: "participant-count",
      count: lkRoom.remoteParticipants.size,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    emit({ type: "error", message });
    emit({ type: "status", status: "error" });
    try {
      await lkRoom.disconnect();
    } catch {
      // ignore
    }
    throw err;
  }

  let publishedTrack: LocalAudioTrack | null = null;

  async function unpublishTrack() {
    if (!publishedTrack) return;
    try {
      await lkRoom.localParticipant.unpublishTrack(publishedTrack);
    } catch (err) {
      console.error("[livekit-publisher] unpublishTrack failed", err);
    } finally {
      publishedTrack = null;
    }
  }

  async function publishTrack(track: MediaStreamTrack) {
    if (publishedTrack) {
      await unpublishTrack();
    }
    publishedTrack = new LocalAudioTrack(track);
    await lkRoom.localParticipant.publishTrack(publishedTrack, {
      name: `translation-${room}`,
    });
  }

  const captionEncoder = new TextEncoder();
  async function publishCaption(delta: string) {
    if (!delta) return;
    try {
      const payload: CaptionMessage = {
        kind: "caption",
        delta,
        t: Date.now(),
      };
      const bytes = captionEncoder.encode(JSON.stringify(payload));
      // `reliable: true` so we don't drop transcript words. The room's
      // localParticipant.publishData fans this out to every connected listener.
      await lkRoom.localParticipant.publishData(bytes, {
        reliable: true,
        topic: CAPTION_TOPIC,
      });
    } catch (err) {
      // Best-effort: a dropped caption shouldn't surface as a session error.
      console.warn("[livekit-publisher] caption publish failed", err);
    }
  }

  // Status updates are serialised: only the latest wanted value is sent,
  // one request at a time, and a failed send is retried. Overlapping
  // setAttributes calls can be rejected, which used to leave listeners on a
  // stale state.
  let sentJson = "";
  let wanted: Record<string, string> | null = null;
  let sending: Promise<void> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  async function flushStatus(): Promise<void> {
    while (wanted && !stopping) {
      const next = wanted;
      const json = JSON.stringify(next);
      wanted = null;
      if (json === sentJson) continue;
      try {
        await lkRoom.localParticipant.setAttributes(next);
        sentJson = json;
      } catch (err) {
        console.warn("[livekit-publisher] status update failed, retrying", err);
        if (!wanted) wanted = next;
        if (!retryTimer) {
          retryTimer = setTimeout(() => {
            retryTimer = null;
            void setStatus(wanted ?? next);
          }, 1000);
        }
        return;
      }
    }
  }

  function setStatus(attributes: Record<string, string>): Promise<void> {
    wanted = attributes;
    if (!sending) {
      sending = flushStatus().finally(() => {
        sending = null;
      });
    }
    return sending;
  }

  async function stop() {
    // Let a pending status (for example "ended") reach listeners first.
    if (sending) await sending.catch(() => {});
    stopping = true;
    if (retryTimer) clearTimeout(retryTimer);
    try {
      await unpublishTrack();
      await lkRoom.disconnect();
    } finally {
      emit({ type: "status", status: "closed" });
    }
  }

  return { publishTrack, unpublishTrack, publishCaption, setStatus, stop };
}
