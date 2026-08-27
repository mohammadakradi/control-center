---
description: Handle a feature/change request end-to-end — investigate, plan, build task-by-task with tests + security, independent review, report + test scenario, commit (with user gates).
argument-hint: <what to build / change>
---

Handle this request: **$ARGUMENTS**

Follow the **request workflow** in `${CLAUDE_PLUGIN_ROOT}/rules/workflow.md` and the
engineering rules in `${CLAUDE_PLUGIN_ROOT}/rules/engineering-rules.md`. **Read each of those
at most once**, at the start — they don't change mid-task, and a re-read is a second full copy
in the transcript that is then re-sent on every later call (rule 18).

In short:

1. **Investigate** — read the `.swe/notes.md` index (then only the `.swe/notes/<topic>.md`
   files this touches) and any active `.swe/epics/` plan this belongs
   to), understand the request in this codebase (use the `explorer` subagent for big repos),
   research unfamiliar APIs only if needed. Onboard first if there's no `CLAUDE.md`.
2. **Plan & decompose** 🚦 — break the work into an ordered checklist of small steps (each
   with its test), flag security-sensitive areas, and present this plan. **Stop for the
   user's approval**; revise if asked.
3. **Build task-by-task** — implement one checklist item at a time; add a test and do a
   security self-check for each; then run the full test + lint suite.
4. **Independent review** — dispatch review **scaled to the diff** (workflow Phase 4): both
   the `reviewer` (correctness + tests) and the `security-auditor` (tooled security) for any
   real or security-sensitive change, `reviewer` alone for a small safe one, neither for a
   no-behavior diff. Resolve all blocking findings and re-review until clean.
5. **Report** 🚦 — give a nutshell of what changed. Add a manual test scenario at
   `.swe/test-scenarios/<slug>.md` **only if there is something to walk through** (rule 14);
   otherwise say in one line why not. **Stop for the user's approval.**
6. **Commit** — only after approval, on a feature branch (a hook blocks the default branch);
   update the epic if this task belongs to one. Pushing/PR is `/swe:ship`.
