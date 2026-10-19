"use client";

/**
 * The listener's rare settings behind one "Options" control: view, theme,
 * text size and interface language, plus stopping the audio. Every choice
 * is remembered on this device (lib/prefs.ts).
 */
import { useState } from "react";
import { buttonClass, Segmented } from "@/components/ui/controls";
import { Sheet } from "@/components/ui/sheet";
import type { ListenerLang, ListenerStrings } from "@/lib/listener-strings";
import { useListenerView, useTextSize, useTheme } from "@/lib/prefs";

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium text-silk" aria-hidden>
        {label}
      </p>
      {children}
    </div>
  );
}

export function OptionsIcon() {
  return (
    <svg aria-hidden width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M2 4.5h8M14 4.5h2M2 13.5h3M9 13.5h7" />
      <circle cx="12" cy="4.5" r="2" />
      <circle cx="7" cy="13.5" r="2" />
    </svg>
  );
}

export function ListenerOptions({
  t,
  uiLang,
  onUiLang,
  showTextSize = true,
  onStop,
  className = "",
}: {
  t: ListenerStrings;
  uiLang: ListenerLang;
  onUiLang: (l: ListenerLang) => void;
  showTextSize?: boolean;
  /** Stops the audio (live listener while connected). */
  onStop?: (() => void) | null;
  /** Classes for the trigger button (size, width). */
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useListenerView();
  const [theme, setTheme] = useTheme();
  const [size, setSize] = useTextSize();

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        data-testid="options-button"
        className={`${buttonClass("default", "xl")} shrink-0 px-4 ${className}`}
      >
        <OptionsIcon />
        {t.options}
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title={t.options} closeLabel={t.close} testId="options-sheet" lang={uiLang}>
        <Group label={t.view}>
          <Segmented
            label={t.view}
            hideLabel
            stretch
            value={view}
            onChange={setView}
            options={[
              { value: "captions", label: t.views.captions },
              { value: "receiver", label: t.views.receiver },
            ]}
            testId="listener-view-switch"
          />
        </Group>
        <Group label={t.theme}>
          <Segmented
            label={t.theme}
            hideLabel
            stretch
            value={theme}
            onChange={setTheme}
            options={[
              { value: "light", label: t.themes.light },
              { value: "night", label: t.themes.night },
            ]}
            testId="theme-switch"
          />
        </Group>
        {showTextSize ? (
          <Group label={t.textSize}>
            <Segmented
              label={t.textSize}
              hideLabel
              stretch
              value={size}
              onChange={setSize}
              options={[
                { value: "m", label: t.textSizes.m },
                { value: "l", label: t.textSizes.l },
                { value: "xl", label: t.textSizes.xl },
              ]}
              testId="text-size-switch"
            />
          </Group>
        ) : null}
        <Group label={t.interfaceLanguage}>
          <Segmented
            label={t.interfaceLanguage}
            hideLabel
            stretch
            value={uiLang}
            onChange={onUiLang}
            options={[
              { value: "es", label: "Español", lang: "es" },
              { value: "en", label: "English", lang: "en" },
            ]}
            testId="ui-lang-switch"
          />
        </Group>
        {onStop ? (
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onStop();
            }}
            className={`${buttonClass("default", "lg")} w-full`}
            data-testid="leave-button"
          >
            {t.stopAudio}
          </button>
        ) : null}
      </Sheet>
    </>
  );
}
