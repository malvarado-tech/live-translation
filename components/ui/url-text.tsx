import { Fragment } from "react";
import { urlParts } from "@/lib/url-parts";

/**
 * A URL that wraps at its natural boundaries: after each run of slashes and
 * before `?`, `#` and `&`. The break opportunities are <wbr> elements, which
 * add no characters, so a selected or copied URL stays exact. A single part
 * longer than the line still wraps through `overflow-wrap: anywhere`.
 * Short parts stay on one line, so a hyphenated event ID is not split at
 * its hyphen.
 */
export function UrlText({ url }: { url: string }) {
  const parts = urlParts(url);
  return (
    <span className="[overflow-wrap:anywhere]">
      {parts.map((p, i) => (
        <Fragment key={i}>
          {i > 0 ? <wbr /> : null}
          {p.length <= 24 ? <span className="whitespace-nowrap">{p}</span> : p}
        </Fragment>
      ))}
    </span>
  );
}
