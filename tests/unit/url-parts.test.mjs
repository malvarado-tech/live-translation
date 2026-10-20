import assert from "node:assert/strict";
import { test } from "node:test";
import { urlParts } from "../../lib/url-parts.ts";

test("a listener URL breaks after slashes and before query separators", () => {
  assert.deepEqual(urlParts("https://malvarado.org/demos/translation/replay"), [
    "https://",
    "malvarado.org/",
    "demos/",
    "translation/",
    "replay",
  ]);
  assert.deepEqual(urlParts("live.example.org/e/demo?lang=pt&x=1#top"), [
    "live.example.org/",
    "e/",
    "demo",
    "?lang=pt",
    "&x=1",
    "#top",
  ]);
});

test("joining the parts gives the URL back unchanged", () => {
  for (const url of ["https://a.b/c/", "a", "", "https://x.org//double/", "/e/x?y"]) {
    assert.equal(urlParts(url).join(""), url);
  }
});
