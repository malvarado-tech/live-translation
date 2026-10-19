import assert from "node:assert/strict";
import { test } from "node:test";
import {
  classifyDisconnect,
  deriveListenerDisplay,
  listenerTone,
  SILENCE_REPORT_MS,
} from "../../lib/listener-health.ts";
import {
  LISTENER_STRINGS,
  uiLangForBrowser,
  uiLangForRoom,
} from "../../lib/listener-strings.ts";
import { parseOperatorStatus, statusAttributes } from "../../lib/session-status.ts";
import { eventOfRoomName, languageOfRoomName } from "../../lib/languages.ts";

const base = {
  connection: "connected",
  operatorPresent: true,
  operatorSeen: true,
  operatorState: "live",
  hasAudio: true,
  silentMs: 0,
};

test("listener display: one row per situation", () => {
  const cases = [
    [{ connection: "idle" }, "idle"],
    [{ connection: "connecting" }, "connecting"],
    [{ connection: "reconnecting" }, "network-reconnecting"],
    [{ connection: "rejoining" }, "network-reconnecting"],
    [{ connection: "left" }, "left"],
    [{ connection: "ended" }, "ended"],
    [{ connection: "unavailable" }, "unavailable"],
    [{}, "live"],
    [{ silentMs: SILENCE_REPORT_MS }, "silent"],
    [{ silentMs: SILENCE_REPORT_MS - 1 }, "live"],
    [{ hasAudio: false }, "silent"],
    [{ operatorState: "paused" }, "paused"],
    [{ operatorState: "waiting", hasAudio: false }, "waiting"],
    [{ operatorState: "reconnecting" }, "translation-reconnecting"],
    [{ operatorState: "interrupted" }, "interrupted"],
    [{ operatorState: "ended" }, "ended"],
    [{ operatorState: "ended", operatorPresent: false }, "ended"],
    [{ operatorPresent: false, operatorSeen: false, operatorState: null }, "waiting"],
    [{ operatorPresent: false, operatorSeen: true }, "interrupted"],
    [{ operatorState: null, hasAudio: false }, "waiting"],
    [{ operatorState: null }, "live"],
  ];
  for (const [patch, expected] of cases) {
    assert.equal(
      deriveListenerDisplay({ ...base, ...patch }),
      expected,
      JSON.stringify(patch),
    );
  }
});

test("a network blip is never shown as the end of the session", () => {
  assert.equal(classifyDisconnect(undefined), "network");
  assert.equal(classifyDisconnect(0), "network");
  assert.equal(classifyDisconnect(14), "network");
  assert.equal(classifyDisconnect(9), "network");
  assert.equal(classifyDisconnect(1), "client");
  assert.equal(classifyDisconnect(5), "room-gone");
  assert.equal(classifyDisconnect(10), "room-gone");
  assert.equal(deriveListenerDisplay({ ...base, connection: "rejoining" }), "network-reconnecting");
  assert.equal(listenerTone("network-reconnecting"), "warn");
});

test("listener strings: same keys in both languages, no em dashes, no slugs", () => {
  const flat = (obj, prefix = "") =>
    Object.entries(obj).flatMap(([k, v]) =>
      typeof v === "object" ? flat(v, `${prefix}${k}.`) : [[`${prefix}${k}`, v]],
    );
  const es = flat(LISTENER_STRINGS.es);
  const en = flat(LISTENER_STRINGS.en);
  assert.deepEqual(es.map(([k]) => k), en.map(([k]) => k));
  for (const [k, v] of [...es, ...en]) {
    const text = typeof v === "function" ? v("1.1", 2) : String(v);
    assert.ok(!text.includes("—"), `em dash in ${k}`);
    assert.ok(!/\b(tu|tú|te|elige|toca)\b/i.test(text), `conversational Spanish in ${k}: ${text}`);
  }
});

test("interface language follows the room, then the browser", () => {
  assert.equal(uiLangForRoom("es"), "es");
  assert.equal(uiLangForRoom("pt"), "en");
  assert.equal(uiLangForRoom(null), "en");
  assert.equal(uiLangForBrowser(["es-MX", "en"]), "es");
  assert.equal(uiLangForBrowser(["fr-FR", "en-US"]), "en");
  assert.equal(uiLangForBrowser([]), "en");
});

test("operator status attributes round-trip and reject junk", () => {
  const attrs = statusAttributes({
    state: "live",
    title: "Rice University address",
    lang: "es",
    mode: "translate",
    sinceMs: 1700000000000,
    responseMs: 1100.4,
  });
  assert.deepEqual(parseOperatorStatus(attrs), {
    state: "live",
    title: "Rice University address",
    lang: "es",
    mode: "translate",
    sinceMs: 1700000000000,
    responseMs: 1100,
  });
  const junk = parseOperatorStatus({
    lt_state: "hacked",
    lt_title: "\u0007" + "x".repeat(500),
    lt_lang: "<script>",
    lt_mode: "both",
    lt_since: "-5",
    lt_response_ms: "abc",
  });
  assert.equal(junk.state, null);
  assert.equal(junk.title.length, 120);
  assert.equal(junk.lang, null);
  assert.equal(junk.mode, null);
  assert.equal(junk.sinceMs, null);
  assert.equal(junk.responseMs, null);
  assert.deepEqual(parseOperatorStatus(undefined).state, null);
});

test("room names map back to event and language", () => {
  assert.equal(languageOfRoomName("demo-es"), "es");
  assert.equal(eventOfRoomName("rice-1962-pt"), "rice-1962");
  assert.equal(languageOfRoomName("demo-xx"), null);
  assert.equal(eventOfRoomName("es"), null);
});
