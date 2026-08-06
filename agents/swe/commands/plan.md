---
description: Decompose a large goal into a persistent multi-task epic (.swe/epics/<slug>.md) that survives across tasks and sessions. Plans only — does not build.
argument-hint: <the larger goal / feature to plan>
---

Plan this larger goal as an epic: **$ARGUMENTS**

Follow `${CLAUDE_PLUGIN_ROOT}/rules/epics.md` and the engineering rules. This command
**plans only — it does not write product code.**

## Steps

1. **Ground yourself.** Read this project's `CLAUDE.md` and `.swe/notes.md`. If there's no
   `CLAUDE.md`, run the `onboard` skill first. Investigate enough of the codebase to plan
   realistically (use the `explorer` subagent for big repos).
2. **Decompose** the goal into **milestones**, each broken into **small, independently
   shippable tasks** — the kind you'd hand to `/swe:task` or `/swe:fix` one at a time.
   Sequence them; note dependencies and any security-sensitive milestones.
3. **Write the epic** to `.swe/epics/<slug>.md` using the format in `rules/epics.md` (goal,
   constraints & decisions, milestones with task checklists, empty log).
4. **Present** the epic for approval: the goal, the milestone breakdown, sequencing, risks,
   and open questions. **Stop and wait for the user.** Revise if they want changes.

After approval, the user advances the epic by running `/swe:task` / `/swe:fix` task by task;
those commands read the epic, pick up the next task, and check it off when done.
