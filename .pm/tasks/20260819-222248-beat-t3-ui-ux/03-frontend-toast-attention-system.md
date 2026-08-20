---
title: Global toast & attention system for task lifecycle events
stack: frontend
assignee: fe
priority: P1
depends_on: []
---

# Global toast & attention system for task lifecycle events

## Issue
No toast/notification system exists anywhere in the app. A task hitting an approval gate or
finishing while the user is on another page surfaces only as a number changing in the 5s-polled
`ActivityBadge` — supervising several concurrent tasks means manually re-checking pages. The
gates are this product's differentiator, and the UI doesn't tell you when one needs you.

## Goal
Anywhere in the app, a task transitioning to *awaiting your approval*, *done*, or *failed*
raises a dismissible toast that links straight to the task. Multi-task supervision works
without polling pages by hand.

## Suggested solution
A bespoke toast layer (no library — bespoke-components rule), mounted once in
`app/(app)/layout.tsx`, styled entirely with semantic tokens and respecting
`prefers-reduced-motion`. Drive it from the existing shared active-tasks store
(`lib/active-tasks.ts`, already polled every 5s and paused on hidden tabs): diff successive
snapshots to detect transitions into `awaiting_proposal`/`awaiting_report` and out of active
statuses (done/failed). Suppress toasts for the task whose page is currently open. Reusable
`toast()` API so other features (git actions, backlog errors) can adopt it later; document in
`.fe/design-system.md`.

## Affected areas
- new `components/Toaster.tsx` (+ store, e.g. `lib/toast.ts`) — the toast primitive and queue
- `lib/active-tasks.ts` — expose transition detection (previous vs. current snapshot)
- `app/(app)/layout.tsx` — mounts the toaster next to `ActivityBadge`/`UpdateBanner`
- `.fe/design-system.md` — new component entry
