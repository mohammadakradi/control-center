---
description: Fix a frontend bug end-to-end (visual/layout/state/interaction) — root-cause, plan, build task-by-task with a regression check + a11y, independent design + frontend-audit review, report + test scenario, commit (with user gates).
argument-hint: <describe the UI bug / symptom>
---

Fix this frontend bug: **$ARGUMENTS**

Follow the **request workflow** in `${CLAUDE_PLUGIN_ROOT}/rules/workflow.md` and the frontend
engineering rules in `${CLAUDE_PLUGIN_ROOT}/rules/frontend-rules.md`, applied to a bug.
**Read each of those at most once**, at the start — they don't change mid-task, and a
re-read is a second full copy in the transcript, re-sent on every later call (rule 18).

In short:

1. **Investigate** — read `.fe/design-system.md` and the `.fe/notes.md` index (then only the
   relevant `.fe/notes/<topic>.md` files), reproduce the bug
   (which view, which breakpoint, light/dark) and find the **root cause** (not the symptom):
   a layout/overflow issue, a wrong token, a state/effect bug, a re-render, a missing a11y
   attribute. Onboard first if there's no `CLAUDE.md`.
2. **Plan & decompose** 🚦 — present the root cause and an ordered fix checklist (starting
   with a reproducing test/check where possible), flag any design/a11y angle, and **stop for
   approval**; revise if asked.
3. **Build task-by-task** — make the fix using tokens/existing components; confirm the bug is
   gone at the affected breakpoints (and dark mode); add a regression test where supported;
   then run the full typecheck/lint/build/test gate.
4. **Independent review** — dispatch review **scaled to the diff** (workflow Phase 4): both
   the `design-reviewer` and the `frontend-auditor` for any real or untrusted-content change,
   `design-reviewer` alone for a small contained visual fix. Resolve all blocking findings and
   re-review until clean.
5. **Report** 🚦 — nutshell of what was broken and now works. A test scenario at
   `.fe/test-scenarios/<slug>.md` only if there is something to look at (rule 14); otherwise
   say so in one line. **Stop for approval.**
6. **Commit** — only after approval, on a feature branch (a hook blocks the default branch).
   Pushing/PR is `/fe:ship`.
