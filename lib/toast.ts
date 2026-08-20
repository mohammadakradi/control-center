/**
 * The app's toast queue — a module-level store read through `useSyncExternalStore`, the same
 * shape as `lib/sidebar.ts` and `lib/active-tasks.ts`.
 *
 * A store rather than React state because the thing that *raises* toasts is not a component:
 * task lifecycle events are detected by diffing successive polls of the shared active-tasks
 * store (`lib/task-toasts.ts`), which happens outside any render. Diffing during render would
 * be a side effect in render, and doing it in an effect would need `setState` in an effect —
 * a hard error in this build (see `.fe/notes.md`). So the watcher calls `toast()` and the
 * component only ever *reads*.
 *
 * Everything here is pure bookkeeping over an array: no timers, no `document`, no `fetch`, so
 * it is unit-tested (`toast.test.ts`) and safe to import anywhere.
 *
 * **Nothing auto-dismisses, and there is deliberately no `duration` option.** Two reasons,
 * and both are the whole point of the feature:
 * - WCAG 2.2.1 (Timing Adjustable) wants content that disappears on a timer to be pausable or
 *   extendable. Sticky-and-dismissible sidesteps that requirement instead of owing it a
 *   hover-pause, a focus-pause and a re-announce.
 * - These are events you may not have been at the screen for. A gate toast that expired after
 *   six seconds while you were in another window is exactly the "the UI doesn't tell you when
 *   a gate needs you" problem this was built to fix.
 *
 * What keeps that from becoming clutter is `key` (a newer toast for the same subject
 * *replaces* the older one) plus `TOAST_LIMIT`, and the watcher *retracting* a gate toast once
 * that task leaves the gate.
 */
import type { TaskStatus } from "./db/schema";

/** How many toasts are on screen at once. Older ones are dropped, oldest first — four stacked
 *  cards is already most of a phone's lower half. */
export const TOAST_LIMIT = 4;

export type Toast = {
  /** Stable identity for React and for {@link dismissToast}. */
  id: string;
  /**
   * Optional subject identity. A `toast()` carrying a `key` that is already on screen
   * *replaces* it in place, so a task reaching `done` supersedes its own gate toast rather
   * than stacking a second card about the same run.
   */
  key?: string;
  /** The task this is about, when there is one — what the card links to. */
  taskId?: string;
  /**
   * Drives the status badge and the card's border tint through `statusTone` (`lib/ui.ts`), so
   * a toast and the task row it refers to can't describe the same run differently.
   */
  status: TaskStatus;
  /** One line, already flattened and clipped by the caller (`activeTaskName`). */
  title: string | null;
  /** Project name, when known. */
  project: string | null;
};

/** What a caller passes; `id` is ours to mint. */
export type ToastInput = Omit<Toast, "id">;

// ---------------------------------------------------------------------------
// The store.
// ---------------------------------------------------------------------------

/** Frozen and shared, so the empty snapshot is a stable reference —
 *  `useSyncExternalStore` compares snapshots by identity and would loop on a fresh `[]`. */
const EMPTY: readonly Toast[] = Object.freeze([]);

let toasts: readonly Toast[] = EMPTY;
let seq = 0;
const listeners = new Set<() => void>();

export function getToastsSnapshot(): readonly Toast[] {
  return toasts;
}

/** Nothing is on screen during SSR: the store is only ever written by a client-side poll,
 *  and inventing a toast here would hydrate into different markup. */
export function getServerToastsSnapshot(): readonly Toast[] {
  return EMPTY;
}

export function subscribeToasts(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

function emit(next: readonly Toast[]) {
  if (next === toasts) return;
  // Collapse "nothing" back onto the shared frozen reference, or an empty stack would be a
  // fresh array every time the last toast is dismissed and re-raised.
  toasts = next.length === 0 ? EMPTY : next;
  // Copied, so a listener that unsubscribes mid-notify can't skip its neighbour.
  for (const listener of [...listeners]) listener();
}

/**
 * Raise a toast. Returns its id so a caller can dismiss it later.
 *
 * A `key` that is already on screen is **replaced in place** — it keeps its position in the
 * stack rather than jumping to the end. A gate toast becoming a "Done" toast is the same
 * subject changing state, and having the card move under the pointer as it does that is how
 * you get a mis-click on the wrong run's Dismiss.
 */
export function toast(input: ToastInput): string {
  const id = `toast_${++seq}`;
  const next: Toast = { ...input, id };

  if (input.key) {
    const at = toasts.findIndex((t) => t.key === input.key);
    if (at !== -1) {
      const replaced = [...toasts];
      replaced[at] = next;
      emit(replaced);
      return id;
    }
  }

  // Newest last. The list renders in array order, so with the stack anchored to the bottom of
  // the viewport that puts the newest card nearest the corner and the oldest at the top — and
  // it means both the cap here and `Toaster`'s scroll clipping give up the *oldest* first.
  const appended = [...toasts, next];
  emit(appended.length > TOAST_LIMIT ? appended.slice(appended.length - TOAST_LIMIT) : appended);
  return id;
}

export function dismissToast(id: string): void {
  const next = toasts.filter((t) => t.id !== id);
  if (next.length !== toasts.length) emit(next);
}

/** Retract whatever is on screen for a subject — used when a toast stops being true (the task
 *  left the gate, or you opened its page), rather than leaving a stale card to be dismissed. */
export function dismissToastByKey(key: string): void {
  const next = toasts.filter((t) => t.key !== key);
  if (next.length !== toasts.length) emit(next);
}

export function dismissAllToasts(): void {
  emit(EMPTY);
}

/** Test-only reset: the store is module state, so specs would otherwise leak into each other. */
export function resetToastsForTest(): void {
  toasts = EMPTY;
  seq = 0;
  listeners.clear();
}
