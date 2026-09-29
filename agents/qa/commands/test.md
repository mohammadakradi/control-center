---
description: Run a test scenario against a live site in a real browser, judge every step against its expected result, capture evidence for failures, file bugs, and leave a regression spec behind.
argument-hint: <scenario path or feature> [--url <base>] [--viewport 1440x900] [--headed]
model: claude-sonnet-5
---

Run a QA pass. Target: **$ARGUMENTS**

Follow the rules at `${CLAUDE_PLUGIN_ROOT}/rules/qa-rules.md`. You are testing the app, not
fixing it — **never edit product code in this command.** Files you may write: `.qa/runs/`,
`.qa/bugs/`, `.qa/specs/`, `.qa/artifacts/`.

## Steps

1. **Resolve the scenario.** If `list_test_scenarios` is available — it is when this runs
   under the control-center platform — call it first: it re-scans the project's scenario
   folders and returns everything with its status and feature, so you pick from what is
   actually open rather than guessing at a path. Otherwise resolve from disk, in order: a path
   given in `$ARGUMENTS`; then a matching slug in `.qa/scenarios/`, `.fe/test-scenarios/`,
   `.swe/test-scenarios/`. Scenario files from the `fe` and `swe` agents run as-is.
   - **No scenario found and the argument is a feature description** → say so, then offer the
     two honest options: run `/qa:scenario <feature>` first to write one, or proceed as an
     **exploratory** pass whose verdicts are your judgment rather than a stated contract. Do
     not silently invent a scenario and report against it as if it were given.

2. **Resolve the target.** `--url`, else the scenario's `base_url`, else `baseUrl` from
   `.qa/config.json`. Confirm it responds before opening a browser — `curl -sS -o /dev/null -w
   '%{http_code}' <url>`. A dead target is an environment problem, reported in one line
   (rule 6); do not walk a scenario against a server that isn't up.

3. **Check auth if the scenario needs it.** For `auth: required`, navigate to a known
   authenticated route and confirm you are not bounced to a login page. If you are, the stored
   session has expired: stop and tell the user to run `/qa:auth`. Do not try to log in by
   typing credentials (rule 11).

4. **Map the flow if the app is unfamiliar.** Dispatch `qa:flow-explorer` for routes, control
   labels, **disabled conditions**, test-id convention, and the API calls behind the flow. One
   explorer, in parallel with nothing else that touches the browser (rule 10). Skip this for a
   flow you already mapped this session.

5. **Walk the scenario.** For each step, in order:
   - `browser_snapshot` (or `browser_find` when you know the text) to see the current state.
   - Perform the action against a `ref` from that snapshot — never a guessed selector.
   - Judge the result against the step's **Expected** and record a verdict: PASS / FAIL /
     BLOCKED / SKIPPED, with what you observed in a few words (rule 3).
   - **On FAIL, before anything else touches the page:** screenshot →
     `browser_console_messages` → `browser_network_requests` (rule 4). Then re-run that step
     once to separate a real failure from a flake (rule 5).
   - Keep going after a failure. Only stop early if the failure makes the remaining steps
     genuinely unreachable — then mark them BLOCKED and say why at the top of the report.
   - Run the **Responsive** section at each viewport in the scenario's `viewports` (default:
     the configured viewport plus 390x844) using `browser_resize`.
   - For **Accessibility** steps, drive with `browser_press_key` (Tab / Shift+Tab / Enter /
     Escape) and verify focus moves through the snapshot, not by assumption.

6. **Classify every failure** as product bug / scenario defect / environment problem (rule 6).
   Only product bugs get filed.

7. **File the bugs.** One file per distinct defect in `.qa/bugs/<NN>-<slug>.md`, format at
   `${CLAUDE_PLUGIN_ROOT}/rules/bug-template.md`. Also `add_backlog_item` if available.

8. **Codify what passed.** Write/update `.qa/specs/<slug>.spec.ts` covering the steps that
   passed, asserting on roles and accessible names, loading `storageState.json` for auth
   (rule 12). Steps that failed are not encoded until the bug is fixed.

9. **Record the outcome.** If `complete_test_scenario` is available, call it **once**, with
   the scenario you ran and the counts you observed: `passed` and `failed`. Count a step you
   could not determine as failed — an honest unknown is not a pass (rule 3). The platform
   marks the scenario completed only when `failed` is 0 and at least one step passed, and
   archives its markdown when it does. Never call it for a scenario you did not run, and never
   round a failure down to make a run look clean: a scenario wrongly marked completed is a
   feature nobody will test again.

10. **Report.** Write `.qa/runs/<slug>-<YYYYMMDD-HHMM>.md` using
    `${CLAUDE_PLUGIN_ROOT}/rules/report-template.md`, then give the user the headline in chat:
    the verdict, the counts, the one-line why, the bugs filed, and the report path. Do not
    paste the whole report into chat — it's on disk.

## What a good run refuses to do

- Report a step as verified when it was inferred. If you didn't observe it, it's FAIL —
  "could not determine" (rule 3).
- Fix the bug it just found. Note it, file it, move on; `/swe:fix` and `/fe:fix` exist.
- Screenshot a passing step, or re-snapshot a page nothing has changed on (rule 9).
- Keep retrying a failing step past the one confirming re-run (rule 5).
- Broaden the scenario mid-run. Extra findings go in **Observations** (rule 1).
