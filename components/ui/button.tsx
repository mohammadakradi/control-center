import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";
import { Loader2 } from "lucide-react";

export type ButtonVariant =
  /** The one main call-to-action on a view. */
  | "primary"
  /** Confirming/approving action. */
  | "success"
  /** Standard action with a surface behind it. */
  | "secondary"
  /** Low-emphasis action — no fill until hover. */
  | "ghost"
  /** Destructive or stop action. */
  | "danger"
  /** Caution, not failure — the action that clears a warning you're being shown
   *  (e.g. "Onboard /swe" inside the not-onboarded-yet notice). */
  | "warn"
  /** Tinted, low-emphasis accent action (e.g. "Create fix task"). */
  | "accent";

export type ButtonSize = "sm" | "md" | "icon";

const BASE =
  "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg border font-medium transition-colors disabled:pointer-events-none disabled:opacity-50";

const VARIANTS: Record<ButtonVariant, string> = {
  // Gradient stops are picked so white text clears AA (4.5:1) against the
  // *lightest* stop, not just the average.
  primary:
    "border-blue-800 bg-gradient-to-b from-sky-700 to-blue-600 text-white shadow-sm shadow-blue-600/20 hover:brightness-115",
  success:
    "border-emerald-800 bg-gradient-to-b from-emerald-700 to-emerald-800 text-white shadow-sm shadow-emerald-700/20 hover:brightness-115",
  secondary:
    "border-line-strong bg-surface-2 text-fg-muted hover:bg-surface-3 hover:text-fg-strong",
  ghost:
    "border-transparent text-fg-subtle hover:bg-hover hover:text-fg-strong",
  danger: "border-danger-line bg-danger-soft text-danger hover:brightness-110",
  warn: "border-warn-line bg-warn-soft text-warn hover:brightness-110",
  accent: "border-info-line bg-info-soft text-info hover:brightness-110",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "px-2.5 py-1.5 text-xs",
  md: "px-3.5 py-2 text-sm",
  icon: "size-8 p-0",
};

/** Classes only — for `<Link>`s and anchors that should look like buttons. */
export function buttonClasses(
  variant: ButtonVariant = "secondary",
  size: ButtonSize = "md",
  className = "",
) {
  return `${BASE} ${VARIANTS[variant]} ${SIZES[size]} ${className}`;
}

export function Button({
  variant = "secondary",
  size = "md",
  loading = false,
  icon,
  className = "",
  children,
  disabled,
  ...rest
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner, disables the button, and marks it `aria-busy`. */
  loading?: boolean;
  /** Leading icon; replaced by the spinner while `loading`. */
  icon?: ReactNode;
  children?: ReactNode;
  /**
   * The underlying `<button>`. React 19 hands `ref` to a function component as an ordinary prop,
   * so it rides along in `...rest` and needs no `forwardRef` — only this declaration, since
   * `ButtonHTMLAttributes` doesn't carry it. Added for a caller that has to *move* focus onto a
   * button that survives a state change (`UpdateBanner`'s "Not now" removes itself).
   */
  ref?: Ref<HTMLButtonElement>;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children">) {
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClasses(variant, size, className)}
    >
      {loading ? (
        <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
      ) : (
        icon
      )}
      {children}
    </button>
  );
}
