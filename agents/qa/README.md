# qa — portable QA-engineer agent

A Claude Code plugin that turns Claude into a **QA engineer**: it opens a real browser, walks a
written test scenario step by step, judges each step against its stated expected result,
captures evidence when something fails, files the bugs as tasks your `swe`/`fe` agents can pick
up, and leaves a Playwright spec behind so the same scenario re-runs for free.

It is the testing sibling of the `fe` and `swe` agents — and it reads their output directly:
the test scenarios `/fe:task` and `/swe:task` already write to `.fe/test-scenarios/` and
`.swe/test-scenarios/` run as-is, with no conversion step.

## What makes it a *QA* engineer

- **It tests, it does not fix.** `/qa:test` never edits product code. A failure becomes
  evidence and a filed bug, not a patch — so the verdict stays trustworthy.
- **Every step is judged against a stated Expected.** PASS / FAIL / BLOCKED / SKIPPED, with
  what was actually observed. There is no "looks fine"; an honest "could not determine" is a
  FAIL, because a false pass is worse than no test.
- **It tells three kinds of wrong apart.** A product bug, a stale scenario, and a dead
  environment produce three different outcomes. Only product bugs get filed.
- **Failures come with evidence, passes cost nothing.** Screenshot + console errors + network
  failures are captured the moment a step fails, before the next action destroys the state —
  and never for a step that passed.
- **A failure is confirmed once before it is called a bug.** Fails twice → real. Passes on
  retry → reported as FLAKY, which is a finding, not a pass.
- **Production is read-only by default.** Declare `productionOrigins` and a hook holds the
  first mutating action on those origins, with instructions. Read-only tools are never held.
- **What passed becomes a regression spec**, asserting on roles and accessible names, so it
  survives restyling.

## Commands

- **`/qa:onboard [base url]`** — install browser tooling, write `.qa/config.json`, set the base
  URL and production origins, verify the browser reaches the app. Safe to re-run.
- **`/qa:auth <login url>`** — open a real browser, let you log in by hand, save the session to
  `.qa/auth/storageState.json`. Your credentials never enter the agent's context.
- **`/qa:scenario <feature>`** — read the code (and the live page) and write a runnable scenario
  to `.qa/scenarios/<slug>.md`.
- **`/qa:test <scenario|feature>`** — the main event. Walk the scenario in a browser, verdict
  per step, evidence on failure, bugs filed, spec written, report on disk.
- **`/qa:regress [name|tag]`** — re-run the saved specs. No model tokens per step; the cheap
  regression pass.

## Typical loop

```
/qa:onboard http://localhost:3000     # once per project
/qa:auth http://localhost:3000/login  # once per session lifetime

/fe:task add a checkout flow          # your existing agent writes .fe/test-scenarios/checkout.md
/qa:test .fe/test-scenarios/checkout.md

# -> .qa/runs/checkout-20260929-1610.md   the verdict, per step, with evidence
# -> .qa/bugs/01-pay-button-disabled.md   ready for /swe:fix
# -> .qa/specs/checkout.spec.ts           re-runs free from now on

/swe:fix .qa/bugs/01-pay-button-disabled.md
/qa:regress                           # cheap, catches the next regression
```

## Browser

Driven through **Playwright MCP** (pinned in `scripts/qa-mcp.sh`), which gives the agent the
page as an **accessibility tree** rather than pixels. That matters twice over: it is far
cheaper per step than screenshots, and it makes the agent assert on the same roles and labels a
screen reader would — so the tests are accessibility-aware by construction.

The server is launched by `scripts/qa-mcp.sh`, which creates the auth files on first run (so a
fresh clone doesn't start with a dead MCP server) and reads per-project settings from
`.qa/config.json` — headless, viewport, browser channel, test-id attribute, timeouts, blocked
origins.

## Files the agent maintains in your project

| Path | What it holds | Commit it? |
|---|---|---|
| `.qa/config.json` | base URL, viewport, production origins, timeouts | yes |
| `.qa/scenarios/` | scenarios this agent authored | yes |
| `.qa/specs/` | generated Playwright regression specs | yes |
| `.qa/bugs/` | filed defects, in `pm`-task format | yes |
| `.qa/runs/` | run reports | no — noise |
| `.qa/artifacts/` | failure screenshots, sessions | no — noise |
| `.qa/auth/` | **live session + secrets** | **never — credential leak** |

`/qa:onboard` writes the `.gitignore` entries for the bottom three.

## Model choice

Commands run on **Sonnet 5**: a QA pass is mostly structured observation, and the run is
dominated by page-reading cost rather than reasoning depth. The `flow-explorer` subagent is
Sonnet 5 too. Change the `model:` line in a command's frontmatter to raise it for a flow where
judging "is this actually broken?" is the hard part.

## Install

```bash
claude plugin marketplace add /Users/moh/Dev/agent/qa-agent
claude plugin install qa@qa-agent-local
```

Then `/qa:onboard` in the project you want to test.

## Rules

The operating rules are in `rules/qa-rules.md` — 13 of them, covering scenario fidelity,
snapshot discipline, verdicts, evidence, flake confirmation, bug-vs-scenario-vs-environment,
production safety, budget, and what the agent refuses to do. The templates it writes to are
`rules/scenario-template.md`, `rules/report-template.md`, and `rules/bug-template.md`.
