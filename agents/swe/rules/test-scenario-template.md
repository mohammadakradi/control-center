# Test Scenario Template

**Only write one when there is something to walk through** (rule 14). An internal change that
alters nothing the user can observe gets a one-line "no test scenario: nothing to walk through"
in the report instead — a scenario that says "confirm nothing changed" is noise, and it
makes the real ones easier to ignore.

The agent writes a manual test scenario to `.swe/test-scenarios/<short-slug>.md` at the
report gate so the user can follow it to exercise a feature/fix and learn its behavior.
Use this structure. Keep it concrete and copy-pasteable — real commands, real values.

```markdown
# Test scenario: <feature / fix name>

_Task: <one line on what changed> · <date>_

## Setup / preconditions
- <what state the app/repo must be in: env vars, services running, data needed>
- Start the app: `<exact command>`

## Happy path
1. <action — e.g. "Open http://localhost:3000/login">
2. <action — e.g. "Submit valid credentials">
   - **Expected:** <observable result>
3. ...
   - **Expected:** <observable result>

## Edge / failure cases
1. <action that should fail or hit a boundary — e.g. "Submit 5 wrong passwords">
   - **Expected:** <observable result — e.g. "account locked for 15 min, clear message shown">

## What success looks like
<one or two sentences: how the user knows the change works>
```

Guidelines:
- At least one happy-path flow **and** one edge/failure case.
- Each meaningful step states its **expected** observable result.
- Prefer user-facing actions (clicks, requests, CLI invocations) over code-level checks.
- Keep it to what a non-author can follow without reading the diff.
