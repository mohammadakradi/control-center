---
description: Handle a frontend feature/change end-to-end (new component, page redesign, restyle) — investigate, plan, build task-by-task reusing components & tokens with a11y, independent design + frontend-audit review, report + test scenario, commit (with user gates).
argument-hint: <what to build / redesign / restyle>
---

Handle this frontend request: **$ARGUMENTS**

Follow the **request workflow** in `${CLAUDE_PLUGIN_ROOT}/rules/workflow.md` and the frontend
engineering rules in `${CLAUDE_PLUGIN_ROOT}/rules/frontend-rules.md`.

In short:

1. **Investigate** — read `.fe/notes.md`, `.fe/design-system.md` (tokens + reuse catalog), and
   any active `.fe/epics/` plan this belongs to. Find the components/styles/routes involved
   (use the `ui-explorer` subagent for big UIs). Do a **reuse survey**: which existing
   components/tokens you'll reuse. Onboard first if there's no `CLAUDE.md`.
2. **Plan & decompose** 🚦 — ordered checklist of small steps; state which components/tokens
   you reuse vs. any new ones (and why), plus responsive/a11y notes. **Stop for approval**;
   revise if asked.
3. **Build task-by-task** — implement one step at a time, reusing components and design
   tokens (no hardcoded colors/spacing/type); verify it renders at the relevant breakpoints
   (and dark mode); add tests where supported. Then run the full typecheck/lint/build/test
   gate. Update `.fe/design-system.md` if you added/changed a token or shared component.
4. **Independent review** — dispatch **both** the `design-reviewer` (design fidelity, reuse,
   a11y, responsiveness, UI correctness) and the `frontend-auditor` (security, correctness,
   performance) subagents. Resolve all blocking findings and re-review until both are clean.
5. **Report & test scenario** 🚦 — nutshell of what the user will see change (and what was
   reused vs. added), plus a manual test scenario written to `.fe/test-scenarios/<slug>.md`
   (incl. responsive + dark-mode + a11y checks) and linked. **Stop for approval.**
6. **Commit** — only after approval, on a feature branch (a hook blocks the default branch);
   update the epic if this task belongs to one. Pushing/PR is `/fe:ship`.
