---
title: Move usage to its own "Usage" nav page
stack: frontend
assignee: fe
priority: P2
depends_on: []
---

# Move usage to its own "Usage" nav page

## Issue
Usage (spend totals and, when the SDK can supply them, plan rate-limit percentage bars) is
currently buried inside the Settings page (`app/(app)/settings/page.tsx`) alongside the
Anthropic token vault. The user wants usage discoverable as its own top-level section, named
"Usage", instead of living under Settings.

## Goal
A new "Usage" item appears in primary navigation (desktop sidebar + mobile nav) and leads to a
dedicated `/usage` page showing the user's spend summary and plan-limit bars. Settings keeps
only the token vault.

## Suggested solution
Add a `/usage` entry to the shared `NAV_LINKS` list so it shows up in both `Sidebar.tsx` and
`MobileNav.tsx` automatically. Create `app/(app)/usage/page.tsx` mirroring the auth-gated
pattern already in `app/(app)/settings/page.tsx` (redirect to `/signin` if no user), rendering
`UsageSummaryCard` (fed by `spendForUser`) and `PlanLimits`. Remove those two components from
the settings page, leaving `TokenSettings` there. Pick a fitting lucide-react icon for the nav
entry (e.g. one already used near usage/cost, like `Gauge` or `BarChart3`) — `Coins` is already
in use inside the usage components themselves.

`PlanLimits` already renders per-window percent-used progress bars with reset countdowns,
matching the attached Claude screenshot's layout — no new chart is needed, just carry it to the
new page. It typically shows nothing today because plan limits usually report unavailable for
this app's env-injected tokens (`runner/usage-snapshot.ts`); that's expected, not a bug to fix
here.

## Affected areas
- `components/nav-links.tsx` — add a `/usage` `NavLink` to `NAV_LINKS` (shared by both navs)
- `components/Sidebar.tsx`, `components/MobileNav.tsx` — pick up the new link automatically via
  `NAV_LINKS`, no direct edits expected
- `app/(app)/usage/page.tsx` — new page, same auth-gate pattern as `app/(app)/settings/page.tsx`
- `app/(app)/settings/page.tsx` — remove `UsageSummaryCard` and `PlanLimits`, keep `TokenSettings`
- `components/UsageSummaryCard.tsx`, `components/PlanLimits.tsx` — relocated, not modified
- Feature/flow: primary navigation (desktop + mobile), the Settings page, the new Usage page
