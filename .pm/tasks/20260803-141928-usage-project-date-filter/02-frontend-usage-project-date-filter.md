---
title: "Usage page: date-range filter, per-task project label, per-project breakdown"
stack: frontend
assignee: fe
priority: P2
depends_on: [01-backend-usage-project-date-filter.md]
---

# Usage page: date-range filter, per-task project label, per-project breakdown

## Issue
The Usage page (`app/(app)/usage/page.tsx`, rendered via `components/UsageSummaryCard.tsx`)
shows one flat, all-time spend total with no way to filter by time window, and its "Most
expensive runs" list doesn't say which project each task belongs to. There's also nowhere on
the page to see spend broken down by project — every number is a single per-user aggregate.

## Goal
On the Usage page, the user can switch between last 7 days / last 30 days / total spend, see
which project each listed task belongs to, and see a per-project spend breakdown.

## Suggested solution
Add a 3-way segmented control for the date range (7d/30d/total), visually modeled on the
existing `ThemeToggle` segmented control (`components/ThemeToggle.tsx:25-56`), wired to the
`range` param the backend task adds to `spendForUser`/`/api/usage`
(`01-backend-usage-project-date-filter.md`). On each "Most expensive runs" row in
`UsageSummaryCard.tsx`, show the task's project using the same small `FolderGit2`-icon +
project-name convention already used elsewhere for this exact purpose (`app/(app)/page.tsx:184-187`,
`app/(app)/agents/[id]/page.tsx:221-224`). Add a new per-project breakdown section (e.g. a
list of projects with their spend/token totals for the selected range), reusing existing
primitives (`CardSection`, `Tile`) from `components/ui-cards.tsx`.

## Affected areas
- `app/(app)/usage/page.tsx` — hosts the date-range control and passes the selected range down.
- `components/UsageSummaryCard.tsx` — per-task project label on "Most expensive runs" rows,
  plus the new per-project breakdown section.
- `components/ThemeToggle.tsx` — reuse as the visual/interaction pattern for the new segmented
  range control (not imported directly — it's theme-specific — but match its markup/a11y
  shape: `role="radiogroup"`, `role="radio"`, `aria-checked`).
- `components/ui-cards.tsx` (`CardSection`, `Tile`) — reuse for the per-project breakdown.
