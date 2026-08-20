"use client";

import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import {
  Boxes,
  Check,
  ClipboardList,
  Command,
  FolderGit2,
  ListChecks,
  Loader2,
  Monitor,
  Moon,
  Plus,
  Search,
  Sun,
  type LucideIcon,
} from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { ErrorAlert } from "@/components/ui/error-alert";
import { StatusBadge } from "@/components/StatusBadge";
import { NAV_LINKS } from "@/components/nav-links";
import {
  closePalette,
  flattenEntries,
  getPaletteOpen,
  getServerPaletteOpen,
  moveActive,
  openPalette,
  paletteSections,
  shortcutHint,
  subscribePaletteOpen,
  subscribeShortcutHint,
  serverShortcutHint,
  togglePalette,
  type PaletteEntry,
} from "@/lib/command-palette";
import {
  getServerThemeMode,
  getThemeMode,
  setThemeMode,
  subscribeTheme,
} from "@/lib/theme";
import type { SearchResults } from "@/lib/search";

/**
 * How long typing has to settle before a request goes out. Short enough that the results feel
 * attached to the keystroke, long enough that typing a project name is one request rather than
 * eight.
 */
const DEBOUNCE_MS = 150;

/**
 * Results per type. Deliberately below the endpoint's own default of 8: four types means this
 * is really a cap of `4 × LIMIT` rows, and 32 of them is a list you scroll rather than scan.
 * A group the cap trimmed says so in its heading, so nothing is hidden silently.
 */
const LIMIT = 5;

/**
 * Row icon by lookup key — one flat record and a `??` fallback, the shape `StatusBadge` uses.
 *
 * Deliberately not a `Map` and not a chain of ternaries: this build's `react-hooks`
 * rules can't prove either of those yields a *stable* component, so both are rejected as
 * "creating a component during render". A module-level record indexed by a string can be.
 *
 * Pages take their icon from `NAV_LINKS`, so adding a nav entry needs nothing here.
 */
const ICONS: Record<string, LucideIcon> = {
  "theme:light": Sun,
  "theme:dark": Moon,
  "theme:system": Monitor,
  "new-task": Plus,
  task: ListChecks,
  project: FolderGit2,
  agent: Boxes,
  backlog: ClipboardList,
};
for (const link of NAV_LINKS) ICONS[`page:${link.href}`] = link.Icon;

/** Pages and themes are per-instance; every other kind has one icon. */
function iconKey(entry: PaletteEntry): string {
  if (entry.kind === "page") return `page:${entry.href}`;
  if (entry.kind === "theme") return `theme:${entry.theme}`;
  return entry.kind;
}

function EntryIcon({ entry }: { entry: PaletteEntry }) {
  const Icon = ICONS[iconKey(entry)] ?? Search;
  return <Icon className="size-4 shrink-0 text-fg-subtle" aria-hidden="true" />;
}

/**
 * Scroll to an href's `#fragment` when that element is already on the current page.
 *
 * **A `router.push` to the URL you are already on is a no-op**, so "New task in *project*"
 * pressed while already sitting on that project's page *at that hash* silently did nothing —
 * the palette closed, the page didn't move, and the card stayed 591px off screen (measured; the
 * design review raised it as a possibility and the worst case turned out to be real, while the
 * simpler same-pathname-without-the-hash case scrolls correctly on its own).
 *
 * Deferred a frame because `Modal` locks `body` scroll while it is open: run synchronously, this
 * fires before React has committed the unmount that releases the lock. On a *cross-page*
 * navigation the target doesn't exist yet, so this is a no-op and the router keeps doing the
 * scrolling it already does correctly.
 */
function scrollToFragment(href: string) {
  const hash = href.split("#")[1];
  if (!hash) return;
  requestAnimationFrame(() => {
    document.getElementById(hash)?.scrollIntoView({ block: "start" });
  });
}

/**
 * The ⌘K palette: search and jump to any project, task, agent, backlog item or page, plus the
 * few things you'd want to *do* rather than go to.
 *
 * Mounted **once** in `app/(app)/layout.tsx`. This outer component is only the global shortcut
 * and the open bit — the dialog and everything in it mounts fresh each time, which is what
 * gives a newly opened palette an empty query and a highlight back at the top with no reset
 * code. (Resetting on open would mean `setState` in an effect, a hard error in this build.)
 */
export function CommandPalette() {
  const open = useSyncExternalStore(
    subscribePaletteOpen,
    getPaletteOpen,
    getServerPaletteOpen,
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // ⌥⌘K and friends belong to something else.
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      if (e.key !== "k" && e.key !== "K") return;
      // Holding the combo down repeats it at the OS key-repeat rate, and each repeat would
      // toggle — mounting and unmounting the dialog (focus RAF, scroll lock, focus trap)
      // several times a second.
      if (e.repeat) return;
      // Claimed app-wide, so it is prevented even on the paths that then do nothing: Chrome
      // and Firefox both bind ⌘K/Ctrl+K to the address bar, and a shortcut that usually opens
      // the palette but sometimes jumps to the address bar is worse than one that is
      // consistently ours.
      e.preventDefault();
      // Don't open on top of another dialog. `Modal` puts its Escape handler on `document`,
      // so two of them means one Escape key closing both and two focus traps fighting over
      // the same Tab press. Closing our own is still allowed.
      if (!getPaletteOpen() && document.querySelector('[role="dialog"]')) return;
      togglePalette();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return open ? <PaletteDialog /> : null;
}

function PaletteDialog() {
  const router = useRouter();
  const themeMode = useSyncExternalStore(
    subscribeTheme,
    getThemeMode,
    getServerThemeMode,
  );

  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [results, setResults] = useState<SearchResults | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const baseId = useId();
  const listboxId = `${baseId}-listbox`;

  const trimmed = query.trim();

  const sections = useMemo(
    () =>
      paletteSections({
        navLinks: NAV_LINKS,
        themeMode,
        query,
        // Held results belong to whatever was last searched, so they stay on screen while the
        // next request is in flight rather than blanking between keystrokes. Clearing the box
        // clears them outright (see `changeQuery`), or emptying and retyping would show the
        // old query's hits under the new one.
        results: trimmed ? results : null,
      }),
    [themeMode, query, trimmed, results],
  );
  const entries = useMemo(() => flattenEntries(sections), [sections]);

  // The stored highlight can fall out of range when results arrive or narrow; clamp it on read
  // rather than correcting it in an effect (`Select`'s rule, and this build forbids the effect).
  const activeIdx = entries.length ? Math.min(active, entries.length - 1) : 0;

  // Focus the field. `Modal` focuses its panel on mount, so this has to run after — a frame
  // later, the same way `Select` focuses its search box. DOM sync only, no state.
  useEffect(() => {
    const raf = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, []);

  // Keep the highlighted row visible. The list has no focusable children, so this is the only
  // thing that scrolls it for a keyboard user.
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-idx="${activeIdx}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIdx]);

  // Debounced search.
  //
  // **`AbortController` is what actually prevents a stale render**, and the comparison below is
  // not a second line of defence against a race: `trimmed` is closed over by this effect, so it
  // is the very value that produced the request. React runs this cleanup before the next effect,
  // so at most one un-aborted request is ever outstanding. The `q` check therefore only fires if
  // the *server* answered a different question than it was asked — cheap, and it keeps the
  // response from being trusted on the one path where trusting it would be wrong. (An earlier
  // comment here claimed it caught a client-side race; the audit correctly called that
  // overstated.)
  useEffect(() => {
    if (!trimmed) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      fetch(`/api/search?q=${encodeURIComponent(trimmed)}&limit=${LIMIT}`, {
        signal: controller.signal,
      })
        .then(async (res) => {
          const body = await res.json().catch(() => null);
          if (!res.ok) {
            throw new Error(
              typeof body?.error === "string" ? body.error : `Search failed (${res.status}).`,
            );
          }
          // A 200 that isn't the shape we asked for is a failure, not a no-op: dropping it
          // silently would leave the previous query's results on screen under a new query
          // with nothing said.
          if (body === null) throw new Error("Search returned an unreadable response.");
          if (body.q !== trimmed) {
            throw new Error("Search answered a different query. Try again.");
          }
          setResults(body as SearchResults);
          setError(null);
        })
        .catch((e: unknown) => {
          if (controller.signal.aborted) return;
          setError(e instanceof Error ? e.message : "Search failed.");
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [trimmed]);

  /** Everything the query changing has to reset, in an event handler where state writes are
   *  allowed. Emptying the box also drops the previous results — and the spinner, which the
   *  aborted request's `finally` will never reach. */
  function changeQuery(next: string) {
    setQuery(next);
    setActive(0);
    if (!next.trim()) {
      setResults(null);
      setError(null);
      setLoading(false);
    }
  }

  function run(entry: PaletteEntry) {
    // Close first: `Modal`'s cleanup restores focus to whatever opened it, which should happen
    // before the new page takes over.
    closePalette();
    if (entry.kind === "theme" && entry.theme) {
      setThemeMode(entry.theme);
      return;
    }
    if (entry.href) {
      router.push(entry.href);
      scrollToFragment(entry.href);
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    // Home/End are deliberately left alone: this is an editable combobox, so they move the text
    // caret. Escape belongs to `Modal`.
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActive(moveActive(activeIdx, entries.length, 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setActive(moveActive(activeIdx, entries.length, -1));
        break;
      case "Enter": {
        const entry = entries[activeIdx];
        if (entry) {
          e.preventDefault();
          run(entry);
        }
        break;
      }
    }
  }

  const activeId = entries[activeIdx] ? `${baseId}-opt-${activeIdx}` : undefined;

  const emptyMessage =
    entries.length > 0 || error
      ? null
      : loading || (trimmed && !results)
        ? "Searching…"
        : results?.tooShort
          ? "Keep typing to search tasks, projects, agents and backlog items."
          : trimmed
            ? `No matches for “${trimmed}”.`
            : null;

  return (
    <Modal
      label="Command palette"
      align="top"
      className="max-w-xl"
      onClose={closePalette}
      header={
        <span className="flex items-center gap-2 text-sm text-fg-subtle">
          <Command className="size-4 shrink-0" aria-hidden="true" />
          Command palette
        </span>
      }
    >
      {/* The keyboard model lives on the wrapper so it catches the field *and* any click
          target inside — the same shape `Select` uses. */}
      <div onKeyDown={onKeyDown} className="flex min-h-0 flex-col">
        <div className="flex items-center gap-2.5 border-b border-line px-4 py-3">
          <Search className="size-4 shrink-0 text-fg-faint" aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => changeQuery(e.target.value)}
            placeholder="Search projects, tasks, backlog…"
            role="combobox"
            aria-expanded
            aria-controls={listboxId}
            aria-autocomplete="list"
            aria-activedescendant={activeId}
            aria-label="Search and run commands"
            className="w-full bg-transparent text-sm text-fg-strong outline-none placeholder:text-fg-faint"
          />
          {loading && (
            <Loader2
              className="size-4 shrink-0 animate-spin text-fg-faint"
              aria-hidden="true"
            />
          )}
        </div>

        {error && (
          <ErrorAlert
            message={error}
            className="border-b border-line bg-danger-soft px-4 py-2 text-xs"
          />
        )}

        {/* Counts, for a screen reader only — the visible equivalent is the list itself. */}
        <p className="sr-only" aria-live="polite">
          {entries.length === 1 ? "1 result" : `${entries.length} results`}
        </p>

        {/* The scroll container and the listbox are separate elements on purpose: a listbox
            may only contain options and groups, so the empty-state sentence has to sit
            outside it while still scrolling with the list. `listRef` stays on the scroller. */}
        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto p-2">
          <div id={listboxId} role="listbox" aria-label="Results">
            {sections.map((section) => {
              const headingId = `${baseId}-sec-${section.id}`;
              return (
                <div
                  key={section.id}
                  role="group"
                  aria-labelledby={headingId}
                  className="mb-1 last:mb-0"
                >
                  {/* The same eyebrow treatment as the sidebar's "Navigate". When the endpoint
                      capped this group the fact goes *in the heading*, which makes it part of
                      the group's accessible name rather than stray text in a listbox. */}
                  <div
                    id={headingId}
                    className="flex items-baseline justify-between gap-2 px-2 pt-2 pb-1 text-[11px] font-medium tracking-wider text-fg-faint uppercase"
                  >
                    <span>{section.title}</span>
                    {section.hasMore && <span className="normal-case">more matches</span>}
                  </div>
                  {section.entries.map((entry, i) => {
                    // `section.start` is stamped by `paletteSections` over the sections that
                    // actually render, so this can't drift from `flattenEntries`' order.
                    const idx = section.start + i;
                    const isActive = idx === activeIdx;
                    return (
                      <div
                        key={entry.key}
                        id={`${baseId}-opt-${idx}`}
                        data-idx={idx}
                        role="option"
                        aria-selected={isActive}
                        onMouseEnter={() => setActive(idx)}
                        onClick={() => run(entry)}
                        className={`flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2 ${
                          isActive ? "bg-surface-3" : ""
                        }`}
                      >
                        <EntryIcon entry={entry} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm text-fg">
                            {entry.label}
                            {entry.current && <span className="sr-only"> (current)</span>}
                          </span>
                          {entry.description && (
                            <span
                              className={`block truncate text-xs text-fg-faint ${
                                entry.kind === "project" ? "font-mono" : ""
                              }`}
                            >
                              {entry.description}
                            </span>
                          )}
                        </span>
                        {entry.current && (
                          <Check className="size-4 shrink-0 text-accent" aria-hidden="true" />
                        )}
                        {entry.status && (
                          // `sr-only sm:not-sr-only`, not `hidden sm:flex`: "Awaiting change
                          // approval" would leave a 320px row ~96px for the title, but dropping
                          // the element entirely would take the status out of the row's
                          // accessible name too. Same trick as `MobileTabBar`'s labels.
                          <span className="sr-only shrink-0 sm:not-sr-only sm:flex">
                            <StatusBadge status={entry.status} />
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>

          {emptyMessage && (
            <p className="px-3 py-8 text-center text-sm text-fg-faint">{emptyMessage}</p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line px-4 py-2 text-[11px] text-fg-faint">
          <Hint keys="↑↓">navigate</Hint>
          <Hint keys="↵">open</Hint>
          <Hint keys="esc">close</Hint>
        </div>
      </div>
    </Modal>
  );
}

function Hint({ keys, children }: { keys: string; children: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <kbd className="rounded border border-line bg-surface-2 px-1 font-mono text-[10px] text-fg-subtle">
        {keys}
      </kbd>
      {children}
    </span>
  );
}

/**
 * The button that opens the palette — the only thing that makes it discoverable, and on a phone
 * the only thing that makes it *reachable*, since there is no ⌘K there.
 *
 * Mounted three times (expanded sidebar, collapsed rail, mobile top bar), which is why the two
 * treatments live here rather than being written out at each call site.
 */
export function PaletteTrigger({
  iconOnly = false,
  className = "",
}: {
  iconOnly?: boolean;
  className?: string;
}) {
  const hint = useSyncExternalStore(
    subscribeShortcutHint,
    shortcutHint,
    serverShortcutHint,
  );

  if (iconOnly) {
    return (
      <button
        type="button"
        onClick={openPalette}
        aria-keyshortcuts="Meta+K Control+K"
        title={`Search and jump to anything (${hint})`}
        className={`grid size-9 shrink-0 place-items-center rounded-lg text-fg-subtle transition-colors hover:bg-hover hover:text-fg-strong ${className}`}
      >
        <Search className="size-4.5" aria-hidden="true" />
        <span className="sr-only">Search</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={openPalette}
      aria-keyshortcuts="Meta+K Control+K"
      // Shaped like a field rather than a button, because what it opens is a text box —
      // `border-line-strong` + `bg-surface-2` is what `fieldClasses` uses.
      className={`flex items-center gap-2.5 rounded-lg border border-line-strong bg-surface-2 px-3 py-2 text-sm text-fg-faint transition-colors hover:bg-surface-3 hover:text-fg ${className}`}
    >
      <Search className="size-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate text-left">Search</span>
      <kbd className="shrink-0 rounded border border-line bg-surface px-1.5 font-mono text-[10px] text-fg-subtle">
        {hint}
      </kbd>
    </button>
  );
}
