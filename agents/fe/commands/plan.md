---
description: Decompose a large frontend goal (full redesign, design-system migration, dark-mode rollout, a11y cleanup) into a persistent multi-task epic (.fe/epics/<slug>.md) that survives across sessions. Plans only — does not build.
argument-hint: <the larger frontend goal to plan>
---

Plan this larger frontend goal as an epic: **$ARGUMENTS**

Follow `${CLAUDE_PLUGIN_ROOT}/rules/epics.md` and the frontend engineering rules. This command
**plans only — it does not write product code.**

## Steps

1. **Ground yourself.** Read `CLAUDE.md`, `.fe/notes.md`, and `.fe/design-system.md`. If
   there's no `CLAUDE.md`/inventory, run the `onboard` skill first. Investigate enough of the
   UI to plan realistically (use the `ui-explorer` subagent for big projects).
2. **Decompose** the goal into **milestones**, each broken into **small, independently
   shippable tasks** — the kind you'd hand to `/fe:task` or `/fe:fix` one at a time. Sequence
   them; note dependencies, the components/tokens involved, and any design decisions to lock
   in (e.g. "reuse existing palette; no new accent colors").
3. **Write the epic** to `.fe/epics/<slug>.md` using the format in `rules/epics.md` (goal,
   constraints & decisions, milestones with task checklists, empty log).
4. **Present** the epic for approval: the goal, the milestone breakdown, sequencing, design
   decisions, risks, and open questions. **Stop and wait for the user.** Revise if asked.
5. **Publish the tasks to the project backlog — after approval, not before.** If the
   `add_backlog_item` tool is available, file **one item per planned task** (not per
   milestone): its title, a description carrying what an implementer needs (which
   components/tokens/pages, what it depends on, decisions already locked in), and `assignee`
   `fe` (or `swe` where the work isn't frontend). Record each returned item id beside its task
   in the epic, so the plan and the backlog point at each other. An epic that lives only in a
   file is invisible to whoever is choosing what to work on next; the backlog is where work
   gets picked up. Re-running plan on the same goal is safe — filing an item that already
   exists is answered with the existing one rather than duplicated. If the tool isn't
   available (a plain terminal session), say so in your summary instead of silently skipping.

After approval, the user advances the epic by running `/fe:task` / `/fe:fix` task by task;
those commands read the epic, pick up the next task, and check it off when done.
