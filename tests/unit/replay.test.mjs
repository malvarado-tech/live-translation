import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { cueAt, cuesUntil, formatClock, pickAudio, replayChannels } from "../../lib/replay.ts";

const EM_DASH = String.fromCharCode(0x2014);

const manifest = JSON.parse(
  readFileSync(new URL("../../public/replay/manifest.json", import.meta.url), "utf8"),
);

test("the replay manifest yields ES, PT and the English original", () => {
  const ch = replayChannels(manifest);
  assert.deepEqual(ch.map((c) => [c.code, c.original]), [
    ["es", false],
    ["pt", false],
    ["en", true],
  ]);
  for (const c of ch) {
    assert.ok(c.cues.length > 10, `${c.code} has cues`);
    assert.ok(pickAudio(c.audio, true), `${c.code} has audio`);
    for (const cue of c.cues) {
      assert.ok(cue.end > cue.start);
      assert.ok(!cue.text.includes(EM_DASH), "no em dash in captions");
    }
  }
  // Every channel shares the source timeline, so one clock drives all.
  assert.deepEqual(ch[0].cues.map((c) => c.start), ch[2].cues.map((c) => c.start));
});

test("audio files referenced by the manifest exist", () => {
  for (const c of replayChannels(manifest)) {
    for (const file of Object.values(c.audio)) {
      readFileSync(new URL(`../../public/replay/${file}`, import.meta.url));
    }
  }
});

test("cue lookup follows the clock", () => {
  const cues = [
    { id: 1, start: 0.4, end: 8, text: "a" },
    { id: 2, start: 8.5, end: 13, text: "b" },
  ];
  assert.deepEqual(cuesUntil(cues, 0), []);
  assert.deepEqual(cuesUntil(cues, 8.2).map((c) => c.id), [1]);
  assert.equal(cueAt(cues, 8.2), null);
  assert.equal(cueAt(cues, 9).id, 2);
  assert.deepEqual(cuesUntil(cues, 99).map((c) => c.id), [1, 2]);
});

test("audio choice and clock format", () => {
  assert.equal(pickAudio({ mp3: "a.mp3", webm_opus: "a.webm" }, true), "a.webm");
  assert.equal(pickAudio({ mp3: "a.mp3", webm_opus: "a.webm" }, false), "a.mp3");
  assert.equal(formatClock(125.9), "02:05");
});
