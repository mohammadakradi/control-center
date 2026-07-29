export const SIDEBAR_STORAGE_KEY = "cc-sidebar";

/**
 * Blocking script that applies the saved sidebar width before first paint, so a
 * collapsed rail doesn't flash open on load. Static string — nothing is
 * interpolated, and the stored value is compared against a literal rather than
 * being written through to the DOM.
 */
export const SIDEBAR_INIT_SCRIPT = `(function(){try{var c=localStorage.getItem("${SIDEBAR_STORAGE_KEY}")==="collapsed";document.documentElement.dataset.sidebar=c?"collapsed":"expanded"}catch(e){}})();`;

const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

// Keep other tabs in sync, mirroring the theme store.
const onStorage = (e: StorageEvent) => {
  if (e.key !== SIDEBAR_STORAGE_KEY) return;
  document.documentElement.dataset.sidebar =
    e.newValue === "collapsed" ? "collapsed" : "expanded";
  emit();
};

export function subscribeSidebar(onChange: () => void): () => void {
  if (listeners.size === 0) window.addEventListener("storage", onStorage);
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
    if (listeners.size === 0) window.removeEventListener("storage", onStorage);
  };
}

export function getSidebarCollapsed(): boolean {
  if (typeof document === "undefined") return false;
  return document.documentElement.dataset.sidebar === "collapsed";
}

export function getServerSidebarCollapsed(): boolean {
  return false;
}

export function toggleSidebar() {
  const next = getSidebarCollapsed() ? "expanded" : "collapsed";
  try {
    localStorage.setItem(SIDEBAR_STORAGE_KEY, next);
  } catch {
    // Storage disabled — the choice just won't persist.
  }
  document.documentElement.dataset.sidebar = next;
  emit();
}
