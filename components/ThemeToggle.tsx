"use client";

import { useSyncExternalStore } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { SegmentedControl } from "@/components/ui/segmented";
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

/** Three-way segmented control — used in the expanded sidebar footer.
 *  The treatment itself lives in `SegmentedControl`, which this was extracted into when the
 *  diff viewer needed the same control for its unified/split choice. */
export function ThemeToggle() {
  const mode = useThemeMode();
  return (
    <SegmentedControl
      value={mode}
      onChange={setThemeMode}
      ariaLabel="Color theme"
      iconOnly
      options={OPTIONS.map(({ mode: m, label, Icon }) => ({
        value: m,
        label,
        icon: <Icon className="size-4" aria-hidden="true" />,
      }))}
    />
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
