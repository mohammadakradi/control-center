---
title: Extend usage data layer for date-range + per-project aggregation
stack: backend
assignee: swe
priority: P2
depends_on: []
---

# Extend usage data layer for date-range + per-project aggregation

## Issue
`spendForUser()` in `lib/usage-summary.ts` returns one flat, all-time total scoped only to
`userId`: no way to filter by time window beyond a single hardcoded `last30DaysCostUsd`, and
no project information at all, even though every task row already carries a required
`projectId` (`lib/db/schema.ts:120-122`). The Usage page and its API route have nothing to
call for "last 7 days", "last 30 days", "total", or "spend per project".

## Goal
`spendForUser` (and `/api/usage`) can return spend/token totals scoped to a caller-chosen
date range (7 days / 30 days / all time), and each returned task and the summary as a whole
carry project identity — including a per-project breakdown of spend within the selected range.

## Suggested solution
Add a `range` parameter (`"7d" | "30d" | "all"`) to `spendForUser`, applied consistently to
every aggregate query it runs (replacing the single hardcoded 30-day window). Join `tasks` to
`projects` so `TaskSpend` carries `projectId`/`projectName`, and add a new grouped query
(`GROUP BY tasks.project_id`) returning per-project cost/token totals for the selected range,
sorted by spend descending. Update `GET /api/usage` (`app/api/usage/route.ts`) to accept a
`range` query param and pass it through. Keep the existing `unattributed` (no-owner tasks)
handling as-is — it's a separate, user-scoping concern, not a project concern.

## Affected areas
- `lib/usage-summary.ts` — `spendForUser()`, `SpendSummary`, `TaskSpend` types: add the range
  parameter, project join, and per-project breakdown array.
- `app/api/usage/route.ts` — `GET()`: accept and forward a `range` query param.
- Consumers that will need the new shape: `components/UsageSummaryCard.tsx` and
  `app/(app)/usage/page.tsx` (covered by the paired frontend task,
  `02-frontend-usage-project-date-filter.md`).
