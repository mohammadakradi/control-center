/** Theme mode the user picked. `system` follows the OS preference. */
export type ThemeMode = "light" | "dark" | "system";

/** Effective theme after resolving `system` against the OS preference. */
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "cc-theme";
export const THEME_MODES: ThemeMode[] = ["light", "dark", "system"];

const DARK_QUERY = "(prefers-color-scheme: dark)";

function isMode(v: unknown): v is ThemeMode {
  return v === "light" || v === "dark" || v === "system";
}

/**
 * Blocking script injected into <head> so the theme class lands before first
 * paint (no flash of the wrong theme).
 *
 * This is a **static string** — nothing is interpolated into it — and the value
 * read from localStorage is validated against the mode allowlist before it is
 * used, so a tampered storage value can't inject a class name or script.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var m=localStorage.getItem("${THEME_STORAGE_KEY}");if(m!=="light"&&m!=="dark"&&m!=="system"){m="system"}var d=m==="dark"||(m==="system"&&window.matchMedia("${DARK_QUERY}").matches);var r=document.documentElement;r.classList.toggle("dark",d);r.classList.toggle("light",!d);r.dataset.themeMode=m}catch(e){}})();`;

/** Reads the OS preference. Returns "light" outside the browser. */
export function systemTheme(): ResolvedTheme {
  if (typeof window === "undefined") return "light";
  return window.matchMedia(DARK_QUERY).matches ? "dark" : "light";
}

export function resolveTheme(mode: ThemeMode): ResolvedTheme {
  return mode === "system" ? systemTheme() : mode;
}

/** Writes the resolved theme onto <html>. Mirrors `THEME_INIT_SCRIPT`. */
function applyTheme(mode: ThemeMode) {
  const dark = resolveTheme(mode) === "dark";
  const root = document.documentElement;
  root.classList.toggle("dark", dark);
  root.classList.toggle("light", !dark);
  root.dataset.themeMode = mode;
}

// --- External store -------------------------------------------------------
// The theme lives on <html> (set pre-hydration by the init script), not in React
// state. `useSyncExternalStore` reads it without a setState-in-effect, which this
// project's lint config treats as a hard error.

const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

// Another tab changed the preference.
const onStorage = (e: StorageEvent) => {
  if (e.key !== THEME_STORAGE_KEY) return;
  applyTheme(isMode(e.newValue) ? e.newValue : "system");
  emit();
};
// The OS flipped while we're on `system`.
const onMedia = () => {
  if (getThemeMode() === "system") {
    applyTheme("system");
    emit();
  }
};

/** Window listeners are attached once for the whole app, not once per consumer —
 *  otherwise N mounted components mean N redundant applies per event. */
function setListeners(on: boolean) {
  const media = window.matchMedia(DARK_QUERY);
  if (on) {
    window.addEventListener("storage", onStorage);
    media.addEventListener("change", onMedia);
  } else {
    window.removeEventListener("storage", onStorage);
    media.removeEventListener("change", onMedia);
  }
}

export function subscribeTheme(onChange: () => void): () => void {
  if (listeners.size === 0) setListeners(true);
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
    if (listeners.size === 0) setListeners(false);
  };
}

/** Current mode, read back off <html>. */
export function getThemeMode(): ThemeMode {
  if (typeof document === "undefined") return "system";
  const v = document.documentElement.dataset.themeMode;
  return isMode(v) ? v : "system";
}

/** SSR snapshot — the real value isn't knowable on the server. */
export function getServerThemeMode(): ThemeMode {
  return "system";
}

export function setThemeMode(mode: ThemeMode) {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    // Private mode / storage disabled — the choice just won't persist.
  }
  applyTheme(mode);
  emit();
}
