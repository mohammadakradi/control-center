import type { InputHTMLAttributes } from "react";

export type FieldSize =
  /** Dense inline field — the folder picker's "go to path" bar. */
  | "sm"
  /** The default form field. */
  | "md"
  /** Heading-sized, for editing a title in place (`ProjectName`). */
  | "lg";

export type FieldTone =
  | "default"
  /** Destructive confirmation — the focus treatment turns danger-toned so the
   *  field doesn't read as a routine input. */
  | "danger";

const BASE =
  "w-full rounded-lg border border-line-strong bg-surface-2 text-fg-strong placeholder:text-fg-faint transition-colors outline-none disabled:pointer-events-none disabled:opacity-50";

const SIZES: Record<FieldSize, string> = {
  sm: "px-2.5 py-1.5 text-xs",
  md: "px-3 py-2 text-sm",
  // Matches the `<h1>` it replaces while editing, so the title doesn't jump size.
  lg: "px-3 py-1.5 text-2xl font-bold tracking-tight sm:text-3xl",
};

const TONES: Record<FieldTone, string> = {
  default: "focus:border-accent focus:ring-2 focus:ring-accent/30",
  danger: "focus:border-danger-line focus:ring-2 focus:ring-danger-line/40",
};

/** The look of a form field, as a string. Exported because a `<textarea>` has to match an
 *  `<input>` exactly and there is no reason for two copies of the same border/focus
 *  treatment. Shaped like `buttonClasses()` — same argument order, same escape hatch. */
export function fieldClasses(
  size: FieldSize = "md",
  tone: FieldTone = "default",
  className = "",
) {
  return `${BASE} ${SIZES[size]} ${TONES[tone]} ${className}`;
}

export function Input({
  size = "md",
  tone = "default",
  className = "",
  ...rest
}: {
  size?: FieldSize;
  tone?: FieldTone;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "size">) {
  return <input {...rest} className={fieldClasses(size, tone, className)} />;
}
