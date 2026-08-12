/**
 * Unit tests for the activity badge. No database, and no DOM except the last test, which
 * stubs `document`/`fetch` and mocks timers to exercise the polling loop itself — importing
 * this module must not start a poll, which is part of the contract being checked.
 *
 * The edges pinned here are the ones that would put something wrong in front of a user, or
 * cost them something invisibly: a multi-line request bleeding into a one-line row, the wrong
 * word for a queued task, a re-render on every poll, a malformed response rendering as
 * `undefined`, and the polling loop silently forking in two.
 */
import test, { mock } from "node:test";
import assert from "node:assert/strict";
import {
  ACTIVE_LIST_LIMIT,
  NAME_MAX,
  POLL_MS,
  activeTaskName,
  activityLabel,
  parseActiveTasks,
  sameActiveState,
  subscribeActiveTasks,
  type ActiveTask,
} from "./active-tasks";

const task = (over: Partial<ActiveTask> = {}): ActiveTask => ({
  id: "task_aaaaaaaa",
  name: "Add the activity badge",
  project: "platform",
  status: "running",
  createdAt: 1_700_000_000_000,
  ...over,
});

test("activeTaskName prefers the generated title over the raw request", () => {
  assert.equal(
    activeTaskName({ title: "Add invoice approval", requestText: "Please add…" }),
    "Add invoice approval",
  );
});

test("activeTaskName falls back to the request text, then to null", () => {
  assert.equal(activeTaskName({ title: null, requestText: "Fix the nav" }), "Fix the nav");
  assert.equal(activeTaskName({ title: "   ", requestText: "" }), null);
  assert.equal(activeTaskName({}), null);
});

test("activeTaskName flattens a multi-line request onto one line", () => {
  // The row is styled `truncate`: one line, one ellipsis. Newlines from a markdown request
  // would otherwise arrive inside it.
  assert.equal(
    activeTaskName({ requestText: "  Implement this spec:\n\n---\ntitle: x\n" }),
    "Implement this spec: --- title: x",
  );
});

test("activeTaskName clips a long request and marks the clip", () => {
  const name = activeTaskName({ requestText: "x".repeat(NAME_MAX * 3) })!;
  assert.equal(name.length, NAME_MAX);
  assert.ok(name.endsWith("…"));
});

test("activityLabel pluralises, and says 'in progress' rather than 'running'", () => {
  assert.equal(activityLabel(1), "1 task in progress");
  assert.equal(activityLabel(4), "4 tasks in progress");
  // `ACTIVE_STATUSES` covers queued work and the two approval gates — states where nothing is
  // running and a person is the hold-up — and "In progress" is what the dashboard's stat tile
  // has always called this same set. Reword it back to "running" and this fails.
  for (const n of [1, 4]) assert.ok(!activityLabel(n).includes("running"));
});

test("sameActiveState treats an unchanged poll as unchanged", () => {
  const a = { tasks: [task()], total: 1 };
  const b = { tasks: [task()], total: 1 };
  assert.equal(sameActiveState(a, b), true);
});

test("sameActiveState notices a status change, a new run, and a reorder", () => {
  const base = { tasks: [task()], total: 1 };
  assert.equal(
    sameActiveState(base, { tasks: [task({ status: "awaiting_report" })], total: 1 }),
    false,
  );
  assert.equal(
    sameActiveState(base, { tasks: [task(), task({ id: "task_bbbbbbbb" })], total: 2 }),
    false,
  );
  const two = { tasks: [task(), task({ id: "task_bbbbbbbb" })], total: 2 };
  const swapped = { tasks: [task({ id: "task_bbbbbbbb" }), task()], total: 2 };
  assert.equal(sameActiveState(two, swapped), false);
});

test("sameActiveState keeps 'not known yet' distinct from 'nothing running'", () => {
  // The badge renders nothing for both, but conflating them would let the first poll's
  // result be swallowed when it happens to be empty.
  assert.equal(sameActiveState({ tasks: null, total: 0 }, { tasks: [], total: 0 }), false);
});

test("sameActiveState notices a total that grew past the row limit", () => {
  const rows = Array.from({ length: ACTIVE_LIST_LIMIT }, (_, i) =>
    task({ id: `task_${i}` }),
  );
  assert.equal(
    sameActiveState({ tasks: rows, total: 20 }, { tasks: rows, total: 21 }),
    false,
  );
});

test("parseActiveTasks survives a body that isn't the payload", () => {
  for (const junk of [null, undefined, 42, "nope", {}, { tasks: "no" }]) {
    assert.deepEqual(parseActiveTasks(junk), { tasks: [], total: 0 });
  }
});

test("parseActiveTasks drops rows that couldn't render", () => {
  const parsed = parseActiveTasks({
    total: 3,
    tasks: [task(), null, { id: "task_cccccccc" }, { status: "running" }],
  });
  assert.equal(parsed.tasks.length, 1);
  assert.equal(parsed.tasks[0]!.id, "task_aaaaaaaa");
  assert.equal(parsed.total, 3);
});

test("parseActiveTasks coerces fields React would refuse to render", () => {
  // An object handed to React as a child throws, and this badge is mounted in the layout —
  // one malformed row would take down every page, not just the popover.
  const parsed = parseActiveTasks({
    total: 1,
    tasks: [{ id: "task_ffffffff", status: "running", name: {}, project: [], createdAt: "x" }],
  });
  assert.deepEqual(parsed.tasks, [
    {
      id: "task_ffffffff",
      status: "running",
      name: null,
      project: null,
      createdAt: 0,
    },
  ]);
});

test("parseActiveTasks refuses a total smaller than the rows it was sent", () => {
  // Otherwise the popover would offer to disclose a negative remainder.
  assert.equal(parseActiveTasks({ total: 0, tasks: [task()] }).total, 1);
});

/**
 * The polling loop, with `document` and `fetch` stubbed and timers mocked.
 *
 * This exists for one specific regression. `tick()` used to null the module's timer handle
 * instead of clearing it, so a tab hidden *during* an in-flight poll left a timeout pending
 * that the following catch-up tick then orphaned rather than cancelled — and when the orphan
 * fired it started a second, permanently interleaved tick→schedule chain. The visible symptom
 * was the poll rate quietly doubling for the rest of the session, compounding with every
 * further hide/show. Nothing about the UI looks wrong when that happens, which is exactly why
 * it needs a test rather than an eye.
 */
test("a hide/show cycle mid-poll leaves exactly one polling loop", async () => {
  const realDocument = (globalThis as { document?: unknown }).document;
  const realFetch = globalThis.fetch;

  const listeners = new Set<() => void>();
  const doc = {
    hidden: false,
    addEventListener: (_t: string, fn: () => void) => void listeners.add(fn),
    removeEventListener: (_t: string, fn: () => void) => void listeners.delete(fn),
  };
  const fireVisibility = () => {
    for (const fn of [...listeners]) fn();
  };

  let fetches = 0;
  /** Settles the request currently in flight. A no-op by default so callers needn't guard. */
  let release = () => {};
  (globalThis as { document?: unknown }).document = doc;
  globalThis.fetch = ((_url: unknown, init?: { signal?: AbortSignal }) => {
    fetches++;
    return new Promise((resolve, reject) => {
      release = () =>
        resolve({ ok: true, json: async () => ({ total: 0, tasks: [] }) });
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
    });
  }) as unknown as typeof fetch;

  /** Let the store's awaits progress; `mock.timers.tick` only moves the clock. */
  const flush = async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  };

  mock.timers.enable({ apis: ["setTimeout"] });
  const unsubscribe = subscribeActiveTasks(() => {});
  try {
    await flush();
    assert.equal(fetches, 1, "subscribing polls immediately");

    // Hide the tab while that first request is still in flight — the exact race.
    doc.hidden = true;
    fireVisibility();
    await flush();

    // Nothing is scheduled for a hidden tab, so time passing changes nothing.
    mock.timers.tick(POLL_MS * 3);
    await flush();
    assert.equal(fetches, 1, "a hidden tab is not polled");

    // Back on screen: one catch-up request, immediately.
    doc.hidden = false;
    fireVisibility();
    await flush();
    assert.equal(fetches, 2, "returning to the tab catches up at once");
    release();
    await flush();

    // The invariant: one loop means exactly one request per interval. Two interleaved
    // chains — the bug — produced two.
    for (let i = 0; i < 3; i++) {
      const before: number = fetches;
      mock.timers.tick(POLL_MS);
      await flush();
      assert.equal(
        fetches,
        before + 1,
        `interval ${i + 1} should fire one request, not ${fetches - before}`,
      );
      release();
      await flush();
    }

    // Unsubscribing stops the loop for good — no stray request from an orphaned chain.
    unsubscribe();
    const afterUnsubscribe = fetches;
    mock.timers.tick(POLL_MS * 4);
    await flush();
    assert.equal(fetches, afterUnsubscribe, "the last unsubscribe stops the poll");
  } finally {
    unsubscribe();
    mock.timers.reset();
    globalThis.fetch = realFetch;
    (globalThis as { document?: unknown }).document = realDocument;
  }
});
