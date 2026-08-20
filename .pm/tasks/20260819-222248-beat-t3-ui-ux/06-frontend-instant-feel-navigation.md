---
title: Instant-feel navigation — skeletons, prefetch, view transitions
stack: frontend
assignee: fe
priority: P2
depends_on: []
---

# Instant-feel navigation — skeletons, prefetch, view transitions

## Issue
Every view is a full `force-dynamic` SSR page load with spinner-only feedback and no route
`loading.tsx` anywhere, so moving between Dashboard, Projects, and a task feels like page
loads, not an app. "Switching is instant" is T3 Code's most-praised trait and our weakest.

## Goal
Navigation *feels* instant: immediate skeleton feedback on every route change, smooth
transitions, and faster arrivals where prefetching is safe — without rewriting the SSR
architecture into a SPA.

## Suggested solution
Route-level `loading.tsx` skeletons for the `app/(app)/*` pages built on one shared Skeleton
primitive (add to `components/ui-cards.tsx`; tokens only, respect `prefers-reduced-motion`).
Verify what `Link` prefetch and view transitions actually do for `force-dynamic` routes in
this non-standard Next 16.2.9 — read `node_modules/next/dist/docs/` first, don't assume
mainline behavior. Add optimistic touches only where server-state rules allow — note
`BacklogItemRow.tsx` documents why *it* deliberately renders server state; don't fight that.
Measure before/after on the Projects → project → task path.

## Affected areas
- new `app/(app)/*/loading.tsx` files — per-route skeletons (dashboard, projects, tasks, backlog, agents, usage)
- `components/ui-cards.tsx` — shared Skeleton primitive
- `components/Sidebar.tsx` / `components/MobileNav.tsx` / list `Link`s — prefetch review
- `app/globals.css` — skeleton shimmer keyframes (reduced-motion aware)
- `.fe/design-system.md` — document the skeleton pattern
