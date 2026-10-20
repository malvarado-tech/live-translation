"use client";

/**
 * The Audio section of the live operator screen: input device, monitor
 * output device, input level, monitor mode and a refresh of the device
 * list, always on screen in both views. The replay passes the same model
 * with the device controls disabled and one note that says why.
 */
import { Button, HMeter, Segmented } from "@/components/ui/controls";

export type DeviceOption = { deviceId: string; label: string };

export type AudioModel = {
  input: {
    value: string;
    devices: DeviceOption[];
    defaultLabel: string;
    onChange?: (deviceId: string) => void;
  };
  output: {
    value: string;
    devices: DeviceOption[];
    defaultLabel: string;
    onChange?: (deviceId: string) => void;
    /** setSinkId is available in this browser. */
    supported: boolean;
  };
  level: number | null;
  levelText: string;
  /** When a new input takes effect, e.g. at the next Start. */
  inputHint?: string | null;
  monitor: {
    value: string;
    options: ReadonlyArray<{ value: string; label: string }>;
    onChange: (value: string) => void;
  } | null;
  refresh: { label: string; onClick?: () => void };
  /** Device controls cannot be used here; one note says why. */
  unavailableNote?: string | null;
};

export const AUDIO_INPUT_ID = "audio-input";
const NOTE_ID = "audio-unavailable-note";

export function DeviceSelect({
  id,
  label,
  value,
  onChange,
  defaultLabel,
  devices,
  disabled,
  describedBy,
  testId,
  className = "min-w-56",
}: {
  id?: string;
  label: string;
  value: string;
  onChange?: (v: string) => void;
  defaultLabel: string;
  devices: DeviceOption[];
  disabled?: boolean;
  describedBy?: string;
  testId?: string;
  className?: string;
}) {
  return (
    <label className={`flex min-w-0 flex-col gap-1.5 ${className}`}>
      <span className="text-sm font-medium text-silk">{label}</span>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        disabled={disabled || !onChange}
        aria-describedby={describedBy}
        data-testid={testId}
        className="min-h-11 w-full min-w-0 truncate rounded-md border border-btn-line bg-panel px-3 text-[15px] text-ink disabled:cursor-not-allowed disabled:opacity-60"
      >
        <option value="">{defaultLabel}</option>
        {devices.map((d) => (
          <option key={d.deviceId} value={d.deviceId}>
            {d.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function AudioSection({ audio, wide = false }: { audio: AudioModel; wide?: boolean }) {
  const locked = Boolean(audio.unavailableNote);
  const describedBy = locked ? NOTE_ID : undefined;
  return (
    <section
      aria-labelledby="audio-heading"
      data-testid="audio-section"
      className="flex flex-col gap-2 rounded-md border border-line bg-panel px-4 py-3"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="audio-heading" className="font-cond text-lg font-semibold text-ink">
          Audio
        </h2>
        {audio.unavailableNote ? (
          <p id={NOTE_ID} className="text-sm text-silk" data-testid="audio-unavailable">
            {audio.unavailableNote}
          </p>
        ) : null}
      </div>
      <div
        className={`grid grid-cols-1 items-start gap-x-4 gap-y-3 sm:grid-cols-2 ${
          wide ? "xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]" : ""
        }`}
      >
        <div className="flex min-w-0 flex-col gap-2">
          <DeviceSelect
            id={AUDIO_INPUT_ID}
            label="Input"
            value={audio.input.value}
            onChange={locked ? undefined : audio.input.onChange}
            defaultLabel={audio.input.defaultLabel}
            devices={audio.input.devices}
            describedBy={describedBy}
            testId="audio-input"
            className=""
          />
          <div className="min-w-0">
            <HMeter level={audio.level} segments={24} label="Input level" testId="audio-meter" />
          </div>
          <p className="-mt-1 text-sm text-silk" data-testid="audio-level-text">
            {audio.levelText}
            {audio.inputHint ? ` · ${audio.inputHint}` : ""}
          </p>
        </div>
        <DeviceSelect
          label={`Monitor output${audio.output.supported ? "" : " (not supported in this browser)"}`}
          value={audio.output.value}
          onChange={locked || !audio.output.supported ? undefined : audio.output.onChange}
          defaultLabel={audio.output.defaultLabel}
          devices={audio.output.devices}
          describedBy={describedBy}
          testId="audio-output"
          className=""
        />
        <div className={`flex flex-wrap items-end gap-3 sm:col-span-2 ${wide ? "xl:col-span-1 xl:pt-[26px]" : ""}`}>
          {audio.monitor ? (
            <Segmented
              label="Monitor"
              value={audio.monitor.value}
              onChange={audio.monitor.onChange}
              options={audio.monitor.options}
              testId="audio-monitor"
            />
          ) : null}
          <Button
            size="sm"
            tone="ghost"
            onClick={audio.refresh.onClick}
            disabled={locked || !audio.refresh.onClick}
            describedBy={describedBy}
            testId="audio-refresh"
          >
            {audio.refresh.label}
          </Button>
        </div>
      </div>
    </section>
  );
}
