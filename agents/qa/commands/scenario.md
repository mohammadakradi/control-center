---
description: Write a runnable test scenario for a feature — by reading the code and, where useful, exploring the live page — and save it to .qa/scenarios/ ready for /qa:test.
argument-hint: <feature or flow to cover>
model: claude-sonnet-5
---

Author a test scenario for: **$ARGUMENTS**

Follow `${CLAUDE_PLUGIN_ROOT}/rules/qa-rules.md` and the format at
`${CLAUDE_PLUGIN_ROOT}/rules/scenario-template.md`. This command writes a scenario; it does not
run one.

## Steps

1. **Check what already exists.** Look in `.qa/scenarios/`, `.fe/test-scenarios/`,
   `.swe/test-scenarios/`. If the `fe` or `swe` agent already wrote one for this feature, say
   so and offer to extend it rather than writing a competing second file.

2. **Map the flow.** Dispatch `qa:flow-explorer` for the routes, the exact control labels, the
   **disabled conditions**, the validation rules, the states (loading/empty/error), and the API
   calls behind the flow. This is what makes the difference between a scenario that runs and
   one that guesses at element names.

3. **Look at the real page when the flow is interactive.** Navigate and snapshot the entry
   point, so the accessible names in your steps are the ones the browser will actually report.
   Cheap, and it removes the most common cause of a scenario failing on its first run.

4. **Write the scenario** to `.qa/scenarios/<slug>.md`:
   - Front matter: `feature`, `base_url`, `auth`, `viewports`, `tags`.
   - **Happy path** — the flow working, one action per step.
   - **Responsive** — at least mobile (~390px) and desktop (≥1280px).
   - **Accessibility** — keyboard-only traversal, visible focus, labelled controls.
   - **Edge / failure cases** — the boundaries the code actually has: the validation rules and
     disabled conditions the explorer found, the empty state, the error state. Derive these
     from the code, not from a generic checklist; a scenario that tests boundaries the app
     doesn't have is noise.
   - Every step gets an **Expected** that is observable in the page (rule 3).
   - Secrets as `<secret>NAME</secret>`, never literal values (rule 11).

5. **Name the preconditions honestly.** If the scenario needs a seed record, a feature flag, or
   a specific account, say so in Setup with the command or steps that create it. A scenario
   whose preconditions are implicit fails on someone else's machine and looks like a bug.

6. **Report** the path, the step count, what you deliberately left out and why, and the exact
   command to run it: `/qa:test .qa/scenarios/<slug>.md`.
