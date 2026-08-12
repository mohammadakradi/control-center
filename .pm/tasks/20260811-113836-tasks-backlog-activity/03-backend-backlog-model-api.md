---
title: Per-project backlog — data model, API, pm-spec sync, run dispatch
stack: backend
assignee: swe
priority: P1
depends_on: []
---

# Per-project backlog — data model, API, pm-spec sync, run dispatch

## Issue
The pm agent plans work into `.pm/tasks/<ts>/` markdown specs inside the project folder, but
the platform has no persistent backlog: the only integration is `components/FileModal.tsx`
opening one spec from a report chip. There is no per-project list of planned work, no
status, and no way for agents or the user to accumulate items over time.

## Goal
Each project has a durable backlog in the database: items carry a status
(todo / in_progress / done / cancelled), the pm agent's `.pm/tasks/` specs land in it
automatically, items can be added/edited/status-changed via API, and an item can be
dispatched as a real task (linked back so completion is visible).

## Suggested solution
- New `backlog_items` table in `lib/db/schema.ts` — projectId (FK, cascade), title,
  description/spec content, assignee (fe/swe), status, `sourcePath` (the `.pm/tasks/` file it
  came from, unique per project, for idempotent sync), `linkedTaskId`, source
  (pm-sync / agent / manual), timestamps. Versioned migration via `pnpm db:generate` +
  `pnpm db:migrate`, committed together (release workflow enforces this). Never `db:push`.
- API routes under `app/api/projects/[id]/backlog/` — list, create, update status/fields,
  and a "run" action that dispatches the item the way `FileModal.createTask` does
  (POST `/api/tasks` with the spec as `requestText`, assignee → fe/swe agent) and stores
  `linkedTaskId`. Backlog is project-scoped and shared (projects are shared by design);
  the dispatched task is still stamped to the current user.
- Idempotent sync: scan the project's `.pm/tasks/` folders (skip `index.md`), parse
  frontmatter (title/assignee/stack — same shape `FileModal.parseFrontmatter` reads), upsert
  by `sourcePath`. Trigger on backlog list/load or project rescan. No pm-agent changes.
- When a linked task reaches `done`, reflect the backlog item as done (on read or on task
  completion); manual status override always wins.

## Affected areas
- `lib/db/schema.ts` + `drizzle/` — new `backlog_items` table + migration
- `app/api/projects/[id]/backlog/` — new routes (list/create/update/run + sync)
- `app/api/tasks/route.ts` POST — reused by the run action (use, don't modify)
- `components/FileModal.tsx` — reference for frontmatter parsing + dispatch shape
- Feature: persistent per-project work queue feeding tasks 04 (agent tool) and 05 (UI)
