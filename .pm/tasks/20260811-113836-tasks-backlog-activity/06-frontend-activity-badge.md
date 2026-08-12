---
title: Running-tasks activity badge with quick-navigation popover
stack: frontend
assignee: fe
priority: P2
depends_on: []
---

# Running-tasks activity badge with quick-navigation popover

## Issue
There is no global indicator of running tasks — the in-progress count exists only as a
Dashboard stat (`app/(app)/page.tsx:40`, via `ACTIVE_STATUSES` from `lib/ui.ts`). While
watching one task, the user has no awareness of, or quick path to, the others.

## Goal
A top-right activity badge visible on every page shows how many tasks are running; hovering
or clicking it pops up the running tasks so the user can jump straight to any of them.

## Suggested solution
A client component mounted in `app/(app)/layout.tsx` — desktop layout has no top bar
(sidebar + main only), so place it as a fixed top-right element on `md+` and integrate with
`components/MobileNav.tsx`'s top bar below that. Poll the existing `GET /api/tasks` (already
`ownedBy`-scoped) every few seconds and filter client-side with `ACTIVE_STATUSES`; render
nothing when zero. Popover (hover + click, keyboard-accessible) lists each running task —
title, project, `StatusBadge` — linking to `/tasks/<id>`. Pause or slow polling when the tab
is hidden.

## Affected areas
- `components/` — new activity-badge client component (+ popover)
- `app/(app)/layout.tsx` — mount point next to `UpdateBanner`/main chrome
- `components/MobileNav.tsx` — badge placement in the mobile top bar
- `app/api/tasks/route.ts` GET + `lib/ui.ts` `ACTIVE_STATUSES` — consumed (use, don't modify)
- Feature: cross-page awareness of and navigation between running tasks
