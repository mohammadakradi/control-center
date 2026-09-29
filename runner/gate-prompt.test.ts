/**
 * Which gate instructions a session gets. The qa agent has nothing to approve — a test run ends
 * in a verdict, not a diff — so it must never be told about proposal/report gates. When it was,
 * it routed "blocked, may I install Playwright?" through the change-report gate, the UI showed
 * Approve/Reject, and Approve was read as permission (reported 2026-09-29).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { GATE_PROMPT, QA_GATE_PROMPT, gatePromptFor } from "./gate-prompt";

test("the qa agent gets the question-only prompt; everyone else the approval workflow", () => {
  assert.equal(gatePromptFor("qa"), QA_GATE_PROMPT);
  for (const ns of ["swe", "fe", "pm", "something-new"]) assert.equal(gatePromptFor(ns), GATE_PROMPT);
});

test("the qa prompt asks questions and never offers an approval gate", () => {
  assert.match(QA_GATE_PROMPT, /gate: "question"/);
  assert.match(QA_GATE_PROMPT, /\[\[GATE:QUESTION\]\]/);
  assert.doesNotMatch(QA_GATE_PROMPT, /gate: "(proposal|report)"/);
  assert.doesNotMatch(QA_GATE_PROMPT, /\[\[GATE:(PROPOSAL|REPORT)\]\]/);
  // The report ends the run; it is not something to wait on.
  assert.match(QA_GATE_PROMPT, /test report is not a gate/i);
});

test("both prompts keep the shared backlog and never-stop-mid-work rules", () => {
  for (const p of [GATE_PROMPT, QA_GATE_PROMPT]) {
    assert.match(p, /add_backlog_item/);
    assert.match(p, /Never end a turn mid-work/);
  }
  assert.match(GATE_PROMPT, /gate: "proposal"/);
  assert.match(GATE_PROMPT, /gate: "report"/);
});
