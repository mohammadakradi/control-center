---
title: Route FileModal "Create task" through the backlog run endpoint
stack: frontend
assignee: fe
priority: P2
depends_on: []
---

# Route FileModal "Create task" through the backlog run endpoint

## Issue
Dispatching a pm spec from the file modal (`FileModal.createTask`) posts straight to
`/api/tasks`, bypassing the backlog. The item that the `.pm/tasks/` sync created for that
same spec stays `todo` with no `linkedTaskId`, so the backlog never learns the work was
started, is in progress, or finished — only the backlog page's own Run button links.

## Goal
Dispatching a spec from the file modal moves its backlog item through the same lifecycle as
running it from the backlog page: linked to the task, `in_progress` while it runs, `done`
when the task finishes.

## Suggested solution
When the opened file is a pm task spec in the project root (not a workspace member — only
the root `.pm/tasks/` is scanned into the backlog), resolve the backlog item instead of
dispatching directly: `GET /api/projects/[id]/backlog` (the GET also syncs, so the item for
an on-disk spec is guaranteed present and fresh), match by `sourcePath` against the modal's
`path`, then `POST /api/projects/[id]/backlog/[itemId]/run`. Fall back to today's direct
`/api/tasks` dispatch when no item matches (member-repo spec, cap-skipped file). The run
route also brings the already-running 409 guard and title passthrough for free — surface
that 409's message in the modal instead of a generic error.

## Affected areas
- `components/FileModal.tsx` — `createTask()` gains the resolve-by-`sourcePath` + run-route
  path; direct `/api/tasks` dispatch becomes the fallback
- `app/api/projects/[id]/backlog/` (GET) and `…/backlog/[itemId]/run` (POST) — consumed
  as-is, no server changes expected
- Backlog page (`BacklogItemRow`) — no code change, but its status/linked-task display is
  what this fixes; verify the item reflects the run
