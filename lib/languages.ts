/** Target languages offered by the operator dashboard and the event page. */
export const TARGET_LANGUAGES: Array<{ code: string; label: string }> = [
  { code: "en", label: "English" },
  { code: "es", label: "Español" },
  { code: "pt", label: "Português" },
  { code: "fr", label: "Français" },
  { code: "de", label: "Deutsch" },
  { code: "it", label: "Italiano" },
  { code: "ja", label: "日本語" },
  { code: "ko", label: "한국어" },
  { code: "zh", label: "中文" },
  { code: "ru", label: "Русский" },
  { code: "hi", label: "हिन्दी" },
  { code: "id", label: "Bahasa Indonesia" },
  { code: "vi", label: "Tiếng Việt" },
];

/** Native name of a language code, or the code in upper case. */
export function languageLabel(code: string): string {
  return TARGET_LANGUAGES.find((l) => l.code === code)?.label ?? code.toUpperCase();
}

/**
 * Language code at the end of a room name (`<event>-<code>`), or null when
 * the suffix is not a known language.
 */
export function languageOfRoomName(room: string): string | null {
  const i = room.lastIndexOf("-");
  if (i < 0) return null;
  const code = room.slice(i + 1);
  return TARGET_LANGUAGES.some((l) => l.code === code) ? code : null;
}

/** Event part of a room name (`<event>-<code>`), or null. */
export function eventOfRoomName(room: string): string | null {
  const code = languageOfRoomName(room);
  if (!code) return null;
  const ev = room.slice(0, room.length - code.length - 1);
  return ev || null;
}
