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
  /**
   * Runs that reached a terminal status within {@link FINISHED_WINDOW_MS}, same shape as
   * `tasks` with the terminal status in `status`.
   *
   * **This exists so a finished run can be reported rather than inferred.** The badge itself
   * doesn't need it — but a task simply *vanishing* from `tasks` cannot tell `done` from
   * `failed` from `cancelled`, and those are three different things to tell someone. Absence
   * is ambiguous for a second reason too: `tasks` is capped at `ACTIVE_LIST_LIMIT` while
   * `total` is not, so a still-running task can drop out of the list just by being pushed
   * down it. `Toaster` reads this list; nothing infers from a gap.
   *
   * `cancelled` is carried even though nothing raises a toast for it — it is how a pending
   * gate notice learns to retract itself when you stop the run.
   */
  finished: ActiveTask[];
};

/** Rows the popover carries. A dozen live agent sessions is already unusual. */
export const ACTIVE_LIST_LIMIT = 12;

/**
 * How far back `finished` reaches.
 *
 * A whole minute for a 5s poll is deliberate slack, not precision: it means a dropped
 * request, a slow render or a tab hidden for a few seconds still sees the completion on the
 * next poll instead of losing it between two snapshots. Anything older than this is not a
 * notification any more — the page load itself is what tells you about it.
 */
export const FINISHED_WINDOW_MS = 60_000;

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
  /** Recently-terminal runs (see {@link ActiveTasksPayload.finished}). Always a list: `tasks`
   *  alone carries the "not known yet" marker, so this doesn't need a second one. */
  finished: ActiveTask[];
};

function sameRows(a: ActiveTask[], b: ActiveTask[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return a.every((t, i) => {
    const o = b[i];
    return (
      t.id === o.id &&
      t.status === o.status &&
      t.name === o.name &&
      t.project === o.project &&
      t.createdAt === o.createdAt
    );
  });
}

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
  if (!sameRows(a.finished, b.finished)) return false;
  if (a.tasks === b.tasks) return true;
  if (!a.tasks || !b.tasks) return false;
  return sameRows(a.tasks, b.tasks);
}

// ---------------------------------------------------------------------------
// Transitions — what changed between two snapshots. Pure; see `lib/task-toasts.ts` for the
// part that turns these into toasts.
// ---------------------------------------------------------------------------

/** The two statuses where a run has stopped and is waiting on a person. */
export const GATE_STATUSES: ReadonlySet<TaskStatus> = new Set<TaskStatus>([
  "awaiting_proposal",
  "awaiting_report",
]);

/**
 * Terminal statuses worth telling someone about. **`cancelled` is not one of them**: you
 * cancelled it, so a notice saying so tells you something you just did.
 */
export const NOTIFIED_END_STATUSES: ReadonlySet<TaskStatus> = new Set<TaskStatus>([
  "done",
  "failed",
]);

const worthRaising = (status: TaskStatus): boolean =>
  GATE_STATUSES.has(status) || NOTIFIED_END_STATUSES.has(status);

export type TaskTransitions = {
  /** Runs that just *became* worth a notice, with the status they became. */
  entered: ActiveTask[];
  /** Ids whose earlier notice has stopped being true and should be withdrawn. */
  cleared: string[];
};

const NO_TRANSITIONS: TaskTransitions = { entered: [], cleared: [] };

function statusById(state: ActiveTasksState): Map<string, TaskStatus> {
  const map = new Map<string, TaskStatus>();
  for (const t of state.tasks ?? []) map.set(t.id, t.status);
  // Terminal wins: within one snapshot a task is in exactly one of the two lists, but a
  // stale row would otherwise mask the newer state.
  for (const t of state.finished) map.set(t.id, t.status);
  return map;
}

/**
 * What moved between two snapshots, in the terms a notifier cares about.
 *
 * Knows nothing about toasts on purpose — `lib/task-toasts.ts` owns that mapping, so this can
 * be unit-tested without a store, and a second consumer (a title-bar count, a sound) wouldn't
 * have to re-derive it.
 *
 * Three rules earn their place:
 * - **`prev.tasks === null` is a baseline, not an empty list.** Treating "not known yet" as
 *   "nothing was happening" would raise a toast for every gate already pending the moment any
 *   page loads — the first thing you'd see after opening the app is a stack of notices about
 *   states you can already read on screen.
 * - **Only a *gate* notice is ever withdrawn.** "Awaiting your approval" stops being true the
 *   moment the run moves on; "this run failed" never does. Retracting terminal notices would
 *   also quietly reintroduce the timed dismissal `lib/toast.ts` deliberately refuses — they'd
 *   disappear on their own once the run aged out of {@link FINISHED_WINDOW_MS}.
 * - **A same-status row is not a transition.** Every poll re-sends a pending gate; only a
 *   *change* raises, which is what keeps one gate from toasting every five seconds.
 */
export function taskTransitions(
  prev: ActiveTasksState,
  next: ActiveTasksState,
): TaskTransitions {
  if (prev.tasks === null) return NO_TRANSITIONS;

  const before = statusById(prev);
  const after = statusById(next);

  const entered: ActiveTask[] = [];
  for (const t of [...(next.tasks ?? []), ...next.finished]) {
    if (!worthRaising(t.status)) continue;
    if (before.get(t.id) === t.status) continue;
    entered.push(t);
  }
  const raised = new Set(entered.map((t) => t.id));

  const cleared: string[] = [];
  for (const [id, status] of before) {
    if (!GATE_STATUSES.has(status)) continue;
    // Being re-raised in a *new* state — the replacement carries the update, and clearing it
    // first would tear the card out and put a new one back for the same run.
    if (raised.has(id)) continue;
    const now = after.get(id);
    // Gone from both lists is treated as gone: either it finished long enough ago to age out
    // of the window, or it was pushed past `ACTIVE_LIST_LIMIT` by newer runs. Neither leaves
    // "waiting for you" worth showing, and the badge still carries the count.
    if (now !== undefined && GATE_STATUSES.has(now)) continue;
    cleared.push(id);
  }

  return { entered, cleared };
}

/**
 * Every field is rebuilt rather than spread through. `id` and `status` decide whether a row
 * exists at all; `name` and `project` are *coerced*, because React throws outright when it is
 * handed an object as a child and both readers sit in the layout — one malformed row would
 * take down every page rather than one popover.
 */
function parseRows(list: unknown): ActiveTask[] {
  const rows: ActiveTask[] = [];
  if (!Array.isArray(list)) return rows;
  for (const row of list) {
    if (!row || typeof row !== "object") continue;
    const t = row as Record<string, unknown>;
    if (typeof t.id !== "string" || !t.id) continue;
    if (typeof t.status !== "string") continue;
    rows.push({
      id: t.id,
      name: typeof t.name === "string" ? t.name : null,
      project: typeof t.project === "string" ? t.project : null,
      status: t.status as TaskStatus,
      createdAt: typeof t.createdAt === "number" ? t.createdAt : 0,
    });
  }
  return rows;
}

/** Reads a `/api/tasks/active` body without trusting its shape. Always lists, never the
 *  `null` "not known yet" of {@link ActiveTasksState} — a parsed response *is* knowledge. */
export function parseActiveTasks(body: unknown): ActiveTasksPayload {
  const raw = (body ?? {}) as Partial<ActiveTasksPayload>;
  const tasks = parseRows(raw.tasks);

  return {
    tasks,
    finished: parseRows(raw.finished),
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
const UNKNOWN: ActiveTasksState = { tasks: null, total: 0, finished: [] };

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
