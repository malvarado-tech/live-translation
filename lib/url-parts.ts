/**
 * Splits a URL into the pieces between its natural line-break points: after
 * each run of slashes and before `?`, `#` and `&`. Joining the parts gives
 * the URL back unchanged.
 *
 * No imports, so it runs under `node --test` as well as in the browser.
 */
export function urlParts(url: string): string[] {
  const parts: string[] = [];
  let cur = "";
  for (let i = 0; i < url.length; i++) {
    const ch = url[i];
    if ((ch === "?" || ch === "#" || ch === "&") && cur) {
      parts.push(cur);
      cur = "";
    }
    cur += ch;
    if (ch === "/" && url[i + 1] !== "/") {
      parts.push(cur);
      cur = "";
    }
  }
  if (cur) parts.push(cur);
  return parts;
}
