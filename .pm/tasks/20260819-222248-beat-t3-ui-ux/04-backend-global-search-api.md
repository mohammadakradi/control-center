---
title: Global search API — tasks, projects, agents, backlog
stack: backend
assignee: swe
priority: P2
depends_on: []
---

# Global search API — tasks, projects, agents, backlog

## Issue
Nothing in the app is searchable by text: task lists filter only by project pills, and the
backlog has no search at all. As history grows (this install already has tens of thousands of
task events), finding "that task about the update banner" means scrolling grouped lists.

## Goal
One endpoint that answers a short query with matching tasks, projects, agents, and backlog
items — fast enough to drive an as-you-type command palette (the follow-up frontend task).

## Suggested solution
`GET /api/search?q=…` querying SQLite directly: tasks by `title`/`requestText` **scoped
through `lib/task-access.ts` (`ownedBy`)** — transcripts and task existence are private, so an
unscoped search would be an oracle for other users' tasks; projects/agents/backlog are shared
by design. Bounded result counts per type, short-query guard, `LIKE` with escaped wildcards is
likely enough at this scale (FTS5 only if measured to matter). Return type-tagged results with
the fields the palette renders (id, title, status, project). Cover with a spec next to the code
(`lib/*.test.ts` pattern, throwaway DB via the `PLATFORM_DB` override).

## Affected areas
- new `app/api/search/route.ts` — the endpoint (HTTP translation only)
- new `lib/search.ts` (+ `lib/search.test.ts`) — query logic, following the `lib/backlog.ts` route/lib split
- `lib/task-access.ts` — ownership scoping for the tasks portion
- `lib/db/schema` — read-only consumer (tasks, projects, agents, backlog_items)
