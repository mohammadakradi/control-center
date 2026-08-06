---
description: Handle a bug end-to-end — root-cause, plan the fix, build task-by-task with a regression test + security check, independent review, report + test scenario, commit (with user gates).
argument-hint: <describe the bug / symptom>
---

Fix this bug: **$ARGUMENTS**

Follow the **request workflow** in `${CLAUDE_PLUGIN_ROOT}/rules/workflow.md` and the
engineering rules in `${CLAUDE_PLUGIN_ROOT}/rules/engineering-rules.md`, applied to a bug:

1. **Investigate** — read `.swe/notes.md`, reproduce the bug and find the **root cause**
   (not the symptom) in this codebase. Onboard first if there's no `CLAUDE.md`.
2. **Plan & decompose** 🚦 — present the root cause and an ordered fix checklist (starting
   with a failing regression test), flag any security angle, and **stop for the user's
   approval**; revise if asked.
3. **Build task-by-task** — write the failing regression test, make the fix, confirm it
   passes; security self-check the change; then run the full test + lint suite.
4. **Independent review** — dispatch **both** the `reviewer` (correctness + tests) and the
   `security-auditor` (tooled security) subagents. Resolve all blocking findings from either
   and re-review until both are clean.
5. **Report & test scenario** 🚦 — nutshell of what was broken and now works, plus a manual
   test scenario written to `.swe/test-scenarios/<slug>.md` and linked. **Stop for approval.**
6. **Commit** — only after approval, on a feature branch (a hook blocks the default branch).
   Pushing/PR is `/swe:ship`.
