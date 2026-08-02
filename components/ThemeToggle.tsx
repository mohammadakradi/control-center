"use client";

import { useSyncExternalStore } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import {
  getServerThemeMode,
  getThemeMode,
  resolveTheme,
  setThemeMode,
  subscribeTheme,
  type ThemeMode,
} from "@/lib/theme";

const OPTIONS: { mode: ThemeMode; label: string; Icon: typeof Sun }[] = [
  { mode: "light", label: "Light", Icon: Sun },
  { mode: "dark", label: "Dark", Icon: Moon },
  { mode: "system", label: "System", Icon: Monitor },
];

function useThemeMode(): ThemeMode {
  return useSyncExternalStore(subscribeTheme, getThemeMode, getServerThemeMode);
}

/** Three-way segmented control — used in the expanded sidebar footer. */
export function ThemeToggle() {
  const mode = useThemeMode();
  return (
    <div
      role="radiogroup"
      aria-label="Color theme"
      className="flex items-center gap-0.5 rounded-lg border border-line bg-surface-2 p-0.5"
    >
      {OPTIONS.map(({ mode: m, label, Icon }) => {
        const active = mode === m;
        return (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={label}
            title={label}
            onClick={() => setThemeMode(m)}
            className={`flex flex-1 items-center justify-center rounded-md py-1.5 transition-colors ${
              active
                ? "bg-surface text-fg-strong shadow-sm"
                : "text-fg-faint hover:text-fg-muted"
            }`}
          >
            <Icon className="size-4" aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}

/** Single button that cycles light → dark → system. Used in the collapsed
 *  sidebar rail and the mobile top bar, where there's no room for the group. */
export function ThemeToggleIcon({ className = "" }: { className?: string }) {
  const mode = useThemeMode();
  const next = OPTIONS[(OPTIONS.findIndex((o) => o.mode === mode) + 1) % OPTIONS.length];

  // Show what's currently in effect; announce what clicking will do.
  const Icon =
    mode === "system" ? Monitor : resolveTheme(mode) === "dark" ? Moon : Sun;

  return (
    <button
      type="button"
      onClick={() => setThemeMode(next.mode)}
      aria-label={`Theme: ${mode}. Switch to ${next.label.toLowerCase()}.`}
      title={`Theme: ${mode} — click for ${next.label.toLowerCase()}`}
      className={`grid size-9 shrink-0 place-items-center rounded-lg text-fg-subtle transition-colors hover:bg-hover hover:text-fg-strong ${className}`}
    >
      <Icon className="size-4.5" aria-hidden="true" />
    </button>
  );
}
