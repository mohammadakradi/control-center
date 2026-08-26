---
description: Handle a bug end-to-end — root-cause, plan the fix, build task-by-task with a regression test + security check, independent review, report + test scenario, commit (with user gates).
argument-hint: <describe the bug / symptom>
---

Fix this bug: **$ARGUMENTS**

Follow the **request workflow** in `${CLAUDE_PLUGIN_ROOT}/rules/workflow.md` and the
engineering rules in `${CLAUDE_PLUGIN_ROOT}/rules/engineering-rules.md`, applied to a bug.
**Read each of those at most once**, at the start — they don't change mid-task, and a
re-read is a second full copy in the transcript, re-sent on every later call (rule 18).

In short:

1. **Investigate** — read the `.swe/notes.md` index (then only the relevant
   `.swe/notes/<topic>.md` files), reproduce the bug and find the **root cause**
   (not the symptom) in this codebase. Onboard first if there's no `CLAUDE.md`.
2. **Plan & decompose** 🚦 — present the root cause and an ordered fix checklist (starting
   with a failing regression test), flag any security angle, and **stop for the user's
   approval**; revise if asked.
3. **Build task-by-task** — write the failing regression test, make the fix, confirm it
   passes; security self-check the change; then run the full test + lint suite.
4. **Independent review** — dispatch review **scaled to the diff** (workflow Phase 4): both
   the `reviewer` (correctness + tests) and the `security-auditor` (tooled security) for any
   real or security-sensitive fix, `reviewer` alone for a small contained one. Resolve all
   blocking findings and re-review until clean.
5. **Report & test scenario** 🚦 — nutshell of what was broken and now works, plus a manual
   test scenario written to `.swe/test-scenarios/<slug>.md` and linked. **Stop for approval.**
6. **Commit** — only after approval, on a feature branch (a hook blocks the default branch).
   Pushing/PR is `/swe:ship`.
