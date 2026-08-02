---
title: Per-task token usage capture
stack: backend
assignee: swe
priority: P2
depends_on: []
---

# Per-task token usage capture

## Issue
Every SDK `result` message already carries `total_cost_usd`, `usage`, and `modelUsage`
(`sdk.d.ts` `SDKResultSuccess`), and `runner/session-manager.ts` persists it verbatim into
`taskEvents` — but nothing extracts it, so per-task token consumption is invisible to
users and APIs.

## Goal
Each task durably records how many tokens (and what cost) it consumed, queryable via the
tasks API — including tasks continued/resumed multiple times.

## Suggested solution
- Add usage columns to `tasks` in `lib/db/schema.ts` (e.g. input/output/cache-read/
  cache-creation tokens + `costUsd`).
- In the `m.type === "result"` branch of `runner/session-manager.ts` (~L450), pull the
  usage fields off the message and **accumulate** into the task row (a continue/resume
  produces another result message — add, don't overwrite).
- Backfill historical tasks by scanning their persisted `result` events in `taskEvents`
  (precedent: `runner/backfill-titles.ts`).
- Include the usage fields in task API responses (`app/api/tasks/route.ts`,
  `app/api/tasks/[id]/route.ts`) for task 06 to display.

## Affected areas
- `lib/db/schema.ts` — usage/cost columns on `tasks`
- `runner/session-manager.ts` — extract + accumulate on `result` messages
- `runner/backfill-usage.ts` (new, modeled on `runner/backfill-titles.ts`) — history backfill
- `app/api/tasks/route.ts`, `app/api/tasks/[id]/route.ts` — expose usage in reads
- Feature: task history & task detail data — gain token/cost figures
