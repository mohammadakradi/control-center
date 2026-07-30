---
title: Usage display in the UI
stack: frontend
assignee: fe
priority: P2
depends_on: [04-backend-task-usage-capture.md, 05-backend-subscription-usage.md]
---

# Usage display in the UI

## Issue
Once tasks record token/cost figures (task 04) and per-user subscription limits are
queryable (task 05), the UI has nowhere that shows either — users can't see what a task
consumed or how much of their Claude plan remains.

## Goal
Every task shows its token usage (and cost where meaningful) in the task detail view and
task history; users see their subscription usage / remaining rate-limit windows at a
glance, and the widget simply doesn't render when the data is unavailable.

## Suggested solution
- Task-level: compact usage line/chips (input/output/cache tokens, cost) on the task
  detail page and in history rows — reuse `Chip`/`Fact` from `components/ui-cards.tsx`
  and semantic tokens per `.fe/design-system.md`; format large token counts humanely
  (e.g. "1.2M"). Data comes from the task API fields added in task 04.
- Subscription-level: a usage panel (dashboard and/or settings page) rendering the 5-hour
  and 7-day rate-limit windows from `app/api/usage/` — utilization bars with reset times;
  hide entirely (no error state) when the endpoint reports `available: false`.
- Tasks without backfilled usage (pre-tracking history) show nothing rather than zeros.

## Affected areas
- `app/tasks/[id]/page.tsx` + task live-view components — usage summary on task detail
- `components/TaskHistory.tsx` — usage chips in history rows
- `app/page.tsx` (dashboard) and/or `app/settings/` — subscription usage panel
- `components/ui-cards.tsx` (`Chip`, `Fact`) — reuse; extract shared usage components if a
  pattern repeats
- Feature: task detail, task history, dashboard/settings — gain usage visibility
