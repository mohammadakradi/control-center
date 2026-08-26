---
description: Decompose a large goal into a persistent multi-task epic (.swe/epics/<slug>.md) that survives across tasks and sessions. Plans only — does not build.
argument-hint: <the larger goal / feature to plan>
---

Plan this larger goal as an epic: **$ARGUMENTS**

Follow `${CLAUDE_PLUGIN_ROOT}/rules/epics.md` and the engineering rules. This command
**plans only — it does not write product code.**

## Steps

1. **Ground yourself.** `CLAUDE.md` is already in your context — don't read it. Read the
   `.swe/notes.md` index and only the topic files this goal touches. If there's no
   `CLAUDE.md`, run the `onboard` skill first. Investigate enough of the codebase to plan
   realistically (use the `explorer` subagent for big repos).
2. **Decompose** the goal into **milestones**, each broken into **small, independently
   shippable tasks** — the kind you'd hand to `/swe:task` or `/swe:fix` one at a time.
   Sequence them; note dependencies and any security-sensitive milestones.
3. **Write the epic** to `.swe/epics/<slug>.md` using the format in `rules/epics.md` (goal,
   constraints & decisions, milestones with task checklists, empty log).
4. **Present** the epic for approval: the goal, the milestone breakdown, sequencing, risks,
   and open questions. **Stop and wait for the user.** Revise if they want changes.
5. **Publish the tasks to the project backlog — after approval, not before.** If the
   `add_backlog_item` tool is available, file **one item per planned task** (not per
   milestone): its title, a description carrying what an implementer needs (what changes,
   where, what it depends on), and `assignee` `swe` or `fe` as appropriate. Record each
   returned item id beside its task in the epic, so the plan and the backlog point at each
   other. An epic that lives only in a file is invisible to whoever is choosing what to work
   on next; the backlog is where work gets picked up. Re-running plan on the same goal is
   safe — filing an item that already exists is answered with the existing one rather than
   duplicated. If the tool isn't available (a plain terminal session), say so in your summary
   instead of silently skipping it.

After approval, the user advances the epic by running `/swe:task` / `/swe:fix` task by task;
those commands read the epic, pick up the next task, and check it off when done.
