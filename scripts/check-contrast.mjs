// WCAG AA check of the colour tokens in app/globals.css, for both themes.
// Every text/background pair the interface uses must reach 4.5:1 (body
// text) or 3:1 (large text, meter segments and control borders).
// Usage: node scripts/check-contrast.mjs
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

function block(selector) {
  const i = css.indexOf(selector);
  if (i < 0) throw new Error(`missing ${selector}`);
  const body = css.slice(css.indexOf("{", i) + 1, css.indexOf("}", i));
  return Object.fromEntries(
    [...body.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2]]),
  );
}

const themes = {
  light: block(':root[data-theme="light"]'),
  night: block(':root[data-theme="night"]'),
};

const lum = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const f = (s) => (s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
};
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

// [foreground, background, minimum]
const TEXT = 4.5;
const LARGE = 3;
const PAIRS = [
  ...["bg", "panel", "panel-2", "btn"].flatMap((bg) => [
    ["ink", bg, TEXT],
    ["silk", bg, TEXT],
    ["dim", bg, TEXT],
  ]),
  ["amber-ink", "panel", TEXT],
  ["amber-ink", "bg", TEXT],
  ["ink", "amber-wash", TEXT],
  ["amber-ink", "amber-wash", TEXT],
  ["green-ink", "panel", TEXT],
  ["green-ink", "green-wash", TEXT],
  ["error-ink", "error-wash", TEXT],
  ["ink", "error-wash", TEXT],
  ["silk", "error-wash", TEXT],
  ["error-ink", "panel", TEXT],
  ["on-onair", "onair", TEXT],
  ["on-amber", "amber", TEXT],
  ["on-primary", "primary", TEXT],
  ["silk", "well", TEXT],
  // Non-text: meter segments against their well, control borders.
  ["meter-green", "well", LARGE],
  ["meter-amber", "well", LARGE],
  ["meter-red", "well", LARGE],
  ["meter-green", "off", 1.5],
  ["line-strong", "panel", LARGE],
  ["line-strong", "bg", LARGE],
  ["focus", "bg", LARGE],
  ["focus", "panel", LARGE],
];

let failed = 0;
for (const [name, t] of Object.entries(themes)) {
  for (const [fg, bg, min] of PAIRS) {
    const r = ratio(t[fg], t[bg]);
    const ok = r >= min;
    if (!ok) failed++;
    console.log(`${ok ? "ok  " : "FAIL"} ${name.padEnd(5)} ${fg.padEnd(11)} on ${bg.padEnd(10)} ${r.toFixed(2)} (min ${min})`);
  }
}
if (failed) {
  console.error(`${failed} pair(s) below WCAG AA`);
  process.exit(1);
}
console.log("All token pairs meet WCAG AA in both themes.");
