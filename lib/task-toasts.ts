/**
 * The bridge between the shared active-tasks poll and the toast queue: it subscribes to
 * `lib/active-tasks.ts`, diffs successive snapshots with the pure `taskTransitions`, and
 * raises or retracts toasts.
 *
 * **Why this isn't in the component.** Diffing needs the *previous* snapshot, and
 * `useSyncExternalStore` only ever hands you the current one. Keeping the previous in
 * component state would mean writing it from an effect — `setState` inside `useEffect` is a
 * hard error in this build (`.fe/notes/environment.md`) — and doing the diff during render would be a side
 * effect in render. So the previous snapshot lives here, in module scope, next to the store it
 * mirrors. `Toaster` only mounts this and reads the queue.
 *
 * Ref-counted like `subscribeActiveTasks` itself, so a second mount (or a remount in dev's
 * strict double-invoke) can't install two watchers and toast everything twice.
 */
import {
  getActiveTasksSnapshot,
  subscribeActiveTasks,
  taskTransitions,
  type ActiveTasksState,
} from "./active-tasks";
import { dismissToastByKey, toast } from "./toast";

/** One toast per task, whatever it is about. A run that hits a gate and then finishes gets
 *  its card *updated*; it does not get a second one (see `toast()`'s `key`). */
export const taskToastKey = (taskId: string): string => `task:${taskId}`;

let watchers = 0;
let unsubscribe: (() => void) | null = null;
/** The snapshot the last diff ran against. `null` only before the first subscriber. */
let previous: ActiveTasksState | null = null;
/** The task whose page is open, if any — see {@link setSuppressedTask}. */
let suppressed: string | null = null;

function onStoreChange(): void {
  const next = getActiveTasksSnapshot();
  const prev = previous ?? next;
  previous = next;

  const { entered, cleared } = taskTransitions(prev, next);

  for (const id of cleared) dismissToastByKey(taskToastKey(id));

  for (const task of entered) {
    // The page you are looking at is already telling you this, live and in full. A toast on
    // top of it is noise, and it would cover the gate's own Approve/Reject buttons on a phone.
    if (task.id === suppressed) continue;
    toast({
      key: taskToastKey(task.id),
      taskId: task.id,
      status: task.status,
      title: task.name,
      project: task.project,
    });
  }
}

/**
 * Tell the watcher which task's page is open, so its own events stay off screen.
 *
 * Also retracts anything already showing for that task: arriving on the page *is* dealing with
 * the notice, and leaving a card floating over the run it points at would be the one place a
 * toast is guaranteed useless.
 */
export function setSuppressedTask(taskId: string | null): void {
  suppressed = taskId;
  if (taskId) dismissToastByKey(taskToastKey(taskId));
}

/** Start watching (idempotent). Returns the matching stop. */
export function startTaskToastWatcher(): () => void {
  watchers += 1;
  if (watchers === 1) {
    // `previous` stays null so the first change is a baseline rather than a burst of toasts
    // for gates that were already pending when the app opened.
    previous = null;
    unsubscribe = subscribeActiveTasks(onStoreChange);
  }
  return () => {
    watchers -= 1;
    if (watchers === 0) {
      unsubscribe?.();
      unsubscribe = null;
      previous = null;
    }
  };
}

/** Test-only reset — module state would otherwise leak between specs. */
export function resetTaskToastWatcherForTest(): void {
  unsubscribe?.();
  unsubscribe = null;
  watchers = 0;
  previous = null;
  suppressed = null;
}
