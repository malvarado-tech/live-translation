"use client";

/**
 * Scroll-back for caption and transcript history. The box follows the
 * newest line while it is scrolled to the bottom; once the reader scrolls
 * up it stays where it is and a "back to latest" button appears. The
 * button, or scrolling back to the bottom, resumes following.
 */
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { buttonClass } from "@/components/ui/controls";

/** Distance from the bottom, in px, that still counts as "at the latest line". */
const AT_BOTTOM_PX = 12;

export function useFollowScroll(onMeasure?: (content: HTMLElement) => void) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const followRef = useRef(true);
  // Last known position. Only a move up stops following: a scroll event
  // that lands after more lines arrived reads "not at the bottom" without
  // anyone having scrolled.
  const lastTopRef = useRef(0);
  const measureRef = useRef(onMeasure);
  /**
   * The box sits above where it was last put and away from the bottom:
   * someone scrolled up. (Fewer lines clamp it to the bottom instead.)
   */
  const movedUp = useCallback(
    (box: HTMLElement) =>
      box.scrollTop < lastTopRef.current - 1 &&
      box.scrollHeight - box.scrollTop - box.clientHeight > AT_BOTTOM_PX,
    [],
  );
  const [following, setFollowing] = useState(true);
  const [overflow, setOverflow] = useState(false);

  useEffect(() => {
    measureRef.current = onMeasure;
  }, [onMeasure]);

  useEffect(() => {
    const el = scrollRef.current;
    const content = contentRef.current;
    if (!el || !content) return;
    lastTopRef.current = el.scrollTop;
    const setFollow = (v: boolean) => {
      if (v !== followRef.current) {
        followRef.current = v;
        setFollowing(v);
      }
    };
    const toBottom = () => {
      el.scrollTop = el.scrollHeight;
      lastTopRef.current = el.scrollTop;
    };
    const measure = () => {
      measureRef.current?.(content);
      setOverflow(el.scrollHeight > el.clientHeight + 1);
      if (followRef.current && !movedUp(el)) toBottom();
    };
    const onScroll = () => {
      const top = el.scrollTop;
      const atBottom = el.scrollHeight - top - el.clientHeight <= AT_BOTTOM_PX;
      if (atBottom) setFollow(true);
      else if (top < lastTopRef.current - 1) setFollow(false);
      else if (followRef.current) toBottom();
      lastTopRef.current = el.scrollTop;
    };
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    ro?.observe(content);
    el.addEventListener("scroll", onScroll, { passive: true });
    measure();
    return () => {
      ro?.disconnect();
      el.removeEventListener("scroll", onScroll);
    };
  }, [movedUp]);

  // After every render (new lines), keep the newest line in view before
  // paint; the observer above covers size changes that are not renders.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    // A scroll up whose event has not run yet: leave it, the event stops following.
    if (!el || !followRef.current || movedUp(el)) return;
    el.scrollTop = el.scrollHeight;
    lastTopRef.current = el.scrollTop;
  });

  const resume = useCallback(() => {
    followRef.current = true;
    setFollowing(true);
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
      lastTopRef.current = el.scrollTop;
    }
    // Keyboard users land back on the history, not on a removed button.
    el?.focus({ preventScroll: true });
  }, []);

  return { scrollRef, contentRef, following, overflow, resume };
}

/** Top fade over older lines, shown only while the box follows the newest line. */
export const FOLLOW_FADE = "[mask-image:linear-gradient(to_bottom,transparent,black_40px)]";

/**
 * The "back to latest" button, pinned to the bottom of the box. It sits in
 * a polite live region, so its appearance is announced.
 */
export const LatestButton = memo(function LatestButton({
  visible,
  label,
  onClick,
  testId,
  lang,
}: {
  visible: boolean;
  label: string;
  onClick: () => void;
  testId: string;
  lang?: string;
}) {
  return (
    <div aria-live="polite" className="pointer-events-none absolute inset-x-0 bottom-2 z-10 flex justify-center px-2" lang={lang}>
      {visible ? (
        <button
          type="button"
          onClick={onClick}
          data-testid={testId}
          className={`${buttonClass("primary", "md")} pointer-events-auto font-sans shadow-lg`}
        >
          <svg aria-hidden width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M8 3v10M3.5 8.5 8 13l4.5-4.5" />
          </svg>
          {label}
        </button>
      ) : null}
    </div>
  );
});
