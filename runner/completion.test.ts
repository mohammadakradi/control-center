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
