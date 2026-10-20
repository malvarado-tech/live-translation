import assert from "node:assert/strict";
import { test } from "node:test";
import { appendCaption, captionLines, emptyCaptions, MAX_CAPTION_LINES } from "../../lib/captions.ts";

const feed = (deltas) => deltas.reduce(appendCaption, emptyCaptions);

test("deltas become sentence lines with the current line last", () => {
  const s = feed(["Elegimos ir ", "a la Luna. ", "Elegimos ir a la Luna en esta década"]);
  assert.deepEqual(s.lines.map((l) => l.text), ["Elegimos ir a la Luna."]);
  assert.equal(s.current, "Elegimos ir a la Luna en esta década");
  assert.deepEqual(captionLines(s).map((l) => l.text), [
    "Elegimos ir a la Luna.",
    "Elegimos ir a la Luna en esta década",
  ]);
});

test("questions and closing quotes end a line", () => {
  const s = feed(["¿Por qué la Luna? ", "«Porque es difícil.» Y"]);
  assert.deepEqual(s.lines.map((l) => l.text), ["¿Por qué la Luna?", "«Porque es difícil.»"]);
  assert.equal(s.current, "Y");
});

test("a long run-on sentence breaks at a comma", () => {
  const long = "palabra ".repeat(15) + "coma, " + "otra ".repeat(20);
  const s = feed([long]);
  assert.ok(s.lines.length >= 1);
  assert.ok(s.lines[0].text.endsWith(","));
  assert.ok(captionLines(s).every((l) => l.text.length <= 180));
});

test("a session's lines are kept for scroll-back", () => {
  let s = emptyCaptions;
  for (let i = 0; i < 600; i++) s = appendCaption(s, `Linea ${i}. `);
  assert.equal(s.lines.length, 600);
  assert.equal(s.lines[0].text, "Linea 0.");
});

test("ids are stable and unique; lines beyond the limit are trimmed", () => {
  let s = emptyCaptions;
  const n = MAX_CAPTION_LINES + 20;
  for (let i = 0; i < n; i++) s = appendCaption(s, `Linea ${i}. `);
  assert.equal(s.lines.length, MAX_CAPTION_LINES);
  const ids = s.lines.map((l) => l.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(s.lines[0].text, "Linea 20.");
  assert.equal(s.lines.at(-1).text, `Linea ${n - 1}.`);
});

test("lines carry the time their first words arrived", () => {
  let s = appendCaption(emptyCaptions, "We choose ", 100);
  s = appendCaption(s, "to go. Not ", 200);
  s = appendCaption(s, "because", 300);
  assert.deepEqual(captionLines(s).map((l) => [l.text, l.at]), [
    ["We choose to go.", 100],
    ["Not because", 200],
  ]);
});
