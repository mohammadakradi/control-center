---
title: Feature entity — schema, backlog sync, and API
stack: backend
assignee: swe
priority: P1
depends_on: []
---

# Feature entity — schema, backlog sync, and API

## Issue
Work in a project is organized around features, but the platform has no feature concept:
`tasks` and `backlog_items` group only by project. The natural grouping key for pm-planned
work — the `.pm/tasks/<request>/` folder name — is embedded inside `backlog_items.sourcePath`
and never parsed out or surfaced, and manual backlog items and manual tasks can't be grouped
at all.

## Goal
A durable `feature` entity that backlog items and tasks link to: auto-derived for pm-planned
specs (one feature per request folder, zero extra steps), creatable and assignable by hand,
and carried through dispatch so every run knows which feature it belongs to.

## Suggested solution
- New `features` table (id, projectId, name, branch, status, createdAt) plus nullable
  `featureId` FKs on `tasks` and `backlog_items`. Versioned migration via `pnpm db:generate`
  + `pnpm db:migrate` (never `db:push`); commit the SQL with the schema change.
- In the backlog sync (`scanPmSpecs` / `syncProjectBacklog`), derive one feature per
  `.pm/tasks/<request>/` folder — `dir.name` is already in scope where `sourcePath` is built —
  and link that folder's items to it, idempotently (same spirit as the `(projectId,
  sourcePath)` unique key).
- API: create a feature, list a project's features, assign/unassign a backlog item or task to
  one. Follow the `lib/backlog.ts` split: logic in a `lib/` module, routes translate HTTP only.
- Carry `featureId` on `DispatchInput` (`lib/dispatch.ts`) and store it on the task row: the
  backlog run route sets it from the item; `POST /api/tasks` accepts it for manual dispatch.
  Clients may not forge cross-project links — validate the feature belongs to the project,
  like the existing `sourcePath`/`linkedTaskId` stance.
- `features.branch` is the reserved branch name (`feature/<slug>`, sanitized like
  `taskBranch`); the runner task (02) owns creating/merging the real git branch.

## Affected areas
- `lib/db/schema.ts` + a new `drizzle/` migration — `features` table, `tasks.featureId`,
  `backlog_items.featureId`
- `lib/backlog.ts` — `scanPmSpecs`/`syncProjectBacklog` derive + link features; `listBacklog`
  returns the feature grouping data
- `lib/dispatch.ts` (`DispatchInput`), `app/api/tasks/route.ts`,
  `app/api/projects/[id]/backlog/[itemId]/run/route.ts` — carry `featureId` into the task row
- New feature routes under `app/api/projects/[id]/` + a `lib/` module owning the logic
- Feeds task 02 (branch lifecycle) and task 04 (grouped UI)
