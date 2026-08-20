/**
 * The command palette's data model: what rows it offers, in what order, and how the highlight
 * moves over them — plus the tiny store that says whether it is open.
 *
 * All of it lives here rather than in `components/CommandPalette.tsx` for the reason
 * `orderSkills` and `taskChangesView` do: `pnpm test` cannot reach `components/`, and this is
 * the branchiest part of the feature. What a query matches, which section a search hit lands
 * in, where a row navigates and how the highlight wraps are all decisions that can be wrong
 * silently — a row that points at the wrong id still renders perfectly.
 *
 * **Nothing here imports a value from `lib/search.ts`.** That module opens the database at
 * import time, so a client component may only take *types* from it — one value import (even a
 * constant as small as `MIN_QUERY_LENGTH`) would pull `better-sqlite3` into the browser bundle,
 * the same trap `lib/pm-spec.ts` and `lib/update-ui.ts` document. Which is also why the palette
 * never re-declares the minimum query length: it sends whatever was typed and reads `tooShort`
 * off the response, the field the endpoint exposes for exactly this.
 */
import type { SearchResults } from "./search";
import type { TaskStatus } from "./db/schema";
import type { ThemeMode } from "./theme";
import { BACKLOG_STATUS_LABEL, taskDisplayTitle } from "./ui";

/**
 * What a row *is*, which is what decides its icon and how activating it behaves. Only `theme`
 * runs a client action; every other kind navigates.
 */
export type PaletteEntryKind =
  /** A primary-nav destination, from `NAV_LINKS`. */
  | "page"
  /** Sets the colour theme — the one kind that doesn't navigate. */
  | "theme"
  /** Jumps to a project's dispatch form. */
  | "new-task"
  | "task"
  | "project"
  | "agent"
  | "backlog";

export type PaletteEntry = {
  /** React key. **Not** the DOM id — that is derived from the row's position, so that
   *  `aria-activedescendant` can't reference a stale one (the `Select` shape). */
  key: string;
  kind: PaletteEntryKind;
  /** The row's primary line, and its accessible name. */
  label: string;
  /** Optional second line — a path, a project, a status. */
  description?: string;
  /** Extra terms the static filter matches on. A page called "Settings" should answer to
   *  "token"; nothing in its label says so. */
  keywords?: string[];
  /** Where it goes. Set on every kind except `theme`. */
  href?: string;
  /** The mode a `theme` row applies. */
  theme?: ThemeMode;
  /** True on the row describing the state you are already in (the current theme), so the UI
   *  can mark it rather than pretending all three are changes. */
  current?: boolean;
  /** A task's status, for the badge on its row. Kept out of `description` so the row renders
   *  it through `StatusBadge` and can't drift from `STATUS_LABEL`. */
  status?: TaskStatus;
};

export type PaletteSection = {
  id: string;
  title: string;
  entries: PaletteEntry[];
  /**
   * The server capped this group and hid something. Disclosed on screen rather than truncating
   * silently — the same rule `ProjectSpendCard` and the `/tasks` groups follow.
   */
  hasMore?: boolean;
  /**
   * This section's first row's position in the flat list — so a row can name its own index
   * without the render walking a counter across sections.
   *
   * It lives here rather than being counted while rendering for two reasons. Mutating a
   * variable mid-render is rejected outright by this build's `react-hooks/immutability` rule;
   * and an off-by-one across groups is invisible on screen — the highlight simply lands one
   * row away from the one Enter activates. Stamped **after** empty sections are dropped, so
   * these agree with {@link flattenEntries} by construction.
   */
  start: number;
};

/** The nav shape this module needs. Passed in rather than imported, so nothing here depends on
 *  `components/nav-links.tsx` (which pulls in lucide) and the tests need no fixtures beyond
 *  plain objects. */
export type NavEntry = { href: string; label: string; keywords?: string[] };

/**
 * How many projects get a "New task in …" row.
 *
 * The action exists because dispatching is the most common thing you'd want to *do* rather than
 * go to, and it can only be done against a project. Capped because a two-letter query can match
 * every project on the install, and a dozen near-identical action rows in front of the projects
 * they refer to buries the thing you were looking for.
 */
export const MAX_PROJECT_ACTIONS = 3;

const THEME_LABELS: { mode: ThemeMode; label: string; keywords: string[] }[] = [
  { mode: "light", label: "Light theme", keywords: ["theme", "colour", "color"] },
  { mode: "dark", label: "Dark theme", keywords: ["theme", "colour", "color"] },
  {
    mode: "system",
    label: "System theme",
    keywords: ["theme", "colour", "color", "auto"],
  },
];

/** Join the parts of a secondary line, dropping the empty ones so no separator dangles. */
function detail(...parts: (string | null | undefined)[]): string | undefined {
  const kept = parts.map((p) => p?.trim()).filter((p): p is string => !!p);
  return kept.length ? kept.join(" · ") : undefined;
}

/**
 * Does this row answer the query? Case-insensitive, and **the two halves match differently**:
 * substring over the text a user can see (label, secondary line), *prefix* over the invisible
 * keywords.
 *
 * That asymmetry is not tidiness. A keyword is a word you have in mind and start typing, so a
 * prefix is the honest test — matching it as a substring means a query aimed at something else
 * drags the row in and pushes the real answer down the list. Found by a spec: `theme` once
 * carried the keyword `appearance`, so typing `app` to reach a project called `app-0` put all
 * three theme rows above it. `token` on the Settings page would do the same to `ok`.
 *
 * Only ever applied to the **static** rows: the search results were already matched by the
 * endpoint, and re-filtering them here would drop rows that matched on a column the palette
 * doesn't render (a task's request text, a backlog item's body).
 */
export function matchesQuery(entry: PaletteEntry, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (entry.label.toLowerCase().includes(q)) return true;
  if (entry.description?.toLowerCase().includes(q)) return true;
  return (entry.keywords ?? []).some((k) => k.toLowerCase().startsWith(q));
}

export function filterEntries(entries: PaletteEntry[], query: string): PaletteEntry[] {
  return entries.filter((e) => matchesQuery(e, query));
}

function pageEntries(navLinks: NavEntry[]): PaletteEntry[] {
  return navLinks.map((link) => ({
    key: `page:${link.href}`,
    kind: "page" as const,
    label: link.label,
    href: link.href,
    keywords: link.keywords,
  }));
}

function themeEntries(mode: ThemeMode): PaletteEntry[] {
  return THEME_LABELS.map((t) => ({
    key: `theme:${t.mode}`,
    kind: "theme" as const,
    label: t.label,
    theme: t.mode,
    current: t.mode === mode,
    keywords: t.keywords,
  }));
}

/**
 * "New task in <project>" for each project the query matched.
 *
 * Deep-links to the dispatch form's card (`#new-task` on the project page) rather than
 * focusing the textarea — focusing it would mean the project page reading the URL hash, which
 * is a change to a server component for a nicety.
 */
function newTaskEntries(results: SearchResults | null): PaletteEntry[] {
  return (results?.projects.items ?? []).slice(0, MAX_PROJECT_ACTIONS).map((p) => ({
    key: `new-task:${p.id}`,
    kind: "new-task" as const,
    label: `New task in ${p.name}`,
    description: "Open the dispatch form",
    href: `/projects/${encodeURIComponent(p.id)}#new-task`,
  }));
}

function taskEntries(results: SearchResults): PaletteEntry[] {
  return results.tasks.items.map((t) => ({
    key: `task:${t.id}`,
    kind: "task" as const,
    // `taskDisplayTitle` deliberately leaves the last resort to the caller. A list row shows
    // the command beside the name; a palette row has only one line, so the command *is* the
    // fallback name — never an empty row.
    label: taskDisplayTitle(t) ?? t.command,
    description: detail(t.projectName),
    href: `/tasks/${encodeURIComponent(t.id)}`,
    status: t.status,
  }));
}

function projectEntries(results: SearchResults): PaletteEntry[] {
  return results.projects.items.map((p) => ({
    key: `project:${p.id}`,
    kind: "project" as const,
    label: p.name,
    description: p.path,
    href: `/projects/${encodeURIComponent(p.id)}`,
  }));
}

function backlogEntries(results: SearchResults): PaletteEntry[] {
  return results.backlog.items.map((b) => ({
    key: `backlog:${b.id}`,
    kind: "backlog" as const,
    label: b.title,
    description: detail(b.projectName, BACKLOG_STATUS_LABEL[b.status]),
    // There is no per-item route — `/backlog` shows one project at a time, so the honest
    // destination is that project's list.
    href: `/backlog?project=${encodeURIComponent(b.projectId)}`,
  }));
}

function agentEntries(results: SearchResults): PaletteEntry[] {
  return results.agents.items.map((a) => ({
    key: `agent:${a.id}`,
    kind: "agent" as const,
    label: a.name,
    // The namespace, not the plugin description: `/swe` is what you'd have typed, and a
    // description is free-form text up to the snippet cap.
    description: `/${a.namespace}`,
    href: `/agents/${encodeURIComponent(a.id)}`,
  }));
}

/** Drop the sections that ended up with no rows (an empty heading reads as a failed load),
 *  then stamp each survivor with where its rows begin in the flat list. */
function renderable(sections: Omit<PaletteSection, "start">[]): PaletteSection[] {
  let start = 0;
  return sections
    .filter((s) => s.entries.length > 0)
    .map((s) => {
      const stamped = { ...s, start };
      start += s.entries.length;
      return stamped;
    });
}

/**
 * Every row the palette should show, grouped, in order.
 *
 * Order is "cheapest and most certain first": the static rows are an exact, local answer, then
 * the projects and tasks most queries are aiming at, then backlog and agents. Actions sit
 * second because they are *doing* something rather than going somewhere, and because
 * "New task in X" reads best directly above the project X it refers to.
 *
 * `results` is null until the first response lands (and stays null for an empty query, which
 * is never sent), so an empty query yields exactly the static sections.
 */
export function paletteSections({
  navLinks,
  themeMode,
  query,
  results,
}: {
  navLinks: NavEntry[];
  themeMode: ThemeMode;
  query: string;
  results: SearchResults | null;
}): PaletteSection[] {
  const pages = filterEntries(pageEntries(navLinks), query);
  // Project actions are already query-matched (the endpoint matched the project), so only the
  // theme rows go through the filter.
  const actions = [...filterEntries(themeEntries(themeMode), query), ...newTaskEntries(results)];

  const dynamic: Omit<PaletteSection, "start">[] = results
    ? [
        {
          id: "projects",
          title: "Projects",
          entries: projectEntries(results),
          hasMore: results.projects.hasMore,
        },
        {
          id: "tasks",
          title: "Tasks",
          entries: taskEntries(results),
          hasMore: results.tasks.hasMore,
        },
        {
          id: "backlog",
          title: "Backlog",
          entries: backlogEntries(results),
          hasMore: results.backlog.hasMore,
        },
        {
          id: "agents",
          title: "Agents",
          entries: agentEntries(results),
          hasMore: results.agents.hasMore,
        },
      ]
    : [];

  return renderable([
    { id: "pages", title: "Pages", entries: pages },
    { id: "actions", title: "Actions", entries: actions },
    ...dynamic,
  ]);
}

/** The rows in render order — what the highlight index counts and what Enter activates. */
export function flattenEntries(sections: PaletteSection[]): PaletteEntry[] {
  return sections.flatMap((s) => s.entries);
}

/**
 * Move the highlight, wrapping at both ends.
 *
 * Wrapping rather than clamping, matching `SegmentedControl`'s roving focus and the diff
 * viewer's prev/next: the list is long and grouped, so reaching the last section shouldn't mean
 * holding a key down. Returns 0 for an empty list so the caller always has a valid index.
 */
export function moveActive(index: number, length: number, delta: number): number {
  if (length <= 0) return 0;
  return (((index + delta) % length) + length) % length;
}

// ---------------------------------------------------------------------------
// Open/closed state.
//
// A module store read through `useSyncExternalStore`, the same shape as `lib/sidebar.ts` and
// `lib/toast.ts`, because the things that *open* the palette don't own it: a global ⌘K
// listener, a button in the sidebar, and another in the mobile top bar all act on a dialog
// mounted once in the app layout.

let paletteOpen = false;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function subscribePaletteOpen(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

export function getPaletteOpen(): boolean {
  return paletteOpen;
}

/** SSR snapshot. The palette is a client interaction, so it is never open on the server. */
export function getServerPaletteOpen(): boolean {
  return false;
}

/** Set the state, notifying only on a real change — otherwise every ⌘K on an open palette
 *  would re-render the layout for nothing. */
function setPaletteOpen(next: boolean) {
  if (paletteOpen === next) return;
  paletteOpen = next;
  emit();
}

export function openPalette() {
  setPaletteOpen(true);
}

export function closePalette() {
  setPaletteOpen(false);
}

export function togglePalette() {
  setPaletteOpen(!paletteOpen);
}

// ---------------------------------------------------------------------------
// How to write the shortcut.

/**
 * `⌘K` or `Ctrl K`, whichever this machine actually uses.
 *
 * Read through `useSyncExternalStore` rather than computed in a component, for the reason
 * `lib/theme.ts` does it: the answer isn't knowable on the server, and rendering the wrong one
 * and correcting it in an effect is both a hydration mismatch and a state write in an effect.
 * The value can never change for the life of the page, so {@link subscribeShortcutHint} has
 * nothing to subscribe to — that is the whole point, not an omission.
 *
 * Both bindings work everywhere (the listener accepts either modifier); this only decides which
 * one the hint *names*. The app is macOS-first, so that is what the server renders.
 */
export function shortcutHint(): string {
  if (typeof navigator === "undefined") return "⌘K";
  const platform = navigator.platform || navigator.userAgent || "";
  return /Mac|iPhone|iPad|iPod/i.test(platform) ? "⌘K" : "Ctrl K";
}

export function serverShortcutHint(): string {
  return "⌘K";
}

export function subscribeShortcutHint(): () => void {
  return () => {};
}
