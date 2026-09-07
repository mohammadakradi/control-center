/**
 * Unit tests for turn-end classification — "is this the final report, or did the agent
 * stop mid-work?" (see ./completion).
 *
 *   pnpm test
 *
 * The narration cases marked "from a real transcript" are verbatim text that the old
 * heuristic stapled `[[DONE]]` onto and rendered as the task's report card while marking
 * the task Done — before any work had been done.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { classifyTurnEnd, lastSentence } from "./completion";

const paused = (text: string) => classifyTurnEnd(text);

test("no prose at all is a pause, not a report", () => {
  assert.deepEqual(classifyTurnEnd(""), { kind: "paused", reason: "no-text" });
  assert.deepEqual(classifyTurnEnd("   \n\t "), { kind: "paused", reason: "no-text" });
  // A message that is nothing but markers carries no report either.
  assert.deepEqual(classifyTurnEnd("[[GATE:REPORT]]"), {
    kind: "paused",
    reason: "no-text",
  });
});

test("opening narration is not a report (from a real transcript)", () => {
  assert.deepEqual(
    paused(
      "I'll follow the fe:task workflow — first, investigation. Let me read the workflow " +
        "rules and the frontend project's notes/design-system docs.",
    ),
    { kind: "paused", reason: "narration" },
  );
});

test("a trailing colon introduces the next tool call (from a real transcript)", () => {
  assert.deepEqual(
    paused(
      "The parser caught mid-review text, not the final reports. Let me search the " +
        "transcripts for the actual findings sections:",
    ),
    { kind: "paused", reason: "narration" },
  );
  assert.deepEqual(paused("Checking the remaining call sites:"), {
    kind: "paused",
    reason: "narration",
  });
});

test("first-person announcements of the next step are pauses", () => {
  for (const text of [
    "Let me look at how the runner decides completion.",
    "Now I'll wire the classifier into the session manager.",
    "Okay — I'm going to port the clamp helper first.",
    "Good. Next, let's verify the token vault path.",
    "Time to run the test suite.",
  ]) {
    assert.deepEqual(paused(text), { kind: "paused", reason: "narration" }, text);
  }
});

test("bare gerund lead-ins are pauses only when short and single-line", () => {
  assert.deepEqual(paused("Reading the design-system doc"), {
    kind: "paused",
    reason: "narration",
  });
  // Same lead-in, but a real multi-line summary — not narration.
  const report =
    "Updating three files fixed it.\n\nThe runner now classifies the turn's last " +
    "message before treating it as a report, and the UI is untouched.";
  assert.deepEqual(classifyTurnEnd(report), { kind: "final" });
});

test("waiting on dispatched work gets its own reason", () => {
  for (const text of [
    "I've dispatched the design-reviewer and frontend-auditor subagents; I'll report back once they finish.",
    "Both reviews are running in the background — standing by for their verdicts.",
    "Waiting for the security audit before the report gate.",
  ]) {
    assert.deepEqual(paused(text), { kind: "paused", reason: "waiting" }, text);
  }
});

test("real reports are final", () => {
  const onboardSummary =
    "Onboarding complete. I wrote CLAUDE.md with the stack, the build/run/test commands " +
    "and the design-system pointer, and established a baseline: `pnpm test` passes " +
    "(29 tests), `pnpm lint` is clean, and `pnpm build` fails on a pre-existing Next " +
    "prerender bug unrelated to app code.";
  assert.deepEqual(classifyTurnEnd(onboardSummary), { kind: "final" });

  const changeReport =
    "## What changed\n" +
    "- `runner/completion.ts` — new turn-end classifier.\n" +
    "- `runner/session-manager.ts` — nudges instead of faking a report.\n" +
    "- `runner/completion.test.ts` — 8 cases.\n\n" +
    "Tests pass and typecheck is clean. Nothing else was touched.";
  assert.deepEqual(classifyTurnEnd(changeReport), { kind: "final" });
});

test("a structured report is not demoted by an intention in its last line", () => {
  const report =
    "## What changed\n" +
    "- `runner/completion.ts` — classifies a turn's last message before trusting it as a report.\n" +
    "- `runner/session-manager.ts` — pause → nudge → fail honestly, instead of stapling [[DONE]] onto narration.\n" +
    "- `runner/completion.test.ts` — unit tests for both directions.\n\n" +
    "Verified with `pnpm test` (all green) and `npx tsc --noEmit`.\n\n" +
    "I'll hold off on committing until you've looked it over.";
  assert.deepEqual(classifyTurnEnd(report), { kind: "final" });
});

test("a question to the user is a deliberate stop, not a pause", () => {
  // Nudging here would have the agent answer on the user's behalf.
  assert.deepEqual(
    classifyTurnEnd(
      "Two ways to go:\n- port the clamp helper\n- rewrite it on fabric's own API\n\n" +
        "Which do you want?",
    ),
    { kind: "final" },
  );
  assert.deepEqual(classifyTurnEnd("I'll need the staging URL — can you paste it?"), {
    kind: "final",
  });
});

test("markers are stripped before classifying", () => {
  // Trailing [[DONE]] is handled by the caller; it must not make narration look final.
  assert.deepEqual(paused("Let me start on the canvas editor:\n\n[[DONE]]"), {
    kind: "paused",
    reason: "narration",
  });
});

test("lastSentence reads through lists and multiple sentences", () => {
  assert.equal(lastSentence("First this. Then that."), "Then that.");
  assert.equal(lastSentence("Summary\n\n- one\n- Let me check the last one"), "Let me check the last one");
  assert.equal(lastSentence("single line"), "single line");
  assert.equal(lastSentence(""), "");
});

test("a turn that ends with its reviewers still running is a pause, not a report", () => {
  // The transcript that prompted this: the report said "both review agents are still running"
  // and was accepted as final, so the task was sealed Done while its subagents kept writing to
  // the transcript. None of these mention waiting, which is why WAITING_RE let them through.
  for (const text of [
    "Implementation and verification are complete; both review agents are still running.",
    "The reviewers haven't reported back yet.",
    "Both subagents are still in flight.",
    "The security audit is still in progress.",
    "Dispatched the reviewer and the security auditor; the audit hasn't returned.",
    "My two sub-agents are still working through the diff.",
  ]) {
    assert.deepEqual(classifyTurnEnd(text), { kind: "paused", reason: "waiting" }, text);
  }
});

test("a tool-call preamble never seals the task (from a real transcript)", () => {
  // task_2ad6afb5, sealed `done` at 2026-09-03T09:31:24Z on exactly this text — which then
  // became the task's report — while the session kept running. It names no dispatched work
  // (so IN_FLIGHT_RE can't see it) and reads as a statement of fact up to its last sentence.
  assert.deepEqual(
    classifyTurnEnd("Smoking gun found. Let me confirm the reconciler's status coverage."),
    { kind: "paused", reason: "narration" },
  );
  // The same sign-off under a long, bulleted analysis: `looksStructured` used to wave the
  // whole message through as a report on the strength of its formatting alone.
  const analysis =
    "The reconciler's coverage is narrower than it looks:\n" +
    "- `queued` and `running` are reclassified on every sweep.\n" +
    "- `cancelled` is never visited, so the row keeps its old status forever.\n" +
    "- the sweep runs before the status write lands, which widens the window.\n\n" +
    "Let me confirm the reconciler's status coverage.";
  assert.deepEqual(classifyTurnEnd(analysis), { kind: "paused", reason: "narration" });
});

test("prose that reports nothing is a pause, not a report", () => {
  // The other half of the same bug: sealing needs positive evidence, so a short declarative
  // that announces no next step (and therefore trips none of the narration patterns) is
  // still not a report.
  for (const text of [
    "Smoking gun found.",
    "Found it — the sweep never sees cancelled rows.",
    "The reconciler only covers three of the five statuses.",
    "That matches what the transcript showed.",
  ]) {
    assert.deepEqual(classifyTurnEnd(text), { kind: "paused", reason: "unfinished" }, text);
  }
});

test("a report that ends by deferring to the user is still final", () => {
  // "let me know" / "I'll wait" close reports; they must not read as a next action.
  assert.deepEqual(
    classifyTurnEnd(
      "Fixed the off-by-one in `parseRange` and added a regression test; the full suite " +
        "passes. Let me know if you'd rather I split the commit.",
    ),
    { kind: "final" },
  );
  // "I'll wait for your approval" is a different case: WAITING_RE matches it, so it pauses
  // and the agent is nudged to raise the gate properly. That is pre-existing and deliberate
  // — a report that never called request_approval is off-contract, and a nudge is cheaper
  // than a task the user can't act on. Pinned so the distinction stays visible.
  assert.deepEqual(
    classifyTurnEnd(
      "The migration is written and applied locally, and all 692 tests pass. I'll wait " +
        "for your approval before committing.",
    ),
    { kind: "paused", reason: "waiting" },
  );
});

test("a long message with no completion vocabulary is still allowed to be a report", () => {
  // The safety valve: prose this long is not a tool-call preamble, whatever register it is
  // written in. Kept so an unusual but genuine report isn't nudged into a loop.
  const longform = `${"The runner reads a turn's closing message and has to decide, with no help from the SDK, whether the run is over. ".repeat(5)}`;
  assert.ok(longform.length >= 500);
  assert.deepEqual(classifyTurnEnd(longform), { kind: "final" });
});

test("a finished report is not demoted by mentioning reviews or things still running", () => {
  // The other half, and the reason IN_FLIGHT_RE is narrow: nudging a *finished* report puts the
  // run in a loop. Note the first two already match the older, looser WAITING_RE — which is
  // exactly why that pattern must never be consulted anywhere the answer seals a task.
  for (const text of [
    "The review found two blocking issues; both are now fixed and re-reviewed clean.",
    "I ran the reviewer and the security auditor. Both came back clean, and I committed.",
    "Tests are still running in CI, but the change is complete and verified locally.",
    "Reviewed everything: no outstanding issues. Committed on feat/x with 650 tests passing.",
  ]) {
    assert.deepEqual(classifyTurnEnd(text), { kind: "final" }, text);
  }
});
