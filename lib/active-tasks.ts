/**
 * The running-task badge's data: **one** poll, shared by every subscriber.
 *
 * The badge is mounted twice (the desktop strip in `app/(app)/layout.tsx` and the mobile top
 * bar in `components/MobileNav.tsx`) but only one of them is ever visible, so two independent
 * `useEffect` pollers would double the request rate to show the same number. This is the same
 * external-store shape `lib/sidebar.ts` uses — a module-level snapshot read through
 * `useSyncExternalStore` — with the polling started by the first subscriber and stopped by the
 * last.
 *
 * Everything above `subscribeActiveTasks` is pure and unit-tested (`active-tasks.test.ts`);
 * everything below it touches `document`/`fetch` and only ever inside a function, so this
 * module is safe to import from a server route as well.
 */
import { taskDisplayTitle } from "./ui";
import type { TaskStatus } from "./db/schema";

/** One in-flight run, as the badge needs it — deliberately narrow (see the route). */
export type ActiveTask = {
  id: string;
  /** What to call it: `taskDisplayTitle`, flattened and clipped. Null when it has no name. */
  name: string | null;
  project: string | null;
  status: TaskStatus;
  /** Unix ms, so it survives JSON. */
  createdAt: number;
};

export type ActiveTasksPayload = {
  /**
   * Every active run the caller owns, including any past `ACTIVE_LIST_LIMIT`. The popover
   * discloses the remainder rather than quietly showing a short list — same rule as the
   * capped sections on `/tasks` and `ProjectSpendCard`.
   */
  total: number;
  tasks: ActiveTask[];
};

/** Rows the popover carries. A dozen live agent sessions is already unusual. */
export const ACTIVE_LIST_LIMIT = 12;

/** How long a task's name may be on the wire. `requestText` is the fallback and is whole
 *  prose — unclipped it would put kilobytes into a row that renders one truncated line. */
export const NAME_MAX = 120;

export const POLL_MS = 5000;

/**
 * A task's name for the badge: the shared `taskDisplayTitle` chain, then flattened to a
 * single line and clipped.
 *
 * The flattening is the part that isn't obvious — a `requestText` fallback is multi-line
 * markdown, and a raw slice of it would carry newlines into a row styled to `truncate` (one
 * line, one ellipsis). Collapsing whitespace first also means the clip spends its budget on
 * words rather than on indentation.
 */
export function activeTaskName(task: {
  title?: string | null;
  requestText?: string | null;
}): string | null {
  const name = taskDisplayTitle(task);
  if (!name) return null;
  const flat = name.replace(/\s+/g, " ").trim();
  if (!flat) return null;
  return flat.length > NAME_MAX ? `${flat.slice(0, NAME_MAX - 1)}…` : flat;
}

/**
 * The badge's long-form count, used as its tooltip.
 *
 * **"In progress", not "running"** — that is what this app already calls `ACTIVE_STATUSES`
 * (the dashboard's stat tile and `AtAGlance` both do), and the set includes `queued` plus the
 * two `awaiting_*` gates, which are precisely the states where nothing is running and a person
 * is the hold-up. Calling them "running" was drift, caught in review.
 *
 * This is *not* the accessible name: the pill's own text is ("2 in progress", with the word
 * `sr-only` rather than `hidden` on narrow screens so it stays in the name at every width).
 * Keeping the name in the markup is what makes WCAG 2.5.3 Label in Name hold by construction
 * instead of by two strings agreeing.
 */
export function activityLabel(count: number): string {
  return `${count} task${count === 1 ? "" : "s"} in progress`;
}

export type ActiveTasksState = {
  /** `null` before the first successful poll — "not known yet", not "nothing running". */
  tasks: ActiveTask[] | null;
  total: number;
};

/**
 * Whether two snapshots say the same thing.
 *
 * `useSyncExternalStore` re-renders on any snapshot it hasn't seen, so without this every
 * poll would re-render both badges (and the open popover) five seconds apart forever, whether
 * or not anything moved.
 */
export function sameActiveState(a: ActiveTasksState, b: ActiveTasksState): boolean {
  if (a === b) return true;
  if (a.total !== b.total) return false;
  if (a.tasks === b.tasks) return true;
  if (!a.tasks || !b.tasks) return false;
  if (a.tasks.length !== b.tasks.length) return false;
  return a.tasks.every((t, i) => {
    const o = b.tasks![i];
    return (
      t.id === o.id &&
      t.status === o.status &&
      t.name === o.name &&
      t.project === o.project &&
      t.createdAt === o.createdAt
    );
  });
}

/** Reads a `/api/tasks/active` body without trusting its shape. Always a list, never the
 *  `null` "not known yet" of {@link ActiveTasksState} — a parsed response *is* knowledge. */
export function parseActiveTasks(body: unknown): ActiveTasksPayload {
  const raw = (body ?? {}) as Partial<ActiveTasksPayload>;
  const list: unknown[] = Array.isArray(raw.tasks) ? raw.tasks : [];

  // Every field is rebuilt rather than spread through. `id` and `status` decide whether a row
  // exists at all; `name` and `project` are *coerced*, because React throws outright when it
  // is handed an object as a child and the badge sits in the layout — one malformed row would
  // take down every page rather than one popover.
  const tasks: ActiveTask[] = [];
  for (const row of list) {
    if (!row || typeof row !== "object") continue;
    const t = row as Record<string, unknown>;
    if (typeof t.id !== "string" || !t.id) continue;
    if (typeof t.status !== "string") continue;
    tasks.push({
      id: t.id,
      name: typeof t.name === "string" ? t.name : null,
      project: typeof t.project === "string" ? t.project : null,
      status: t.status as TaskStatus,
      createdAt: typeof t.createdAt === "number" ? t.createdAt : 0,
    });
  }

  return {
    tasks,
    total:
      typeof raw.total === "number" && raw.total >= tasks.length
        ? raw.total
        : tasks.length,
  };
}

// ---------------------------------------------------------------------------
// The store. Nothing below here runs at import time.
// ---------------------------------------------------------------------------

/** Frozen so the server snapshot is a stable reference — `useSyncExternalStore` compares
 *  snapshots by identity and would loop on a fresh object each read. */
const UNKNOWN: ActiveTasksState = { tasks: null, total: 0 };

let state: ActiveTasksState = UNKNOWN;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | null = null;
let inFlight: AbortController | null = null;
let watchingVisibility = false;

export function getActiveTasksSnapshot(): ActiveTasksState {
  return state;
}

/** On the server the badge renders as absent: there is nothing to poll with, and guessing
 *  would hydrate into different markup. */
export function getServerActiveTasksSnapshot(): ActiveTasksState {
  return UNKNOWN;
}

function emit(next: ActiveTasksState) {
  if (sameActiveState(state, next)) return;
  state = next;
  // Copied, so a listener that unsubscribes mid-notify can't skip its neighbour.
  for (const listener of [...listeners]) listener();
}

/** A tab nobody is looking at gets no polling. Also true on the server, where there is no
 *  `document` — the store never starts there, but the guard has to be safe either way. */
function isHidden(): boolean {
  return typeof document === "undefined" || document.hidden;
}

async function poll() {
  if (isHidden()) return;
  inFlight?.abort();
  const controller = new AbortController();
  inFlight = controller;
  try {
    const res = await fetch("/api/tasks/active", {
      cache: "no-store",
      signal: controller.signal,
    });
    if (res.ok) emit(parseActiveTasks(await res.json()));
  } catch {
    // A failed poll keeps the last known list on purpose: this is the least important
    // request on the page, and a badge that blinks out of existence because one fetch lost
    // a race with a server restart is worse than one that is five seconds stale.
  } finally {
    if (inFlight === controller) inFlight = null;
  }
}

function clearTimer() {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
}

function schedule() {
  clearTimer();
  timer = setTimeout(tick, POLL_MS);
}

async function tick() {
  // `clearTimer()`, never a bare `timer = null`. A catch-up tick from `onVisibility` can race
  // a timeout that is already pending; dropping that handle without cancelling it leaves the
  // orphan to fire and start a *second* tick→schedule chain. Both then reschedule themselves
  // forever, so the poll rate doubles for the rest of the session and compounds with every
  // further hide/show. Found by the frontend audit; pinned by a regression test.
  clearTimer();
  await poll();
  // Don't resurrect the loop with nobody listening, or for a tab that went away while this
  // was in flight — `onVisibility` is what restarts it.
  if (listeners.size && !isHidden()) schedule();
}

function onVisibility() {
  if (document.hidden) {
    // A hidden tab is nobody watching a badge. Stop asking, and drop the request already
    // in flight rather than letting it land.
    clearTimer();
    inFlight?.abort();
    return;
  }
  // Back on screen: catch up now instead of waiting out the interval, or a task that
  // finished while the tab was away keeps its badge for another five seconds.
  void tick();
}

function start() {
  if (typeof document !== "undefined" && !watchingVisibility) {
    document.addEventListener("visibilitychange", onVisibility);
    watchingVisibility = true;
  }
  void tick();
}

function stop() {
  clearTimer();
  inFlight?.abort();
  inFlight = null;
  if (watchingVisibility && typeof document !== "undefined") {
    document.removeEventListener("visibilitychange", onVisibility);
    watchingVisibility = false;
  }
}

/** Subscribe to the shared poll. The first subscriber starts it; the last one stops it. */
export function subscribeActiveTasks(onChange: () => void): () => void {
  listeners.add(onChange);
  if (listeners.size === 1) start();
  return () => {
    listeners.delete(onChange);
    if (listeners.size === 0) stop();
  };
}
