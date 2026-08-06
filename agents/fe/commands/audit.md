---
description: Scan the whole project for design inconsistency — theme/color drift, hardcoded values, duplicated components, typography/spacing drift, and accessibility gaps — measured against .fe/design-system.md. Read-only; produces a prioritized fix checklist.
argument-hint: [optional scope, e.g. a directory or "colors only"]
model: claude-sonnet-5
---

Audit this project for design & frontend consistency. Optional scope: **$ARGUMENTS**

Follow the procedure in `${CLAUDE_PLUGIN_ROOT}/rules/audit-procedure.md` and the frontend
engineering rules. This command is **read-only** — report findings, do not modify code.

## Steps

1. **Ground yourself.** Read `.fe/design-system.md` (the source of truth for tokens &
   reusable components) and `CLAUDE.md`. If the inventory is missing, run the `onboard` skill
   first — there's nothing to measure consistency against otherwise.
2. **Scan** for the categories in the audit procedure: color/theme drift (hardcoded hex/rgb,
   off-palette values, dark-mode gaps), spacing/typography drift, duplicated components &
   styles, accessibility gaps, and inconsistent patterns. Run the project's lint / a11y lint /
   stylelint where present; grep for hardcoded-value and duplication patterns; read
   representative offenders to confirm. For a large UI, use the `ui-explorer` subagent.
3. **Report** a prioritized checklist (P1/P2/P3) grouped by category, each item with
   `file:line`, the issue, the token/component it should use, and a fix sketch. Note tools
   run and coverage gaps (e.g. visual contrast you couldn't verify automatically).
4. **Tell the user how to act** — fix individual items with `/fe:task "<item>"`, or `/fe:plan`
   an epic if the cleanup is large. Optionally append the confirmed items to the "Known
   inconsistencies / debt" section of `.fe/design-system.md` so they're tracked.

Do not change product code in this command — fixes go through the gated `/fe:task` workflow.
