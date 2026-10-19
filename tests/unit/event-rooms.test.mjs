import assert from "node:assert/strict";
import { test } from "node:test";
import {
  eventRoomCandidates,
  eventRoomName,
  languageOfRoom,
  pickLiveLanguages,
  slugify,
  summarizeRoom,
} from "../../lib/event-rooms.ts";

const LANGS = [
  { code: "en", label: "English" },
  { code: "es", label: "Español" },
  { code: "fr", label: "Français" },
];
const CODES = LANGS.map((l) => l.code);
const operator = { canPublish: true };
const listener = { canPublish: false };

test("slugify matches the room naming used by the operator", () => {
  assert.equal(slugify("My Event 2026!"), "my-event-2026");
  assert.equal(slugify("--a__b--"), "a-b");
  assert.equal(slugify("x".repeat(80)).length, 64);
  assert.equal(slugify(""), "");
});

test("eventRoomName and candidates", () => {
  assert.equal(eventRoomName("demo", "en"), "demo-en");
  assert.deepEqual(eventRoomCandidates("demo", CODES), [
    "demo-en",
    "demo-es",
    "demo-fr",
  ]);
  assert.deepEqual(eventRoomCandidates("", CODES), []);
});

test("languageOfRoom matches only exact <event>-<code> names", () => {
  assert.equal(languageOfRoom("demo-en", "demo", CODES), "en");
  assert.equal(languageOfRoom("demo-2-en", "demo", CODES), null);
  assert.equal(languageOfRoom("demo-2-en", "demo-2", CODES), "en");
  assert.equal(languageOfRoom("demo-xx", "demo", CODES), null);
  assert.equal(languageOfRoom("other-en", "demo", CODES), null);
  assert.equal(languageOfRoom("demo-en", "", CODES), null);
});

test("pickLiveLanguages lists rooms with a publisher, in language order", () => {
  const rooms = new Map([
    ["demo-fr", [listener, operator]],
    ["demo-en", [operator]],
  ]);
  assert.deepEqual(pickLiveLanguages("demo", LANGS, rooms), [
    { code: "en", label: "English", room: "demo-en" },
    { code: "fr", label: "Français", room: "demo-fr" },
  ]);
});

test("pickLiveLanguages skips rooms that only listeners created", () => {
  const rooms = new Map([
    ["demo-en", [listener, listener]],
    ["demo-es", []],
  ]);
  assert.deepEqual(pickLiveLanguages("demo", LANGS, rooms), []);
});

test("pickLiveLanguages ignores rooms of other events", () => {
  const rooms = new Map([
    ["demo-2-en", [operator]],
    ["demox-en", [operator]],
  ]);
  assert.deepEqual(pickLiveLanguages("demo", LANGS, rooms), []);
  assert.deepEqual(pickLiveLanguages("demo-2", LANGS, rooms), [
    { code: "en", label: "English", room: "demo-2-en" },
  ]);
});

test("pickLiveLanguages with an empty event slug returns nothing", () => {
  const rooms = new Map([["-en", [operator]]]);
  assert.deepEqual(pickLiveLanguages("", LANGS, rooms), []);
});

test("summarizeRoom counts listeners and reads the operator status", () => {
  const status = { lt_state: "live", lt_title: "Talk" };
  assert.deepEqual(
    summarizeRoom([
      { canPublish: false },
      { canPublish: true, attributes: {} },
      { canPublish: true, attributes: status },
      { canPublish: false, attributes: { lt_state: "ended" } },
    ]),
    { listeners: 2, attributes: status },
  );
  assert.deepEqual(summarizeRoom([]), { listeners: 0, attributes: null });
});
