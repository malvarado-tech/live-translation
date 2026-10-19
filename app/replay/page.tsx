"use client";

import { useEffect, useMemo, useState } from "react";
import { ListenerSurface, type ListenerChannel } from "@/components/listener/surface";
import { Transport } from "@/components/replay/transport";
import {
  audioUrl,
  canPlayWebm,
  setMediaMuted,
  useReplayManifest,
  useReplayPlayer,
} from "@/components/replay/use-replay";
import { LISTENER_STRINGS, uiLangForRoom, type ListenerStatusKey } from "@/lib/listener-strings";
import { useUiLang } from "@/lib/prefs";
import { cuesUntil } from "@/lib/replay";
import { primeAudio, useAudioLevel } from "@/lib/use-audio-level";
import { useMediaSession } from "@/lib/use-device-session";

const TITLES = {
  es: { title: "Discurso en la Universidad Rice", subtitle: "John F. Kennedy · 12 sep 1962" },
  en: { title: "Rice University address", subtitle: "John F. Kennedy · 12 Sep 1962" },
};

const ATTRIBUTION_ES =
  "Audio: John F. Kennedy, discurso en la Universidad Rice sobre el esfuerzo espacial de la nación, 12 de septiembre de 1962. Dominio público, cortesía de la John F. Kennedy Presidential Library and Museum vía Wikimedia Commons. Fragmento recortado; los subtítulos traducidos y la voz traducida sintética son obras derivadas, y la voz es generada con IA, no la del orador.";

const INITIAL_CHANNEL = "es";

export default function ReplayPage() {
  const state = useReplayManifest();
  const [uiLang, setUiLang] = useUiLang(uiLangForRoom(INITIAL_CHANNEL));
  const t = LISTENER_STRINGS[uiLang];
  const [selected, setSelected] = useState(INITIAL_CHANNEL);
  const [muted, setMuted] = useState(false);
  const [webm] = useState(canPlayWebm);

  const channels = state.kind === "ready" ? state.channels : [];
  const channel = channels.find((c) => c.code === selected) ?? channels[0];
  const src = audioUrl(channel, webm);
  const { attach, ...player } = useReplayPlayer(
    src,
    state.kind === "ready" ? state.manifest.duration_s : 0,
  );
  const level = useAudioLevel(player.element);

  useEffect(() => {
    document.documentElement.lang = uiLang;
  }, [uiLang]);

  const element = player.element;
  useEffect(() => {
    if (element) setMediaMuted(element, muted);
  }, [element, muted]);

  const lines = useMemo(
    () =>
      channel
        ? cuesUntil(channel.cues, player.t).map((c) => ({ id: c.id, text: c.text, at: c.start * 1000 }))
        : [],
    [channel, player.t],
  );

  const status: ListenerStatusKey =
    state.kind === "error"
      ? "unavailable"
      : state.kind === "loading" || (player.started && player.loading)
        ? "replay-loading"
        : player.ended
          ? "replay-ended"
          : player.playing
            ? "replay-playing"
            : player.started
              ? "replay-paused"
              : "idle";
  const tone = status === "replay-playing" ? "replay" : status === "unavailable" ? "error" : "standby";

  const listChannels: ListenerChannel[] = channels.map((c) => ({
    code: c.code,
    label: c.original ? `${c.label}, ${t.originalAudio}` : c.label,
    lang: c.bcp47,
    active: c.code === channel?.code,
    onSelect: () => setSelected(c.code),
  }));

  const play = () => {
    primeAudio();
    player.play();
  };

  const titles = TITLES[uiLang];
  useMediaSession(
    player.started
      ? {
          title: `${channel?.label ?? ""} · ${titles.title}`,
          artist: t.replayLabel,
          playing: player.playing,
          onPlay: play,
          onPause: player.pause,
        }
      : null,
  );

  const manifest = state.kind === "ready" ? state.manifest : null;

  return (
    <>
      <ListenerSurface
        t={t}
        uiLang={uiLang}
        onUiLang={setUiLang}
        title={titles.title}
        badge={t.replayLabel}
        channel={{
          code: channel?.code ?? "--",
          label: channel ? (channel.original ? `${channel.label}, ${t.originalAudio}` : channel.label) : "",
          lang: channel?.bcp47 ?? uiLang,
        }}
        status={status}
        tone={tone}
        level={level.active && player.playing ? level.level : null}
        delaySeconds={null}
        lines={lines}
        captionsAvailable
        channels={listChannels}
        primary={
          player.started
            ? { kind: "mute", muted, onToggle: () => setMuted((m) => !m) }
            : { kind: "listen", onClick: play, busy: state.kind !== "ready" }
        }
        notice={player.blocked ? t.audioBlocked : null}
        transport={
          <Transport
            t={player.t}
            duration={player.duration}
            playing={player.playing}
            onPlay={play}
            onPause={player.pause}
            onSeek={player.seek}
            labels={{ play: t.play, pause: t.pause, position: t.position }}
          />
        }
        footer={
          manifest ? (
            <details className="border-t border-line pt-1 text-sm text-silk" data-testid="replay-attribution">
              <summary className="flex min-h-11 cursor-pointer items-center font-semibold text-ink underline underline-offset-4">
                {t.attribution}
              </summary>
              <div className="flex flex-col gap-1 pb-1">
                <p className="text-ink">{titles.subtitle}</p>
                <p>{uiLang === "es" ? ATTRIBUTION_ES : manifest.source.attribution}</p>
                <p>
                  <a className="underline underline-offset-4" href={manifest.source.source_url} rel="noopener" target="_blank">
                    Wikimedia Commons
                  </a>
                  {" · "}
                  <a className="underline underline-offset-4" href={manifest.source.license_url} rel="noopener" target="_blank">
                    {manifest.source.license}
                  </a>
                </p>
              </div>
            </details>
          ) : null
        }
      />
      <audio ref={attach} preload="auto" playsInline />
    </>
  );
}
