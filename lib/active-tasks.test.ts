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
  taskTransitions,
  type ActiveTask,
  type ActiveTasksState,
} from "./active-tasks";

const task = (over: Partial<ActiveTask> = {}): ActiveTask => ({
  id: "task_aaaaaaaa",
  name: "Add the activity badge",
  project: "platform",
  status: "running",
  createdAt: 1_700_000_000_000,
  ...over,
});

/** A snapshot. `total` defaults to the row count, which is the ordinary case. */
const state = (over: Partial<ActiveTasksState> = {}): ActiveTasksState => ({
  tasks: [],
  finished: [],
  total: over.total ?? (over.tasks ? over.tasks.length : 0),
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
  assert.equal(sameActiveState(state({ tasks: [task()] }), state({ tasks: [task()] })), true);
});

test("sameActiveState notices a status change, a new run, and a reorder", () => {
  const base = state({ tasks: [task()] });
  assert.equal(
    sameActiveState(base, state({ tasks: [task({ status: "awaiting_report" })] })),
    false,
  );
  assert.equal(
    sameActiveState(base, state({ tasks: [task(), task({ id: "task_bbbbbbbb" })] })),
    false,
  );
  const two = state({ tasks: [task(), task({ id: "task_bbbbbbbb" })] });
  const swapped = state({ tasks: [task({ id: "task_bbbbbbbb" }), task()] });
  assert.equal(sameActiveState(two, swapped), false);
});

test("sameActiveState keeps 'not known yet' distinct from 'nothing running'", () => {
  // The badge renders nothing for both, but conflating them would let the first poll's
  // result be swallowed when it happens to be empty.
  assert.equal(sameActiveState(state({ tasks: null }), state({ tasks: [] })), false);
});

test("sameActiveState notices a total that grew past the row limit", () => {
  const rows = Array.from({ length: ACTIVE_LIST_LIMIT }, (_, i) =>
    task({ id: `task_${i}` }),
  );
  assert.equal(
    sameActiveState(state({ tasks: rows, total: 20 }), state({ tasks: rows, total: 21 })),
    false,
  );
});

test("sameActiveState notices a run that only just finished", () => {
  // Without this the whole `finished` list could change with no re-render and no toast: the
  // active rows and the total are identical on both sides of a completion when the run that
  // ended was the only one and `tasks` was already empty.
  const base = state({ tasks: [] });
  const ended = state({ tasks: [], finished: [task({ status: "done" })] });
  assert.equal(sameActiveState(base, ended), false);
  assert.equal(
    sameActiveState(ended, state({ tasks: [], finished: [task({ status: "failed" })] })),
    false,
  );
});

test("parseActiveTasks survives a body that isn't the payload", () => {
  for (const junk of [null, undefined, 42, "nope", {}, { tasks: "no" }, { finished: 7 }]) {
    assert.deepEqual(parseActiveTasks(junk), { tasks: [], finished: [], total: 0 });
  }
});

test("parseActiveTasks validates `finished` exactly like `tasks`", () => {
  const parsed = parseActiveTasks({
    total: 0,
    tasks: [],
    finished: [task({ status: "done" }), null, { id: "x" }, { status: "failed" }],
  });
  assert.equal(parsed.finished.length, 1);
  assert.equal(parsed.finished[0]!.status, "done");
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
 * Transitions — what `Toaster` is driven by.
 *
 * Every case here is one a user would notice going wrong: a stack of notices on page load, a
 * gate that re-announces itself every five seconds, a "waiting for you" card left over a run
 * that has moved on, a completion reported as the wrong outcome, or a failure that quietly
 * withdraws itself after a minute.
 */
test("the first snapshot is a baseline — no toasts for what was already pending", () => {
  const gate = task({ status: "awaiting_proposal" });
  const first = taskTransitions(state({ tasks: null }), state({ tasks: [gate] }));
  assert.deepEqual(first, { entered: [], cleared: [] });

  // Same for a run that finished before the app was opened.
  assert.deepEqual(
    taskTransitions(state({ tasks: null }), state({ finished: [task({ status: "done" })] })),
    { entered: [], cleared: [] },
  );
});

test("entering a gate raises once, and a re-sent gate does not raise again", () => {
  const running = state({ tasks: [task({ status: "building" })] });
  const gated = state({ tasks: [task({ status: "awaiting_report" })] });

  const first = taskTransitions(running, gated);
  assert.deepEqual(
    first.entered.map((t) => t.id),
    ["task_aaaaaaaa"],
  );
  assert.equal(first.entered[0]!.status, "awaiting_report");

  // The poll re-sends the same pending gate every 5s forever. Only a *change* is a transition.
  assert.deepEqual(taskTransitions(gated, gated), { entered: [], cleared: [] });
});

test("moving from one gate to the other raises the new one and does not clear it", () => {
  const proposal = state({ tasks: [task({ status: "awaiting_proposal" })] });
  const report = state({ tasks: [task({ status: "awaiting_report" })] });
  const t = taskTransitions(proposal, report);
  assert.equal(t.entered.length, 1);
  assert.equal(t.entered[0]!.status, "awaiting_report");
  // The replacement carries the update (same toast key). Clearing as well would tear the card
  // out and put a new one back for the same run.
  assert.deepEqual(t.cleared, []);
});

test("done and failed are raised from `finished`, and cancelled is not", () => {
  const running = state({ tasks: [task()] });
  for (const status of ["done", "failed"] as const) {
    const t = taskTransitions(running, state({ finished: [task({ status })] }));
    assert.equal(t.entered.length, 1, `${status} should raise`);
    assert.equal(t.entered[0]!.status, status);
  }
  // You pressed Stop — a notice telling you so is telling you what you just did.
  const cancelled = taskTransitions(running, state({ finished: [task({ status: "cancelled" })] }));
  assert.deepEqual(cancelled.entered, []);
});

test("a gate is cleared when the run moves on, and a cancel clears it too", () => {
  const gated = state({ tasks: [task({ status: "awaiting_proposal" })] });

  // Approved from the task page: the run carries on building.
  assert.deepEqual(taskTransitions(gated, state({ tasks: [task({ status: "building" })] })), {
    entered: [],
    cleared: ["task_aaaaaaaa"],
  });

  // Cancelled at the gate: nothing to raise, but the "needs you" card must go.
  assert.deepEqual(
    taskTransitions(gated, state({ finished: [task({ status: "cancelled" })] })),
    { entered: [], cleared: ["task_aaaaaaaa"] },
  );

  // Vanished from both lists — aged out of the window, or pushed past ACTIVE_LIST_LIMIT by
  // newer runs. Either way "waiting for you" is no longer worth showing.
  assert.deepEqual(taskTransitions(gated, state({})), {
    entered: [],
    cleared: ["task_aaaaaaaa"],
  });
});

test("a gate that finishes is raised, not cleared", () => {
  const gated = state({ tasks: [task({ status: "awaiting_report" })] });
  const t = taskTransitions(gated, state({ finished: [task({ status: "done" })] }));
  assert.equal(t.entered[0]!.status, "done");
  assert.deepEqual(t.cleared, [], "the same-key replacement is the update");
});

test("a terminal notice is never withdrawn", () => {
  // This is what stops the 60s `finished` window from becoming a timed auto-dismiss: a run
  // ages out of the payload, and the card about it stays until someone dismisses it.
  const ended = state({ finished: [task({ status: "failed" })] });
  assert.deepEqual(taskTransitions(ended, state({})), { entered: [], cleared: [] });
  assert.deepEqual(taskTransitions(ended, ended), { entered: [], cleared: [] });
});

test("several runs in one poll each get their own transition", () => {
  const before = state({
    tasks: [task({ id: "task_1", status: "building" }), task({ id: "task_2", status: "running" })],
  });
  const after = state({
    tasks: [task({ id: "task_1", status: "awaiting_report" })],
    finished: [task({ id: "task_2", status: "failed" })],
  });
  const t = taskTransitions(before, after);
  assert.deepEqual(
    t.entered.map((x) => `${x.id}:${x.status}`).sort(),
    ["task_1:awaiting_report", "task_2:failed"],
  );
  assert.deepEqual(t.cleared, []);
});

test("a continued run can finish twice", () => {
  // Continue/resume clears `endedAt` and puts the task back to running, so the same id leaves
  // and re-enters `finished`. The second completion must still be news.
  const done = state({ finished: [task({ status: "done" })] });
  const resumed = state({ tasks: [task({ status: "running" })] });
  assert.deepEqual(taskTransitions(done, resumed), { entered: [], cleared: [] });
  assert.equal(taskTransitions(resumed, done).entered.length, 1);
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
        resolve({ ok: true, json: async () => ({ total: 0, tasks: [], finished: [] }) });
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
