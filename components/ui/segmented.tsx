"use client";

import { useRef, type KeyboardEvent, type ReactNode } from "react";

export type SegmentedOption<T extends string> = {
  value: T;
  /** Always the option's accessible name. Rendered `sr-only` when `iconOnly`. */
  label: string;
  icon?: ReactNode;
};

/**
 * A segmented control for a small, fixed set of **client-side** choices.
 *
 * `role="radiogroup"` is the honest ARIA here and deliberately *not* what `SpendRangeNav` uses:
 * that one navigates (`?range=` drives a server component), so it is links with
 * `aria-current`. Reach for this shape only when the state genuinely can't leave the client —
 * the colour theme, which lives in `localStorage`, and the diff viewer's unified/split choice.
 *
 * Extracted from `ThemeToggle`, which was the only copy of this treatment until the diff
 * viewer wanted a second one. Along the way it gained the two things a hand-rolled radiogroup
 * usually never gets round to:
 * - **roving tabindex + arrow keys.** A radio group is one tab stop, and ←/→/↑/↓ move both the
 *   selection and focus (Home/End jump to the ends). Three separate tab stops is what the
 *   role promises you won't get.
 * - **the accessible name in the markup**, as an `sr-only` span rather than an `aria-label`,
 *   so an icon-only segment and a labelled one are named the same way.
 */
export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
  /** Show only the icons; each label stays as the option's `sr-only` accessible name. */
  iconOnly = false,
  className = "",
}: {
  value: T;
  onChange: (value: T) => void;
  options: SegmentedOption<T>[];
  ariaLabel: string;
  iconOnly?: boolean;
  className?: string;
}) {
  const groupRef = useRef<HTMLDivElement>(null);
  // With nothing selected every segment would be `tabIndex={-1}` and the group would drop out
  // of the tab order entirely, so an unmatched value falls back to making the first one the
  // tab stop. ARIA's own answer for an unselected radio group.
  const selected = options.findIndex((o) => o.value === value);
  const tabStop = selected === -1 ? 0 : selected;

  function move(from: number, delta: number) {
    const next = (from + delta + options.length) % options.length;
    onChange(options[next].value);
    // Focus follows selection in a radio group. Done here rather than in an effect, which
    // this build forbids for state and which would also fight a user who clicked.
    groupRef.current
      ?.querySelectorAll<HTMLButtonElement>('[role="radio"]')
      [next]?.focus();
  }

  function onKeyDown(e: KeyboardEvent, index: number) {
    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown":
        e.preventDefault();
        move(index, 1);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        e.preventDefault();
        move(index, -1);
        break;
      case "Home":
        e.preventDefault();
        move(0, 0);
        break;
      case "End":
        e.preventDefault();
        move(options.length - 1, 0);
        break;
    }
  }

  return (
    <div
      ref={groupRef}
      role="radiogroup"
      aria-label={ariaLabel}
      className={`flex items-center gap-0.5 rounded-lg border border-line bg-surface-2 p-0.5 ${className}`}
    >
      {options.map((option, i) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            // One tab stop for the whole group; the arrow keys do the rest.
            tabIndex={i === tabStop ? 0 : -1}
            title={option.label}
            onClick={() => onChange(option.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
              active
                ? "bg-surface text-fg-strong shadow-sm"
                : "text-fg-faint hover:text-fg-muted"
            }`}
          >
            {option.icon}
            <span className={iconOnly ? "sr-only" : ""}>{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
