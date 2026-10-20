/**
 * Listener interface copy, Spanish and English. Informative and impersonal:
 * the screen states what is happening, it does not chat with the listener.
 *
 * No imports, so it runs under `node --test` as well as in the browser.
 */

export type ListenerLang = "es" | "en";

export type ListenerStatusKey =
  | "idle"
  | "connecting"
  | "waiting"
  | "live"
  | "silent"
  | "paused"
  | "translation-reconnecting"
  | "interrupted"
  | "network-reconnecting"
  | "left"
  | "ended"
  | "unavailable"
  | "replay-playing"
  | "replay-paused"
  | "replay-ended"
  | "replay-loading";

type StatusCopy = {
  /** Short tally text (badge). */
  tally: string;
  /** One-line status sentence (live region). */
  line: string;
};

export type ListenerStrings = {
  liveTranslation: string;
  languageSelection: string;
  channel: string;
  listen: string;
  mute: string;
  unmute: string;
  leave: string;
  textSize: string;
  textSizes: { m: string; l: string; xl: string };
  view: string;
  views: { receiver: string; captions: string };
  theme: string;
  themes: { light: string; night: string };
  interfaceLanguage: string;
  changeLanguage: string;
  audioLevel: string;
  noSignal: string;
  delay: (seconds: string) => string;
  attempt: (n: number, of: number) => string;
  captionsPending: string;
  noCaptions: string;
  headphones: string;
  noLiveLanguages: string;
  noLiveLanguagesDetail: string;
  checking: string;
  refresh: string;
  refreshing: string;
  pickerError: string;
  status: Record<ListenerStatusKey, StatusCopy>;
  channelStates: {
    live: string;
    paused: string;
    waiting: string;
    reconnecting: string;
    original: string;
  };
  originalAudio: string;
  replayLabel: string;
  play: string;
  pause: string;
  position: string;
  attribution: string;
  audioBlocked: string;
  /** Replay: the play button is the control that enables audio. */
  audioBlockedReplay: string;
  options: string;
  stopAudio: string;
  close: string;
  /** Returns the caption history to the newest line. */
  backToLatest: string;
  /** Accessible name of the scrollable caption history. */
  captionHistory: string;
};

export const LISTENER_STRINGS: Record<ListenerLang, ListenerStrings> = {
  es: {
    liveTranslation: "Traducción en vivo",
    languageSelection: "Selección de idioma",
    channel: "Canal",
    listen: "Escuchar",
    mute: "Silenciar",
    unmute: "Activar sonido",
    leave: "Salir",
    textSize: "Tamaño de texto",
    textSizes: { m: "Normal", l: "Grande", xl: "Muy grande" },
    view: "Vista",
    views: { receiver: "Receptor", captions: "Subtítulos" },
    theme: "Tema",
    themes: { light: "Claro", night: "Noche" },
    interfaceLanguage: "Idioma de la interfaz",
    changeLanguage: "Cambiar idioma",
    audioLevel: "Nivel de audio",
    noSignal: "Sin señal",
    delay: (s) => `Retraso ${s} s`,
    attempt: (n, of) => `Intento ${n} de ${of}`,
    captionsPending: "Los subtítulos aparecen con el audio.",
    noCaptions: "Canal sin subtítulos.",
    headphones: "Uso de audífonos recomendado.",
    noLiveLanguages: "Sin idiomas en vivo",
    noLiveLanguagesDetail:
      "Los idiomas aparecen aquí al iniciar la transmisión. La lista se actualiza cada 15 segundos.",
    checking: "Consulta de idiomas en curso",
    refresh: "Actualizar",
    refreshing: "Actualización en curso",
    pickerError: "Lista no actualizada; se muestra la última disponible.",
    status: {
      idle: { tally: "Sin iniciar", line: "Audio sin iniciar." },
      connecting: { tally: "Conexión", line: "Conexión en curso." },
      waiting: {
        tally: "En espera",
        line: "Transmisión sin iniciar; el audio comienza automáticamente.",
      },
      live: { tally: "En vivo", line: "En vivo." },
      silent: { tally: "Sin audio", line: "Sin audio en este momento." },
      paused: { tally: "En pausa", line: "En pausa entre ponentes." },
      "translation-reconnecting": {
        tally: "Reconexión",
        line: "Traducción en reconexión; el audio vuelve automáticamente.",
      },
      interrupted: {
        tally: "Interrumpida",
        line: "Transmisión interrumpida; el audio vuelve automáticamente.",
      },
      "network-reconnecting": {
        tally: "Reconexión",
        line: "Audio interrumpido; reconexión en curso.",
      },
      left: { tally: "Detenido", line: "Audio detenido." },
      ended: { tally: "Finalizada", line: "Sesión finalizada." },
      unavailable: {
        tally: "No disponible",
        line: "Traducción no disponible. El personal del evento puede ayudar.",
      },
      "replay-playing": { tally: "Grabación", line: "Reproducción en curso." },
      "replay-paused": { tally: "En pausa", line: "Reproducción en pausa." },
      "replay-ended": { tally: "Fin", line: "Reproducción terminada." },
      "replay-loading": { tally: "Carga", line: "Carga del audio en curso." },
    },
    channelStates: {
      live: "En vivo",
      paused: "En pausa",
      waiting: "En espera",
      reconnecting: "Reconexión",
      original: "Audio original",
    },
    originalAudio: "audio original",
    replayLabel: "Grabación de 1962 · traducción y voz generadas con IA",
    play: "Reproducir",
    pause: "Pausa",
    position: "Posición",
    attribution: "Créditos",
    audioBlocked:
      "Reproducción bloqueada por el navegador. Un toque en «Escuchar» la activa.",
    audioBlockedReplay: "Reproducción bloqueada por el navegador. Un toque en «Reproducir» la activa.",
    options: "Opciones",
    stopAudio: "Detener audio",
    close: "Cerrar",
    backToLatest: "Volver a lo más reciente",
    captionHistory: "Historial de subtítulos",
  },
  en: {
    liveTranslation: "Live translation",
    languageSelection: "Language selection",
    channel: "Channel",
    listen: "Listen",
    mute: "Mute",
    unmute: "Unmute",
    leave: "Leave",
    textSize: "Text size",
    textSizes: { m: "Normal", l: "Large", xl: "Extra large" },
    view: "View",
    views: { receiver: "Receiver", captions: "Captions" },
    theme: "Theme",
    themes: { light: "Light", night: "Night" },
    interfaceLanguage: "Interface language",
    changeLanguage: "Change language",
    audioLevel: "Audio level",
    noSignal: "No signal",
    delay: (s) => `Delay ${s} s`,
    attempt: (n, of) => `Attempt ${n} of ${of}`,
    captionsPending: "Captions appear with the audio.",
    noCaptions: "Channel without captions.",
    headphones: "Headphones recommended.",
    noLiveLanguages: "No live languages",
    noLiveLanguagesDetail:
      "Languages appear here when the broadcast starts. The list refreshes every 15 seconds.",
    checking: "Checking languages",
    refresh: "Refresh",
    refreshing: "Refreshing",
    pickerError: "List not updated; the last available one is shown.",
    status: {
      idle: { tally: "Not started", line: "Audio not started." },
      connecting: { tally: "Connecting", line: "Connecting." },
      waiting: {
        tally: "Standby",
        line: "Broadcast not started; audio starts automatically.",
      },
      live: { tally: "Live", line: "Live." },
      silent: { tally: "No audio", line: "No audio at the moment." },
      paused: { tally: "Paused", line: "Paused between speakers." },
      "translation-reconnecting": {
        tally: "Reconnecting",
        line: "Translation reconnecting; audio resumes automatically.",
      },
      interrupted: {
        tally: "Interrupted",
        line: "Broadcast interrupted; audio resumes automatically.",
      },
      "network-reconnecting": {
        tally: "Reconnecting",
        line: "Audio interrupted; reconnecting.",
      },
      left: { tally: "Stopped", line: "Audio stopped." },
      ended: { tally: "Ended", line: "Session ended." },
      unavailable: {
        tally: "Unavailable",
        line: "Translation unavailable. Event staff can help.",
      },
      "replay-playing": { tally: "Recording", line: "Playback in progress." },
      "replay-paused": { tally: "Paused", line: "Playback paused." },
      "replay-ended": { tally: "End", line: "Playback finished." },
      "replay-loading": { tally: "Loading", line: "Loading audio." },
    },
    channelStates: {
      live: "Live",
      paused: "Paused",
      waiting: "Standby",
      reconnecting: "Reconnecting",
      original: "Original audio",
    },
    originalAudio: "original audio",
    replayLabel: "1962 recording · AI-generated translation and voice",
    play: "Play",
    pause: "Pause",
    position: "Position",
    attribution: "Credits",
    audioBlocked: "Playback blocked by the browser. A tap on Listen enables it.",
    audioBlockedReplay: "Playback blocked by the browser. A tap on Play enables it.",
    options: "Options",
    stopAudio: "Stop audio",
    close: "Close",
    backToLatest: "Back to latest",
    captionHistory: "Caption history",
  },
};

/**
 * The state of one event language as listeners see it in a list, from the
 * operator status published for that room.
 */
export function channelState(
  status: { state?: string | null; mode?: string | null } | undefined,
  t: ListenerStrings,
): { text: string; live: boolean } {
  const s = status?.state;
  if (status?.mode === "original" && (s === "live" || !s)) {
    return { text: t.channelStates.live, live: true };
  }
  switch (s) {
    case "paused":
      return { text: t.channelStates.paused, live: false };
    case "waiting":
      return { text: t.channelStates.waiting, live: false };
    case "reconnecting":
    case "interrupted":
      return { text: t.channelStates.reconnecting, live: false };
    default:
      return { text: t.channelStates.live, live: true };
  }
}

/** The listener interface language that follows a room language. */
export function uiLangForRoom(code: string | null): ListenerLang {
  return code === "es" ? "es" : "en";
}

/** The listener interface language that follows the browser. */
export function uiLangForBrowser(languages: readonly string[]): ListenerLang {
  for (const l of languages) {
    const base = l.toLowerCase().split("-")[0];
    if (base === "es") return "es";
    if (base === "en") return "en";
  }
  return "en";
}
