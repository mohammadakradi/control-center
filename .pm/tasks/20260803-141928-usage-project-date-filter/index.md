# Usage page: per-task project, date-range filter, per-project breakdown

## Request
User request: "usage page should display each task is related to which project? it should
also contain date range filter (last 7days, last 30 days, total) to filter usage it should
also display usage per project."

## Request assessment
- **Verdict:** BUILD
- **What was asked:** (1) show which project each task belongs to on the Usage page; (2) add
  a date-range filter (last 7 days / last 30 days / total); (3) show usage broken down per
  project.
- **What the code actually does:** `tasks.projectId` is a required FK to `projects.id`
  (`lib/db/schema.ts:120-122`, cascades on delete), so every task already has a project — but
  `spendForUser()` (`lib/usage-summary.ts:49`) never joins `projects`, and its `TaskSpend`/
  `SpendSummary` types carry no project field. `UsageSummaryCard`'s "Most expensive runs" list
  (`components/UsageSummaryCard.tsx:73-101`) renders no project info. `spendForUser()` computes
  exactly one hardcoded window, `last30DaysCostUsd`, with no parameter and no interactive
  control — a repo-wide search found zero existing `searchParams`-driven filters anywhere in
  `app/`. No per-project aggregation exists anywhere in `usage-summary.ts`, `/api/usage`
  (`app/api/usage/route.ts`), or the Usage page (`app/(app)/usage/page.tsx`) — `spendForUser`
  is a single flat total scoped only to `userId`.
- **Already implemented?** No, for all three asks.
- **Risks/conflicts:** None found. `graphify explain "usage-summary.ts"` shows its only
  dependents are `UsageSummaryCard.tsx`, `usage/page.tsx`, and `usage/route.ts` — a contained
  blast radius, safe to extend the returned shape. Must preserve the existing per-user scoping
  (spend is billing-adjacent and stays private per user, unlike shared task transcripts).
- **Real need:** the user runs multiple projects from one instance and currently only sees one
  flat, all-time spend total; they want spend over time windows and by project, and to trace an
  expensive run back to its project.
- **Recommendation:** Proceed, reusing existing patterns rather than inventing new ones — the
  dashboard's project-label convention (`FolderGit2` icon + name,
  `app/(app)/page.tsx:184-187`, `app/(app)/agents/[id]/page.tsx:221-224`) for "which project",
  and the `ThemeToggle` 3-way segmented control (`components/ThemeToggle.tsx:25-56`) as the
  visual model for the 7d/30d/total filter.

## Solution
Extend the existing data layer (`spendForUser`) to accept a date-range parameter and to
join/group by project, rather than building a parallel query path. The UI then adds a
segmented filter control and a project-breakdown section using the established visual
patterns cited above.

## Tasks
- **[swe] Extend usage data layer for date-range + per-project aggregation** —
  `01-backend-usage-project-date-filter.md`
- **[fe] Usage page: date-range filter, per-task project label, per-project breakdown** —
  `02-frontend-usage-project-date-filter.md` (depends on 01)
