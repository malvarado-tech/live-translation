import assert from "node:assert/strict";
import { test } from "node:test";
import {
  broadcastStateOf,
  describeSession,
  initialSession,
  sessionReducer,
} from "../../lib/session-machine.ts";

function run(events, from = initialSession) {
  return events.reduce((s, e) => sessionReducer(s, e), from);
}

test("room flow: open, start, live, stop keeps the room, close ends", () => {
  let s = run([{ type: "open-room" }, { type: "room-opened" }]);
  assert.equal(s.phase, "room-open");
  assert.equal(s.hasRoom, true);
  s = run([{ type: "start" }, { type: "engine-live", at: 1000 }], s);
  assert.equal(s.phase, "live");
  assert.equal(s.liveSince, 1000);
  s = run([{ type: "stop" }, { type: "stopped" }], s);
  assert.equal(s.phase, "room-open");
  assert.equal(s.everLive, true);
  assert.equal(describeSession(s, true).label, "Paused");
  s = run([{ type: "close" }, { type: "closed" }], s);
  assert.deepEqual(s, initialSession);
});

test("a failed start shows one consistent fault, never 'live' controls", () => {
  const s = run([
    { type: "open-room" },
    { type: "room-opened" },
    { type: "start" },
    { type: "start-failed", scope: "Translation", message: "OPENAI_API_KEY is not configured" },
  ]);
  assert.equal(s.phase, "failed");
  assert.equal(s.hasRoom, true);
  const v = describeSession(s, true);
  assert.equal(v.label, "Fault");
  assert.equal(v.tone, "fault");
  assert.equal(v.canStop, false);
  assert.equal(v.canStart, true);
  assert.equal(v.canClose, true);
  assert.equal(s.error.message, "OPENAI_API_KEY is not configured");
});

test("without a room server a failed start returns to idle on dismiss", () => {
  let s = run([
    { type: "start" },
    { type: "start-failed", scope: "Mic", message: "NotAllowedError" },
  ]);
  const v = describeSession(s, false);
  assert.equal(v.canClose, false, "no Close room without a room");
  assert.equal(v.canStart, true);
  s = sessionReducer(s, { type: "dismiss" });
  assert.equal(s.phase, "idle");
  assert.equal(s.error, null);
});

test("idle offers Open room with a room server and Start without one", () => {
  assert.equal(describeSession(initialSession, true).canOpenRoom, true);
  assert.equal(describeSession(initialSession, true).canStart, false);
  assert.equal(describeSession(initialSession, false).canStart, true);
  assert.equal(describeSession(initialSession, false).canClose, false);
});

test("reconnecting carries the attempt and returns to live", () => {
  let s = run([
    { type: "start" },
    { type: "engine-live", at: 5 },
    { type: "engine-reconnecting", attempt: 2, max: 3 },
  ]);
  assert.equal(s.phase, "reconnecting");
  assert.equal(describeSession(s, false).label, "Reconnecting 2/3");
  s = sessionReducer(s, { type: "engine-live", at: 99 });
  assert.equal(s.phase, "live");
  assert.equal(s.liveSince, 5, "on-air clock keeps running across a reconnect");
});

test("engine lost after reconnects lands in failed", () => {
  const s = run([
    { type: "open-room" },
    { type: "room-opened" },
    { type: "start" },
    { type: "engine-live", at: 1 },
    { type: "engine-lost", message: "gave up after 3 attempts" },
  ]);
  assert.equal(s.phase, "failed");
  assert.equal(broadcastStateOf(s), "interrupted");
});

test("events that do not apply are ignored", () => {
  assert.equal(sessionReducer(initialSession, { type: "stop" }), initialSession);
  assert.equal(sessionReducer(initialSession, { type: "stopped" }), initialSession);
  assert.equal(sessionReducer(initialSession, { type: "engine-live", at: 1 }), initialSession);
  const live = run([{ type: "start" }, { type: "engine-live", at: 1 }]);
  assert.equal(sessionReducer(live, { type: "open-room" }), live);
});

test("room lost while live fails without a room", () => {
  const s = run([
    { type: "open-room" },
    { type: "room-opened" },
    { type: "start" },
    { type: "engine-live", at: 1 },
    { type: "room-lost", message: "signal closed" },
  ]);
  assert.equal(s.phase, "failed");
  assert.equal(s.hasRoom, false);
  assert.equal(describeSession(s, true).canOpenRoom, true);
});

test("broadcast state follows the phase", () => {
  let s = run([{ type: "open-room" }, { type: "room-opened" }]);
  assert.equal(broadcastStateOf(s), "waiting");
  s = run([{ type: "start" }], s);
  assert.equal(broadcastStateOf(s), "waiting");
  s = run([{ type: "engine-live", at: 1 }], s);
  assert.equal(broadcastStateOf(s), "live");
  s = run([{ type: "engine-reconnecting", attempt: 1, max: 3 }], s);
  assert.equal(broadcastStateOf(s), "reconnecting");
  s = run([{ type: "engine-live", at: 2 }, { type: "stop" }, { type: "stopped" }], s);
  assert.equal(broadcastStateOf(s), "paused");
  s = run([{ type: "close" }], s);
  assert.equal(broadcastStateOf(s), "ended");
  assert.equal(broadcastStateOf(initialSession), null);
});
