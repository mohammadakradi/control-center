---
title: Feature grouping across Backlog, project detail, and Tasks
stack: frontend
assignee: fe
priority: P2
depends_on: [01-backend-feature-entity-schema-sync-api.md, 02-services-feature-branch-merge-runner.md]
---

# Feature grouping across Backlog, project detail, and Tasks

## Issue
Features are invisible in every list: the Backlog pages group only Open vs Done & cancelled,
the Tasks page groups only by project (`app/(app)/tasks/page.tsx`), project detail's task
history is flat, and the shared `components/TaskList.tsx` has no grouping prop. A user
following one feature has to mentally reassemble it from interleaved rows.

## Goal
All three surfaces group work by feature so each feature's development can be followed
independently: its backlog items and tasks sit under a feature heading showing the feature
branch and its merge state, with ungrouped work still readable in a plain section as today.

## Suggested solution
- Group the per-project backlog and the global Backlog page (`app/(app)/backlog/page.tsx`)
  by feature within the existing Open / Done & cancelled split — feature heading with name,
  `feature/<slug>` branch chip, and merge-state summary; items without a feature keep a flat
  "No feature" section.
- Project detail (`app/(app)/projects/[id]/page.tsx` → `TaskHistory`) and the Tasks page
  group tasks by feature (Tasks page: project → feature). Extend `components/TaskList.tsx`
  with an opt-in grouping prop or a thin wrapper rather than forking the row — every task
  list renders through it by design.
- Per-task merge-state chip (merged / conflict / pending, from task 02's state) on grouped
  rows, using the same names task 02 records.
- Feature pickers: assign-on-create in `AddBacklogItem` and `NewTaskForm` (optional select of
  the project's features from task 01's list API).
- Reuse `CardSection`/`Chip` primitives and semantic tokens (`bg-surface`, `text-fg-subtle`,
  …) per `.fe/design-system.md`; no raw palette shades.

## Affected areas
- `app/(app)/backlog/page.tsx`, `app/(app)/tasks/page.tsx`, `app/(app)/projects/[id]/page.tsx`
  — grouped rendering
- `components/TaskList.tsx` / `components/TaskHistory.tsx` — opt-in feature grouping
- `components/BacklogItemRow.tsx` — feature context, merge-state chip
- `components/AddBacklogItem.tsx`, `components/NewTaskForm.tsx` — feature picker
- Consumes the feature list/assign APIs (task 01) and merge state (task 02)
