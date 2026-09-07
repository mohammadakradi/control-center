---
title: Hide closed features by default, with a filter to bring them back
stack: frontend
assignee: fe
priority: P2
depends_on: []
---

# Hide closed features by default, with a filter to bring them back

## Issue
A closed feature never leaves the screen. `listFeatures` (`lib/features.ts:186-193`) returns every
row regardless of `status`, and both hosts render all of them: the project page's Features card
(`app/(app)/projects/[id]/page.tsx:127` → `FeatureManager`, which just adds a status `Chip` at
`:400-401`) and the backlog page (`app/(app)/backlog/page.tsx:153` → `FeatureGroup`, which starts a
closed feature *collapsed* but still on screen, `components/FeatureGroup.tsx:41-43`, `:124-130`).
There is no status filter anywhere. This is a deliberate design stance, written down in
`lib/features.ts:345` — *"closing a feature out (`status: done`) keeps it on screen forever as a
collapsed heading, which is right for finished work"* — and the user is reversing it: after a few
months of shipped features, "right for finished work" reads as clutter above the work in flight.

## Goal
The features sections show active features only. Closed and cancelled ones are still reachable in
one click, and the fact that they exist is never hidden — the user can see there are N closed
features without having to remember they were closed.

## Suggested solution
Follow the pattern the backlog page already uses for *items* rather than inventing a second one:
it splits on `isOpenBacklogStatus` (`app/(app)/backlog/page.tsx:122`), states the remainder in the
header sentence ("…, and N closed", `:159`), and discloses it in its own section (`:211-214`). Add
the feature equivalent — an `isOpenFeatureStatus` / split helper in `lib/ui.ts` beside
`isOpenBacklogStatus` (`:104`) and `groupByFeature` (`:450`), so the decision is DOM-free and
`pnpm test` can reach it — and apply it in both hosts. For the "show me the closed ones"
affordance, follow the existing query-param filter idiom (`?project=` in `ProjectFilterNav`,
`?range=` on `app/(app)/usage/page.tsx:25`): links, not client state, so the selection survives SSR
and navigation the way the other filters do. Note the pill itself is **not** reusable yet —
`FilterPill` is module-local (`components/ProjectFilterNav.tsx:80`) and `SpendRangeNav.tsx:32`
hand-rolls the same thing again, so this is the third use and the point at which extracting one
shared pill is the right move (fe rule 3) rather than a fourth copy. Prefer filtering **before**
the rows cross into
`FeatureManager` — it is a client component, and the project page already minimizes what it
serializes on purpose (`app/(app)/projects/[id]/page.tsx:132-139`). `FeatureGroup`'s
start-collapsed-when-closed behaviour then only applies to a filtered-in closed feature, which is
where it was always right. Don't change what "closed" means or touch the close/reopen actions
(`components/FeatureManager.tsx:462`, `:474`) — this is a visibility change only.

## Affected areas
- `lib/ui.ts` — a feature-status split helper beside `isOpenBacklogStatus` (`:104`) and
  `groupByFeature` (`:450`), with specs in `lib/ui.test.ts`
- `app/(app)/projects/[id]/page.tsx:127` — the Features card's `listFeatures` read and what it
  passes to `FeatureManager`
- `app/(app)/backlog/page.tsx:153` — the feature list behind the groups and the Add-item picker
  (the picker must still be able to reach a closed feature if it can today)
- `components/FeatureManager.tsx` — the status `Chip` (`:400-401`) and the filter affordance
- `components/FeatureGroup.tsx:41-43`, `:124-130` — start-collapsed and the Closed/Cancelled chip
- `components/ProjectFilterNav.tsx:80` and `components/SpendRangeNav.tsx:32` — the two existing
  copies of the filter pill, to extract from rather than copy a third time
- `.fe/design-system.md` — record the status-filter pattern if it becomes a shared component
- Features affected: the project page's Features card, the backlog page's feature groups
