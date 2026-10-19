"use client";

/**
 * Per-device display preferences (theme, view, interface language, text
 * size). Stored in localStorage when it is available; a private window or
 * blocked storage falls back to memory for the life of the page, so the
 * switches keep working and nothing throws.
 */
import { useCallback, useEffect, useSyncExternalStore } from "react";

const CHANGE_EVENT = "lt-pref-change";
const memory = new Map<string, string>();

function readRaw(key: string): string | null {
  try {
    const v = window.localStorage.getItem(key);
    if (v !== null) return v;
  } catch {
    // storage unavailable
  }
  return memory.get(key) ?? null;
}

function writeRaw(key: string, value: string) {
  memory.set(key, value);
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // storage unavailable; memory keeps the value for this page
  }
  try {
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: key }));
  } catch {
    // ignore
  }
}

function subscribe(callback: () => void) {
  window.addEventListener(CHANGE_EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(CHANGE_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

/**
 * A remembered string preference restricted to `allowed`. `fallback` is used
 * on the server, on first visit and for unknown stored values; null means
 * "nothing chosen yet".
 */
export function usePref<T extends string>(
  key: string,
  fallback: T,
  allowed: readonly T[],
): [T, (value: T) => void];
export function usePref<T extends string>(
  key: string,
  fallback: null,
  allowed: readonly T[],
): [T | null, (value: T) => void];
export function usePref<T extends string>(
  key: string,
  fallback: T | null,
  allowed: readonly T[],
): [T | null, (value: T) => void] {
  const getSnapshot = () => {
    const v = readRaw(key);
    return v !== null && (allowed as readonly string[]).includes(v)
      ? (v as T)
      : fallback;
  };
  const value = useSyncExternalStore(subscribe, getSnapshot, () => fallback);
  const set = useCallback((v: T) => writeRaw(key, v), [key]);
  return [value, set];
}

export type Theme = "light" | "night";
export const THEMES: readonly Theme[] = ["light", "night"];
export const THEME_KEY = "lt.theme";

/** Theme preference; keeps the <html data-theme> attribute in step. */
export function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setTheme] = usePref<Theme>(THEME_KEY, "light", THEMES);
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);
  return [theme, setTheme];
}

export type OperatorView = "desk" | "rows";
export const OPERATOR_VIEWS: readonly OperatorView[] = ["desk", "rows"];
export type ListenerView = "receiver" | "captions";
export const LISTENER_VIEWS: readonly ListenerView[] = ["receiver", "captions"];
export type UiLang = "es" | "en";
export const UI_LANGS: readonly UiLang[] = ["es", "en"];
export type TextSize = "m" | "l" | "xl";
export const TEXT_SIZES: readonly TextSize[] = ["m", "l", "xl"];

export function useOperatorView() {
  return usePref<OperatorView>("lt.view.operator", "desk", OPERATOR_VIEWS);
}

export function useListenerView() {
  return usePref<ListenerView>("lt.view.listener", "receiver", LISTENER_VIEWS);
}

export function useTextSize() {
  return usePref<TextSize>("lt.textsize", "m", TEXT_SIZES);
}

/**
 * Interface language of the listener surfaces: the manual choice when there
 * is one, otherwise `followed` (the room's language, or the browser's).
 */
export function useUiLang(followed: UiLang): [UiLang, (l: UiLang) => void] {
  const [chosen, setChosen] = usePref<UiLang>("lt.uilang", null, UI_LANGS);
  return [chosen ?? followed, setChosen];
}
