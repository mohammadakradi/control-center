---
description: Re-run the saved Playwright specs in .qa/specs/ and report what broke. Costs no model tokens per step — this is the cheap regression pass.
argument-hint: [spec name or tag]
model: claude-sonnet-5
---

Run the saved regression specs. Filter: **$ARGUMENTS**

These specs were codified from steps that previously passed (rule 12). Running them is a
`playwright test` invocation, not a browser session you drive — which is the point: it catches
regressions for the price of reading the output.

## Steps

1. **Find the specs** in `.qa/specs/`. If there are none, say so and point at `/qa:test`, which
   is what creates them. Don't improvise specs here.

2. **Check the target is up.** Read `baseUrl` from `.qa/config.json` and confirm it responds.
   A failed run against a dead server is an environment problem, not a regression (rule 6).

3. **Run them:**

   ```bash
   npx playwright test .qa/specs --reporter=line
   ```

   Narrow with `$ARGUMENTS` when given — a spec name, or `--grep <tag>`.

4. **Read the output, don't re-derive it.** The reporter names the failing spec, the assertion,
   and the line. That is your evidence.

5. **For each failure, decide which it is** before reporting:
   - **A real regression** — the app changed and broke something that worked. File a bug
     (`${CLAUDE_PLUGIN_ROOT}/rules/bug-template.md`) and say which run originally verified it.
   - **A stale spec** — the app changed *intentionally* and the assertion is now wrong. Update
     the spec; don't file a bug. Say clearly in the report that you changed a test to match new
     behaviour, since that is exactly the move that hides a real regression when it's wrong.
   - **A flaky spec** — passes on re-run. Report it and either fix the wait or mark it; a spec
     that fails at random will be ignored within a week, taking the real failures with it.

6. **If a failure needs eyes**, open that one flow in the browser and check it the way
   `/qa:test` would. The spec says an assertion failed; only a look tells you what the user
   would see.

7. **Report** pass/fail counts, each failure with its classification, bugs filed, specs updated,
   and how long it took. Keep it short — a green regression pass is one line.
