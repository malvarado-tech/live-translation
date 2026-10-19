import type { ReactNode } from "react";

/** A labelled segmented switch (radio group). Each option is a 44 px target. */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  size = "md",
  testId,
  hideLabel = false,
  stretch = false,
  className = "",
}: {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string; lang?: string }>;
  onChange: (value: T) => void;
  size?: "md" | "lg";
  testId?: string;
  hideLabel?: boolean;
  /** Fill the available width (phone layouts). */
  stretch?: boolean;
  className?: string;
}) {
  const h = size === "lg" ? "min-h-12" : "min-h-11";
  return (
    <div
      role="radiogroup"
      aria-label={label}
      data-testid={testId}
      className={`flex min-w-0 items-center gap-2 ${className}`}
    >
      {hideLabel ? null : (
        <span className="shrink-0 text-sm font-medium text-dim">{label}</span>
      )}
      <div className={`flex rounded-md border border-btn-line bg-btn p-0.5 ${stretch ? "min-w-0 flex-1" : "shrink-0"}`}>
        {options.map((opt) => {
          const selected = opt.value === value;
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              lang={opt.lang}
              aria-checked={selected}
              onClick={() => onChange(opt.value)}
              className={`${h} whitespace-nowrap rounded-[5px] px-3 text-sm font-semibold ${stretch ? "min-w-0 flex-1 truncate" : ""} ${
                selected
                  ? "bg-primary text-on-primary"
                  : "text-ink hover:bg-btn-hover"
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export type ButtonTone =
  | "default"
  | "primary"
  | "ghost"
  | "warn"
  | "danger"
  | "live";

const TONE: Record<ButtonTone, string> = {
  default: "bg-btn text-ink border-btn-line hover:bg-btn-hover",
  primary: "bg-primary text-on-primary border-primary hover:opacity-90",
  ghost: "bg-transparent text-ink border-btn-line hover:bg-btn-hover",
  warn: "bg-on-amber text-amber border-on-amber hover:opacity-90",
  danger: "bg-transparent text-error-ink border-btn-line hover:bg-error-wash",
  live: "bg-green-wash text-green-ink border-green-line hover:opacity-90",
};

/** Toggle button that shows its pressed state, e.g. the Night theme. */
export function toggleClass(pressed: boolean): string {
  return pressed
    ? "bg-primary text-on-primary border-primary"
    : "bg-btn text-ink border-btn-line hover:bg-btn-hover";
}

const SIZE = {
  sm: "min-h-11 px-3 text-sm",
  md: "min-h-11 px-4 text-[15px]",
  lg: "min-h-14 px-5 text-base",
  xl: "min-h-16 px-6 text-lg",
} as const;

export function buttonClass(
  tone: ButtonTone = "default",
  size: keyof typeof SIZE = "md",
): string {
  return `inline-flex items-center justify-center gap-2 rounded-md border font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${SIZE[size]} ${TONE[tone]}`;
}

export function Button({
  children,
  onClick,
  tone = "default",
  size = "md",
  disabled,
  className = "",
  title,
  ariaLabel,
  ariaPressed,
  ariaKeyShortcuts,
  testId,
}: {
  children: ReactNode;
  onClick?: () => void;
  tone?: ButtonTone;
  size?: keyof typeof SIZE;
  disabled?: boolean;
  className?: string;
  title?: string;
  ariaLabel?: string;
  ariaPressed?: boolean;
  ariaKeyShortcuts?: string;
  testId?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel}
      aria-pressed={ariaPressed}
      aria-keyshortcuts={ariaKeyShortcuts}
      data-testid={testId}
      className={`${buttonClass(tone, size)} ${className}`}
    >
      {children}
    </button>
  );
}

/** Keyboard hint shown inside a button, e.g. "Space". */
export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded-[3px] border border-current px-1.5 font-cond text-xs font-semibold leading-[18px] text-current">
      {children}
    </kbd>
  );
}

function segColor(f: number): string {
  return f > 0.9 ? "bg-meter-red" : f > 0.72 ? "bg-meter-amber" : "bg-meter-green";
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/**
 * Horizontal segmented level meter. `level` is 0..1; segments above 72 %
 * turn amber and above 90 % red, as on a console meter. `null` = no signal
 * available (all segments dark).
 */
export function HMeter({
  level,
  segments = 20,
  height = "h-3.5",
  label,
  testId,
}: {
  level: number | null;
  segments?: number;
  height?: string;
  label: string;
  testId?: string;
}) {
  const lit = level === null ? 0 : Math.round(clamp01(level) * segments);
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={level === null ? 0 : Math.round(clamp01(level) * 100)}
      data-testid={testId}
      data-level={level === null ? "none" : clamp01(level).toFixed(2)}
      className="flex gap-[3px] rounded-[4px] bg-well p-1.5"
    >
      {Array.from({ length: segments }, (_, i) => (
        <i
          key={i}
          className={`block min-w-0 flex-1 rounded-[2px] ${height} ${
            i < lit ? segColor((i + 1) / segments) : "bg-off"
          }`}
        />
      ))}
    </div>
  );
}

/** Vertical ladder meter for the Desk view. */
export function VMeter({
  level,
  segments = 28,
  label,
  testId,
}: {
  level: number | null;
  segments?: number;
  label: string;
  testId?: string;
}) {
  const lit = level === null ? 0 : Math.round(clamp01(level) * segments);
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={level === null ? 0 : Math.round(clamp01(level) * 100)}
      data-testid={testId}
      data-level={level === null ? "none" : clamp01(level).toFixed(2)}
      className="flex h-full min-h-36 w-[30px] shrink-0 flex-col-reverse gap-[2px] rounded-[3px] bg-well p-[5px]"
    >
      {Array.from({ length: segments }, (_, i) => (
        <i
          key={i}
          className={`block min-h-[3px] flex-1 rounded-[1px] ${
            i < lit ? segColor((i + 1) / segments) : "bg-off"
          }`}
        />
      ))}
    </div>
  );
}

export type TallyTone =
  | "onair"
  | "original"
  | "warn"
  | "standby"
  | "off"
  | "fault"
  | "replay";

const TALLY: Record<TallyTone, string> = {
  onair: "bg-onair text-on-onair border-onair",
  original: "bg-green-wash text-green-ink border-green-line",
  warn: "hatch border-amber",
  standby: "border-dashed border-line-strong text-silk bg-transparent",
  off: "border-line-strong text-silk bg-transparent",
  fault: "bg-error-wash text-error-ink border-error-ink",
  replay: "bg-primary text-on-primary border-primary",
};

/** Tally lamp: the on-air light of a channel. */
export function Tally({
  tone,
  children,
  className = "",
  testId,
}: {
  tone: TallyTone;
  children: ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <span
      data-testid={testId}
      data-tone={tone}
      className={`inline-flex items-center justify-center whitespace-nowrap rounded-[3px] border px-3 font-cond font-bold tracking-[0.06em] ${TALLY[tone]} ${className}`}
    >
      {children}
    </span>
  );
}
