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

After approval, the user advances the epic by running `/fe:task` / `/fe:fix` task by task;
those commands read the epic, pick up the next task, and check it off when done.
