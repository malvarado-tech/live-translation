/**
 * Listener health: one displayed state from everything the listener page
 * knows (room connection, the operator's status attribute, whether an audio
 * track is attached and how long it has been silent).
 *
 * No imports, so it runs under `node --test` as well as in the browser.
 */

/** Connection of this listener to the room. */
export type ListenerConnection =
  | "idle"
  | "connecting"
  | "connected"
  /** LiveKit is resuming the same session (signal or media blip). */
  | "reconnecting"
  /** The session was lost; the page is fetching a new token and rejoining. */
  | "rejoining"
  /** The listener left on purpose. */
  | "left"
  | "ended"
  | "unavailable";

export type OperatorSignal =
  | "waiting"
  | "live"
  | "paused"
  | "reconnecting"
  | "interrupted"
  | "ended";

export type ListenerDisplay =
  | "idle"
  | "connecting"
  | "waiting"
  | "live"
  | "silent"
  | "paused"
  | "translation-reconnecting"
  | "interrupted"
  | "network-reconnecting"
  | "left"
  | "ended"
  | "unavailable";

export type ListenerTone = "live" | "warn" | "standby" | "off" | "error";

export type ListenerHealthInput = {
  connection: ListenerConnection;
  /** An operator (publisher) participant is in the room. */
  operatorPresent: boolean;
  /** An operator was in the room earlier in this visit. */
  operatorSeen: boolean;
  /** The operator's `lt_state` attribute, if any. */
  operatorState: OperatorSignal | null;
  /** A translated audio track is attached. */
  hasAudio: boolean;
  /** How long the incoming audio has been below the silence threshold. */
  silentMs: number;
};

/** Silence longer than this, while the operator says "live", is reported. */
export const SILENCE_REPORT_MS = 8_000;

const TONE: Record<ListenerDisplay, ListenerTone> = {
  idle: "off",
  connecting: "warn",
  waiting: "standby",
  live: "live",
  silent: "warn",
  paused: "standby",
  "translation-reconnecting": "warn",
  interrupted: "warn",
  "network-reconnecting": "warn",
  left: "off",
  ended: "off",
  unavailable: "error",
};

export function listenerTone(display: ListenerDisplay): ListenerTone {
  return TONE[display];
}

export function deriveListenerDisplay(i: ListenerHealthInput): ListenerDisplay {
  switch (i.connection) {
    case "idle":
      return "idle";
    case "connecting":
      return "connecting";
    case "reconnecting":
    case "rejoining":
      return "network-reconnecting";
    case "left":
      return "left";
    case "ended":
      return "ended";
    case "unavailable":
      return "unavailable";
    case "connected":
      break;
  }
  if (i.operatorState === "ended") return "ended";
  if (!i.operatorPresent) return i.operatorSeen ? "interrupted" : "waiting";
  switch (i.operatorState) {
    case "reconnecting":
      return "translation-reconnecting";
    case "interrupted":
      return "interrupted";
    case "paused":
      return "paused";
    case "waiting":
      return "waiting";
    case "live":
      if (!i.hasAudio) return "silent";
      return i.silentMs >= SILENCE_REPORT_MS ? "silent" : "live";
    default:
      // An operator without the status attribute (older build).
      if (!i.hasAudio) return "waiting";
      return i.silentMs >= SILENCE_REPORT_MS ? "silent" : "live";
  }
}

/** Disconnect reasons after which rejoining makes no sense. */
export type DisconnectKind = "client" | "room-gone" | "removed" | "duplicate" | "network";

/**
 * Map a LiveKit DisconnectReason number to what the listener should do.
 * Values follow livekit `DisconnectReason`: 1 client initiated, 2 duplicate
 * identity, 4 participant removed, 5 room deleted, 10 room closed.
 */
export function classifyDisconnect(reason: number | undefined): DisconnectKind {
  switch (reason) {
    case 1:
      return "client";
    case 2:
      return "duplicate";
    case 4:
      return "removed";
    case 5:
    case 10:
      return "room-gone";
    default:
      return "network";
  }
}

export const REJOIN_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 15_000] as const;
