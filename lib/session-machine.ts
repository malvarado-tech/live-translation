/**
 * Operator session state machine.
 *
 * One reducer owns the session phase. The header tally, the buttons, the
 * status that listeners receive and the alert slot are all derived from it,
 * so they can never disagree (a failed start used to leave "Idle" in the
 * header next to a "Stop translation" button).
 *
 * With a room server: idle -> opening -> room-open -> starting -> live,
 * live <-> reconnecting, live -> stopping -> room-open, any -> closing -> idle.
 * Without a room server: idle -> starting -> live -> stopping -> idle.
 * Failures land in `failed`, which remembers whether the room is still open.
 *
 * No imports, so it runs under `node --test` as well as in the browser.
 */

export type SessionPhase =
  | "idle"
  | "opening"
  | "room-open"
  | "starting"
  | "live"
  | "reconnecting"
  | "stopping"
  | "closing"
  | "failed";

export type SessionError = {
  scope: string;
  message: string;
};

export type SessionState = {
  phase: SessionPhase;
  /** The room connection is up (listeners can join). */
  hasRoom: boolean;
  /** Translation reached `live` at least once since the room opened. */
  everLive: boolean;
  /** Set in `failed`; cleared on retry or dismiss. */
  error: SessionError | null;
  /** Set in `reconnecting`. */
  reconnect: { attempt: number; max: number } | null;
  /** ms timestamp when the current on-air stretch started. */
  liveSince: number | null;
};

export type SessionEvent =
  | { type: "open-room" }
  | { type: "room-opened" }
  | { type: "room-failed"; message: string }
  | { type: "room-lost"; message: string }
  | { type: "start" }
  | { type: "engine-live"; at: number }
  | { type: "engine-reconnecting"; attempt: number; max: number }
  | { type: "start-failed"; scope: string; message: string }
  | { type: "engine-lost"; message: string }
  | { type: "stop" }
  | { type: "stopped" }
  | { type: "close" }
  | { type: "closed" }
  | { type: "dismiss" };

export const initialSession: SessionState = {
  phase: "idle",
  hasRoom: false,
  everLive: false,
  error: null,
  reconnect: null,
  liveSince: null,
};

function restPhase(hasRoom: boolean): SessionPhase {
  return hasRoom ? "room-open" : "idle";
}

export function sessionReducer(
  state: SessionState,
  event: SessionEvent,
): SessionState {
  switch (event.type) {
    case "open-room":
      if (state.phase !== "idle" && !(state.phase === "failed" && !state.hasRoom)) {
        return state;
      }
      return { ...initialSession, phase: "opening" };

    case "room-opened":
      if (state.phase !== "opening") return state;
      return { ...state, phase: "room-open", hasRoom: true, error: null };

    case "room-failed":
      if (state.phase !== "opening") return state;
      return {
        ...state,
        phase: "failed",
        hasRoom: false,
        error: { scope: "Room", message: event.message },
      };

    case "room-lost":
      if (!state.hasRoom) return state;
      if (state.phase === "closing") return state;
      return {
        ...state,
        phase: "failed",
        hasRoom: false,
        reconnect: null,
        liveSince: null,
        error: { scope: "Room", message: event.message },
      };

    case "start":
      if (
        state.phase === "room-open" ||
        state.phase === "idle" ||
        state.phase === "failed"
      ) {
        return { ...state, phase: "starting", error: null, reconnect: null };
      }
      return state;

    case "engine-live":
      if (state.phase !== "starting" && state.phase !== "reconnecting") {
        return state;
      }
      return {
        ...state,
        phase: "live",
        everLive: true,
        reconnect: null,
        liveSince: state.liveSince ?? event.at,
      };

    case "engine-reconnecting":
      if (state.phase !== "live" && state.phase !== "reconnecting") return state;
      return {
        ...state,
        phase: "reconnecting",
        reconnect: { attempt: event.attempt, max: event.max },
      };

    case "start-failed":
      if (state.phase !== "starting") return state;
      return {
        ...state,
        phase: "failed",
        reconnect: null,
        liveSince: null,
        error: { scope: event.scope, message: event.message },
      };

    case "engine-lost":
      if (state.phase !== "live" && state.phase !== "reconnecting") return state;
      return {
        ...state,
        phase: "failed",
        reconnect: null,
        liveSince: null,
        error: { scope: "Translation", message: event.message },
      };

    case "stop":
      if (
        state.phase === "live" ||
        state.phase === "reconnecting" ||
        state.phase === "starting"
      ) {
        return { ...state, phase: "stopping" };
      }
      return state;

    case "stopped":
      if (state.phase !== "stopping") return state;
      return {
        ...state,
        phase: restPhase(state.hasRoom),
        reconnect: null,
        liveSince: null,
      };

    case "close":
      if (state.phase === "idle" || state.phase === "closing") return state;
      if (state.phase === "opening") return state;
      return { ...state, phase: "closing" };

    case "closed":
      return { ...initialSession };

    case "dismiss":
      if (state.phase !== "failed") return state;
      return { ...state, phase: restPhase(state.hasRoom), error: null };
  }
}

export type SessionTone = "off" | "standby" | "busy" | "onair" | "warn" | "fault";

export type SessionView = {
  label: string;
  tone: SessionTone;
  /** Primary action, if any. */
  canOpenRoom: boolean;
  canStart: boolean;
  canStop: boolean;
  canClose: boolean;
  canRetry: boolean;
  /** Configuration (event, language, devices) can be edited. */
  canConfigure: boolean;
  /** Something is in flight; buttons should show progress. */
  busy: boolean;
};

/**
 * Everything the screen shows about the session, from one state.
 * `withRoom` = a room server is configured.
 */
export function describeSession(
  state: SessionState,
  withRoom: boolean,
): SessionView {
  const base: SessionView = {
    label: "Off air",
    tone: "off",
    canOpenRoom: false,
    canStart: false,
    canStop: false,
    canClose: false,
    canRetry: false,
    canConfigure: false,
    busy: false,
  };
  switch (state.phase) {
    case "idle":
      return {
        ...base,
        label: "Off air",
        canOpenRoom: withRoom,
        canStart: !withRoom,
        canConfigure: true,
      };
    case "opening":
      return { ...base, label: "Opening room", tone: "busy", busy: true };
    case "room-open":
      return {
        ...base,
        label: state.everLive ? "Paused" : "Room open",
        tone: "standby",
        canStart: true,
        canClose: true,
      };
    case "starting":
      return {
        ...base,
        label: "Starting",
        tone: "busy",
        busy: true,
        canStop: true,
        canClose: state.hasRoom,
      };
    case "live":
      return {
        ...base,
        label: "On air",
        tone: "onair",
        canStop: true,
        canClose: state.hasRoom,
      };
    case "reconnecting":
      return {
        ...base,
        label: state.reconnect
          ? `Reconnecting ${state.reconnect.attempt}/${state.reconnect.max}`
          : "Reconnecting",
        tone: "warn",
        canStop: true,
        canClose: state.hasRoom,
      };
    case "stopping":
      return { ...base, label: "Stopping", tone: "busy", busy: true };
    case "closing":
      return { ...base, label: "Closing room", tone: "busy", busy: true };
    case "failed":
      return {
        ...base,
        label: "Fault",
        tone: "fault",
        canRetry: true,
        canStart: state.hasRoom || !withRoom,
        canOpenRoom: withRoom && !state.hasRoom,
        canClose: state.hasRoom,
        canConfigure: !state.hasRoom,
      };
  }
}

/** Values of the operator's `lt_state` participant attribute. */
export type BroadcastState =
  | "waiting"
  | "live"
  | "paused"
  | "reconnecting"
  | "interrupted"
  | "ended";

/**
 * What listeners are told about the session, or null when there is no room
 * to tell them through.
 */
export function broadcastStateOf(state: SessionState): BroadcastState | null {
  if (!state.hasRoom) return null;
  switch (state.phase) {
    case "room-open":
    case "starting":
      return state.everLive ? "paused" : "waiting";
    case "live":
      return "live";
    case "reconnecting":
      return "reconnecting";
    case "stopping":
      return "paused";
    case "failed":
      return state.everLive ? "interrupted" : "waiting";
    case "closing":
      return "ended";
    default:
      return null;
  }
}
