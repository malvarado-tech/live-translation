import { expect, type APIRequestContext, type Page, type TestInfo } from "@playwright/test";

const EM_DASH = String.fromCharCode(0x2014);

export type Theme = "light" | "night";

/**
 * A client address of its own for one test, so the per-client rate limit
 * of /api/event-languages (30 a minute) is not shared by the whole suite.
 */
export function clientAddress(info: TestInfo): string {
  return `198.51.100.${(info.workerIndex % 200) + 1}-${info.project.name}-${info.testId}-${info.repeatEachIndex}-${info.retry}`;
}

/** Whether this build has a room server configured. */
export async function roomServerConfigured(request: APIRequestContext, info: TestInfo): Promise<boolean> {
  const resp = await request.get("/api/event-languages?event=demo", {
    headers: { "x-forwarded-for": clientAddress(info) },
  });
  return Boolean((await resp.json()).configured);
}

/** Set remembered preferences before the page loads. */
export async function setPrefs(page: Page, prefs: Record<string, string>) {
  await page.addInitScript((p) => {
    try {
      for (const [k, v] of Object.entries(p)) localStorage.setItem(k, v);
    } catch {
      // storage blocked: the page falls back to defaults
    }
  }, prefs);
}

export type ContrastFailure = {
  text: string;
  ratio: number;
  required: number;
  color: string;
  background: string;
};

/**
 * WCAG contrast of every visible text node against its effective
 * background (walking up to the first opaque background, compositing
 * translucent layers). Large text (24 px, or 18.66 px bold) needs 3:1,
 * everything else 4.5:1. Disabled controls are exempt, as in WCAG.
 */
export async function contrastFailures(page: Page): Promise<ContrastFailure[]> {
  return page.evaluate(() => {
    type RGBA = [number, number, number, number];
    const ctx = document.createElement("canvas").getContext("2d")!;
    const parse = (c: string): RGBA => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = "#000";
      ctx.fillStyle = c;
      ctx.fillRect(0, 0, 1, 1);
      const d = ctx.getImageData(0, 0, 1, 1).data;
      const m = c.match(/rgba?\(([^)]+)\)/);
      const alpha = m && m[1].split(/[ ,/]+/).length >= 4 ? Number(m[1].split(/[ ,/]+/)[3]) : 1;
      return [d[0], d[1], d[2], Number.isFinite(alpha) ? alpha : 1];
    };
    const lum = ([r, g, b]: RGBA) => {
      const f = (v: number) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const over = (top: RGBA, bottom: RGBA): RGBA => {
      const a = top[3];
      return [
        top[0] * a + bottom[0] * (1 - a),
        top[1] * a + bottom[1] * (1 - a),
        top[2] * a + bottom[2] * (1 - a),
        1,
      ];
    };
    const bgOf = (el: Element | null): RGBA => {
      const layers: RGBA[] = [];
      for (let e = el; e; e = e.parentElement) {
        const cs = getComputedStyle(e);
        if (cs.backgroundImage && cs.backgroundImage !== "none" && !cs.backgroundImage.includes("gradient")) break;
        const c = parse(cs.backgroundColor);
        if (cs.backgroundImage.includes("repeating-linear-gradient")) {
          // Hatched tallies: test against the lighter stripe colour token.
          layers.push(parse(getComputedStyle(document.documentElement).getPropertyValue("--amber")));
          break;
        }
        if (c[3] > 0) {
          layers.push(c);
          if (c[3] >= 1) break;
        }
      }
      let acc: RGBA = parse(getComputedStyle(document.body).backgroundColor);
      for (let i = layers.length - 1; i >= 0; i--) acc = over(layers[i], acc);
      return acc;
    };
    const fails: ContrastFailure[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const seen = new Set<Element>();
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = (n.textContent ?? "").trim();
      const el = n.parentElement;
      if (!text || !el || seen.has(el)) continue;
      seen.add(el);
      const cs = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0 || cs.visibility === "hidden" || cs.display === "none") continue;
      if (el.closest("[aria-hidden=true], .sr-only, option, select, svg, [disabled], :disabled")) continue;
      let op = 1;
      for (let e: Element | null = el; e; e = e.parentElement) op *= Number(getComputedStyle(e).opacity);
      if (op < 0.6) continue;
      // Text under a gradient mask (caption fade) is checked at full strength.
      const fg = parse(cs.color);
      const bg = bgOf(el);
      const fgC = over(fg, bg);
      const l1 = lum(fgC);
      const l2 = lum(bg);
      const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
      const size = parseFloat(cs.fontSize);
      const bold = Number(cs.fontWeight) >= 700;
      const large = size >= 24 || (bold && size >= 18.66);
      const required = large ? 3 : 4.5;
      if (ratio + 0.01 < required) {
        fails.push({
          text: text.slice(0, 60),
          ratio: Math.round(ratio * 100) / 100,
          required,
          color: cs.color,
          background: `rgb(${bg.slice(0, 3).map(Math.round).join(",")})`,
        });
      }
    }
    return fails;
  });
}

export async function expectContrast(page: Page) {
  const fails = await contrastFailures(page);
  expect(fails, JSON.stringify(fails, null, 1)).toEqual([]);
}

export async function expectNoHorizontalScroll(page: Page) {
  const { sw, cw } = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    cw: document.documentElement.clientWidth,
  }));
  expect(sw, "horizontal scroll").toBeLessThanOrEqual(cw);
}

/** Interactive targets smaller than `min` px in either dimension. */
export async function smallTargets(page: Page, selector: string, min = 44) {
  return page.evaluate(
    ([sel, m]) =>
      Array.from(document.querySelectorAll<HTMLElement>(sel))
        .filter((el) => {
          const r = el.getBoundingClientRect();
          const cs = getComputedStyle(el);
          // Links inside a sentence are exempt (WCAG 2.5.8 inline exception).
          if (cs.display === "inline") return false;
          return r.width > 0 && r.height > 0 && cs.visibility !== "hidden";
        })
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width < (m as number) || r.height < (m as number);
        })
        .map((el) => `${el.tagName} "${(el.textContent ?? el.getAttribute("aria-label") ?? "").trim().slice(0, 30)}" ${Math.round(el.getBoundingClientRect().width)}x${Math.round(el.getBoundingClientRect().height)}`),
    [selector, min] as const,
  );
}

export async function expectNoEmDash(page: Page) {
  const text = await page.evaluate(() => document.body.innerText);
  expect(text.includes(EM_DASH), "em dash on screen").toBe(false);
}
