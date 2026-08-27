# Test Scenario Template (frontend)

**Only write one when there is something to look at** (rule 14). An internal change that
alters nothing the user can observe gets a one-line "no test scenario: nothing to look at"
in the report instead — a scenario that says "confirm nothing changed" is noise, and it
makes the real ones easier to ignore.

The agent writes a manual test scenario to `.fe/test-scenarios/<short-slug>.md` at the report
gate so the user can follow it to exercise a UI change and confirm it looks and behaves right.
Use this structure. Keep it concrete and clickable — real routes, real values, real
breakpoints. Frontend scenarios must cover **visual, responsive, and accessibility** checks,
not just "it loads".

```markdown
# Test scenario: <feature / fix name>

_Task: <one line on what changed> · <date>_

## Setup / preconditions
- <state the app must be in: env, data, logged-in user, feature flag>
- Start the app: `<exact command>` → open <http://localhost:PORT/route>

## Happy path
1. <action — e.g. "Open /dashboard">
   - **Expected:** <observable visual result — what should appear, where, in which color/style>
2. <action — e.g. "Click the primary 'Save' button">
   - **Expected:** <observable result>
3. ...

## Responsive
1. Resize to mobile width (<~375px) / use device toolbar.
   - **Expected:** <layout reflows correctly — nav collapses, no overflow/clipping, tap targets adequate>
2. Resize to desktop (≥1280px).
   - **Expected:** <intended desktop layout>

## Dark mode (if the project supports it)
1. Toggle dark mode (<how: theme switch / OS setting>).
   - **Expected:** <colors use dark tokens; sufficient contrast; no hardcoded light values leak>

## Accessibility
1. Navigate the change with the **keyboard only** (Tab / Shift+Tab / Enter / Esc).
   - **Expected:** <every control reachable in logical order, visible focus ring, actions fire>
2. <contrast / screen-reader / label check as relevant>
   - **Expected:** <labels announced; contrast meets AA; no color-only signaling>

## Edge / failure cases
1. <action that should hit a boundary — e.g. "Load with a very long title / empty list / error state">
   - **Expected:** <graceful result — truncation/wrap, empty state, error UI; no layout break>

## What success looks like
<one or two sentences: how the user knows the change works, looks consistent with the design
system, and is accessible.>
```

Guidelines:
- Always include the **responsive** and **accessibility** sections; include **dark mode** when
  the project has it.
- Each meaningful step states its **expected** observable result (visual where possible).
- Prefer user-facing actions (clicks, keyboard, resizing) over code-level checks.
- Keep it to what a non-author can follow without reading the diff.
