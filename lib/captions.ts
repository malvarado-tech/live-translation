/**
 * Caption segmentation for streamed transcript deltas: text is split into
 * lines at sentence ends (and at a comma once a line grows long), so the
 * caption stage can dim older lines and emphasise the current one.
 *
 * No imports, so it runs under `node --test` as well as in the browser.
 */

export type CaptionLine = {
  id: number;
  text: string;
  /** When the line started, in the caller's time base (optional). */
  at?: number | null;
};

export type CaptionState = {
  lines: CaptionLine[];
  /** Text of the line still being spoken. */
  current: string;
  /** When the line in progress started. */
  currentAt: number | null;
  nextId: number;
};

export const emptyCaptions: CaptionState = {
  lines: [],
  current: "",
  currentAt: null,
  nextId: 1,
};

/**
 * Lines kept for scroll-back: a whole session at a typical pace (a line
 * every few seconds for about three hours). Older lines are dropped.
 */
export const MAX_CAPTION_LINES = 2000;
const SOFT_LIMIT = 110;
const HARD_LIMIT = 180;

function pushLine(state: CaptionState, text: string, at: number | null): CaptionState {
  const t = text.trim();
  if (!t) return state;
  const lines = [...state.lines, { id: state.nextId, text: t, at: state.currentAt }];
  return {
    lines: lines.length > MAX_CAPTION_LINES ? lines.slice(-MAX_CAPTION_LINES) : lines,
    current: state.current,
    currentAt: state.current.trim() ? at : null,
    nextId: state.nextId + 1,
  };
}

/** Append a transcript delta; `at` stamps lines that start with it. */
export function appendCaption(
  state: CaptionState,
  delta: string,
  at: number | null = null,
): CaptionState {
  if (!delta) return state;
  let s: CaptionState = {
    ...state,
    current: state.current + delta,
    currentAt: state.current.trim() ? state.currentAt : at,
  };
  // Split at sentence ends followed by whitespace.
  for (;;) {
    const m = /[.!?…]["'”»)]?\s+/.exec(s.current);
    if (!m) break;
    const cut = m.index + m[0].length;
    const head = s.current.slice(0, cut);
    const rest = s.current.slice(cut);
    s = pushLine({ ...s, current: rest }, head, at);
  }
  // Long run-on: break at a comma past the soft limit, or hard-wrap.
  while (s.current.length > SOFT_LIMIT) {
    const span = s.current.slice(0, HARD_LIMIT);
    let cut = span.lastIndexOf(", ");
    if (cut >= SOFT_LIMIT - 40) {
      cut += 1;
    } else if (s.current.length > HARD_LIMIT) {
      cut = span.lastIndexOf(" ");
      if (cut <= 0) cut = HARD_LIMIT;
    } else {
      break;
    }
    const head = s.current.slice(0, cut);
    const rest = s.current.slice(cut).replace(/^\s+/, "");
    s = pushLine({ ...s, current: rest }, head, at);
  }
  return s;
}

/** All lines including the one in progress, newest last. */
export function captionLines(state: CaptionState): CaptionLine[] {
  const cur = state.current.trim();
  return cur
    ? [...state.lines, { id: state.nextId, text: cur, at: state.currentAt }]
    : state.lines;
}
