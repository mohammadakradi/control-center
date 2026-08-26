/**
 * Where the runner listens.
 *
 * This is a security default, not a preference: the daemon has no authentication of its own —
 * it trusts that the only thing reaching it is the Next.js proxy, which does the auth — and it
 * dispatches agent sessions under the owner's Anthropic token against their files. It shipped
 * bound to every interface, so anything on the same Wi-Fi could drive it. Containers are the one
 * place that needs a wider bind, and they get it explicitly.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  AUTO_COMPACT_WINDOW,
  MIN_LAUNCH_BUDGET_USD,
  remainingTaskBudgetUsd,
  runnerHost,
  taskCap,
} from "./config";

test("the runner binds loopback when nothing says otherwise", () => {
  assert.equal(runnerHost(undefined), "127.0.0.1");
});

test("an empty or blank RUNNER_HOST does not widen the bind", () => {
  assert.equal(runnerHost(""), "127.0.0.1");
  assert.equal(runnerHost("   "), "127.0.0.1");
});

test("a container can ask for every interface explicitly", () => {
  assert.equal(runnerHost("0.0.0.0"), "0.0.0.0");
});


/**
 * Per-task ceilings. These exist because nothing stopped a runaway run: one task on this
 * install reached 1,201 turns and $300 — 11% of two months of spend — and no cap was
 * consulted anywhere. The direction of every fallback below is the point: an unreadable
 * value must never install a *tighter* limit than the operator asked for, and a bad usage
 * row must never buy a run *more* budget than the cap.
 */
test("an unset cap keeps its default; an explicit 0 means no cap", () => {
  assert.equal(taskCap(undefined, 250), 250);
  assert.equal(taskCap("0", 250), 0);
});

test("a blank or unparseable cap reads as off, never as the default", () => {
  // `CC_TASK_MAX_TURNS=` is an operator switching it off, not asking for the default —
  // silently restoring 250 there would re-cap a run someone deliberately uncapped.
  assert.equal(taskCap("", 250), 0);
  assert.equal(taskCap("   ", 250), 0);
  assert.equal(taskCap("banana", 250), 0);
  assert.equal(taskCap("-5", 250), 0);
});

test("a cap is read as a number, whitespace and all", () => {
  assert.equal(taskCap(" 40 ", 250), 40);
  assert.equal(taskCap("12.5", 250), 12.5);
});

test("no configured budget means no maxBudgetUsd is sent at all", () => {
  // null, not 0 — the caller omits the SDK key entirely, because 0 would read as a real
  // limit that every launch has already exceeded.
  assert.equal(remainingTaskBudgetUsd(10, 0), null);
});

test("the budget is what the TASK has left, not a fresh allowance per launch", () => {
  // Each continue spawns a new subprocess whose own counters restart, so a per-launch cap
  // on a task continued six times is six caps. tasks.usage_cost_usd already accumulates.
  assert.equal(remainingTaskBudgetUsd(0, 40), 40);
  assert.equal(remainingTaskBudgetUsd(31.5, 40), 8.5);
});

test("an exhausted task reports a remainder the caller will refuse to launch on", () => {
  const left = remainingTaskBudgetUsd(40, 40);
  assert.equal(left, 0);
  assert.ok(left !== null && left <= MIN_LAUNCH_BUDGET_USD);
  // Overspent (the SDK bills the turn that tripped the cap) goes negative rather than
  // wrapping around to a fresh allowance.
  assert.equal(remainingTaskBudgetUsd(52, 40), -12);
});

test("a broken usage value cannot widen the allowance past the cap", () => {
  assert.equal(remainingTaskBudgetUsd(Number.NaN, 40), 40);
  assert.equal(remainingTaskBudgetUsd(-100, 40), 40);
});

/**
 * Compaction. These models have a 1M context window, so Claude Code's auto-compact
 * effectively never fired — one `compact_boundary` across 207 tasks — and transcripts grew
 * until the task ended, with every call re-sending the whole thing. The override exists to
 * make compaction reachable on long runs; the value is deliberately high because compaction
 * discards detail, so firing it early is a quality risk rather than a free saving.
 */
test("the compaction window is set, and generous enough that ordinary tasks never hit it", () => {
  assert.equal(AUTO_COMPACT_WINDOW, 200_000);
  // Comfortably above the 141k average context this install measured per call, so a normal
  // task is unaffected — only the long runs compact.
  assert.ok(AUTO_COMPACT_WINDOW > 141_000);
});

test("the compaction window can be switched off to restore SDK behavior", () => {
  // Same convention as the run caps: 0 = no override. The caller omits the settings key
  // entirely rather than sending 0, which would compact on every call.
  assert.equal(taskCap("0", 200_000), 0);
});
