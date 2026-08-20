/**
 * The watcher that turns snapshot transitions into toasts.
 *
 * `taskTransitions` is tested in `active-tasks.test.ts` and the queue in `toast.test.ts`; what
 * is only testable *here* is the wiring between them — the module-scoped previous snapshot, the
 * ref counting, and the suppression of the task whose page is open. Each of those has a failure
 * mode a user would see directly: every event toasting twice, a toast covering the very gate
 * buttons it is telling you about, or a remount replaying the whole current state as news.
 *
 * The active-tasks store is driven through its real `fetch`/`document` seam rather than mocked,
 * so this exercises the same path the browser takes.
 */
import test, { beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { POLL_MS, type ActiveTasksPayload } from "./active-tasks";
import { getToastsSnapshot, resetToastsForTest } from "./toast";
import {
  resetTaskToastWatcherForTest,
  setSuppressedTask,
  startTaskToastWatcher,
  taskToastKey,
} from "./task-toasts";

const realDocument = (globalThis as { document?: unknown }).document;
const realFetch = globalThis.fetch;

/** What the next poll will answer with. */
let body: ActiveTasksPayload = { total: 0, tasks: [], finished: [] };

const row = (id: string, status: string) => ({
  id,
  name: `Run ${id}`,
  project: "platform",
  status: status as ActiveTasksPayload["tasks"][number]["status"],
  createdAt: 1_700_000_000_000,
});

/** Let the store's awaits settle; `mock.timers.tick` only moves the clock. */
async function flush() {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

/** Answer one poll with `next`, then let the watcher see it. */
async function poll(next: Partial<ActiveTasksPayload>) {
  body = { total: 0, tasks: [], finished: [], ...next };
  mock.timers.tick(POLL_MS);
  await flush();
}

beforeEach(() => {
  resetToastsForTest();
  resetTaskToastWatcherForTest();
  body = { total: 0, tasks: [], finished: [] };
  (globalThis as { document?: unknown }).document = {
    hidden: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  globalThis.fetch = (async () => ({ ok: true, json: async () => body })) as unknown as typeof fetch;
  mock.timers.enable({ apis: ["setTimeout"] });
});

afterEach(() => {
  resetTaskToastWatcherForTest();
  mock.timers.reset();
  globalThis.fetch = realFetch;
  (globalThis as { document?: unknown }).document = realDocument;
});

test("a gate raises one toast, and the next identical poll does not raise a second", async () => {
  const stop = startTaskToastWatcher();
  await flush(); // the immediate first poll — the baseline

  await poll({ total: 1, tasks: [row("task_1", "awaiting_proposal")] });
  assert.equal(getToastsSnapshot().length, 1);
  assert.equal(getToastsSnapshot()[0]!.key, taskToastKey("task_1"));
  assert.equal(getToastsSnapshot()[0]!.taskId, "task_1");
  assert.equal(getToastsSnapshot()[0]!.status, "awaiting_proposal");

  await poll({ total: 1, tasks: [row("task_1", "awaiting_proposal")] });
  assert.equal(getToastsSnapshot().length, 1, "a re-sent gate must not stack");

  stop();
});

test("the run's completion replaces its gate toast instead of adding one", async () => {
  const stop = startTaskToastWatcher();
  await flush();

  await poll({ total: 1, tasks: [row("task_1", "awaiting_report")] });
  await poll({ finished: [row("task_1", "done")] });

  const after = getToastsSnapshot();
  assert.equal(after.length, 1);
  assert.equal(after[0]!.status, "done");

  stop();
});

test("a gate toast retracts itself when the run moves on", async () => {
  const stop = startTaskToastWatcher();
  await flush();

  await poll({ total: 1, tasks: [row("task_1", "awaiting_proposal")] });
  assert.equal(getToastsSnapshot().length, 1);

  // Approved on the task page: the run carries on, so "needs your approval" is stale.
  await poll({ total: 1, tasks: [row("task_1", "building")] });
  assert.deepEqual(getToastsSnapshot(), []);

  stop();
});

test("nothing is raised for the task whose page is open, and its card is retracted", async () => {
  const stop = startTaskToastWatcher();
  await flush();

  // A card is already showing for task_1 when its page is opened.
  await poll({ total: 1, tasks: [row("task_1", "awaiting_proposal")] });
  assert.equal(getToastsSnapshot().length, 1);

  setSuppressedTask("task_1");
  assert.deepEqual(getToastsSnapshot(), [], "arriving on the page deals with the notice");

  // And its later events stay off screen — the page is showing them live.
  await poll({ finished: [row("task_1", "failed")] });
  assert.deepEqual(getToastsSnapshot(), []);

  // Another run is unaffected.
  await poll({ total: 1, tasks: [row("task_2", "awaiting_report")] });
  assert.deepEqual(
    getToastsSnapshot().map((t) => t.taskId),
    ["task_2"],
  );

  setSuppressedTask(null);
  stop();
});

test("a suppressed event is not replayed once you navigate away", async () => {
  const stop = startTaskToastWatcher();
  await flush();
  setSuppressedTask("task_1");

  await poll({ total: 1, tasks: [row("task_1", "awaiting_proposal")] });
  assert.deepEqual(getToastsSnapshot(), []);

  // Leaving the page must not resurrect a notice about something already seen: the gate is
  // still pending, but it is not a *transition* any more.
  setSuppressedTask(null);
  await poll({ total: 1, tasks: [row("task_1", "awaiting_proposal")] });
  assert.deepEqual(getToastsSnapshot(), []);

  stop();
});

test("two watchers install one subscription, so nothing toasts twice", async () => {
  const stopA = startTaskToastWatcher();
  const stopB = startTaskToastWatcher();
  await flush();

  await poll({ total: 1, tasks: [row("task_1", "awaiting_proposal")] });
  // Keyed, so a doubled watcher wouldn't show two cards — but it *would* have replaced the
  // card with a fresh id, so assert on the id being stable across the next poll instead.
  const firstId = getToastsSnapshot()[0]!.id;
  await poll({ total: 1, tasks: [row("task_1", "awaiting_proposal")] });
  assert.equal(getToastsSnapshot()[0]!.id, firstId);

  stopA();
  stopB();
});

test("a remount re-baselines rather than replaying the current state as news", async () => {
  const stop = startTaskToastWatcher();
  await flush();
  await poll({ total: 1, tasks: [row("task_1", "awaiting_proposal")] });
  assert.equal(getToastsSnapshot().length, 1);
  stop();
  resetToastsForTest();

  // Mounting again (a full page load, say) must not toast for the gate that is still pending:
  // the page it lands on already shows it.
  const stopAgain = startTaskToastWatcher();
  await flush();
  assert.deepEqual(getToastsSnapshot(), []);
  await poll({ total: 1, tasks: [row("task_1", "awaiting_proposal")] });
  assert.deepEqual(getToastsSnapshot(), [], "still the same pending gate, not a transition");

  stopAgain();
});
