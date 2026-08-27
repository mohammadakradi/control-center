/**
 * Effort resolution.
 *
 * Claude Code's own default is `xhigh`, so before this existed every run reasoned as hard as
 * the hardest task — `/swe:ship` included. The saving is not in thinking tokens (measured at
 * 4% of output, ~$22 of $2,813) but in behavior: at lower effort the agent makes fewer, more
 * consolidated tool calls, which is a shorter transcript, and transcript re-transmission is
 * 60% of the bill. So the assertions that matter are that routine work drops and that an
 * explicit choice is never quietly overridden.
 *
 * `resolveModel` is not covered here: it needs a live SDK triage call and a task env. Its
 * policy clamping is exercised through `lib/models.test.ts`, which owns the resolution rules.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { resolveEffort } from "./model-router";

test("an explicit effort choice always wins", () => {
  for (const level of ["low", "medium", "high", "xhigh"] as const) {
    const r = resolveEffort("task", level, "very-complex — whatever");
    assert.equal(r.level, level);
    assert.equal(r.reason, "selected by user");
  }
});

test("mechanical commands drop to the cheapest effort", () => {
  // This is most of the win: ship/review/onboard were all running at xhigh.
  for (const command of ["ship", "review", "security", "onboard", "workspace", "audit"]) {
    const r = resolveEffort(command, "auto");
    assert.equal(r.level, "low", `:${command} should be low effort`);
    assert.match(r.reason, /mechanical/);
  }
});

test("auto reuses the tier the model triage already classified", () => {
  // Deliberately no second classifier round-trip — that would cost more than effort saves.
  assert.equal(resolveEffort("task", "auto", "simple — one file").level, "medium");
  assert.equal(resolveEffort("task", "auto", "complex — several components").level, "high");
  assert.equal(resolveEffort("task", "auto", "very-complex — cross-stack").level, "xhigh");
});

test("no tier to reuse falls back to the API's own default, not a guess", () => {
  // Happens when an explicit model choice skipped triage entirely.
  const r = resolveEffort("task", "auto", "selected by user");
  assert.equal(r.level, "high");
  assert.equal(r.reason, "default");
  assert.equal(resolveEffort("task", "auto", undefined).level, "high");
});

test("an unrecognised effort value routes rather than being passed through", () => {
  // "max" is a real SDK level this product does not offer; both it and junk must route.
  assert.equal(resolveEffort("task", "max", "complex — x").reason, "complex request");
  assert.equal(resolveEffort("task", "turbo", "complex — x").level, "high");
});

test("a mechanical command outranks the tier — the floor is the command, not the request", () => {
  // A wordy /swe:ship request must not talk itself into deep reasoning.
  const r = resolveEffort("ship", "auto", "very-complex — sounds hard");
  assert.equal(r.level, "low");
});
