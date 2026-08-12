---
title: Add a Tasks nav page listing all tasks grouped by project
stack: frontend
assignee: fe
priority: P2
depends_on: [01-frontend-shared-task-list.md]
---

# Add a Tasks nav page listing all tasks grouped by project

## Issue
There is no way to see all tasks in one place — `app/(app)/tasks/` only contains the single
task view (`[id]/page.tsx`), and `components/nav-links.tsx` has no Tasks entry. To review
work across projects the user must visit each project detail page in turn.

## Goal
A "Tasks" entry in the nav opens a page showing all of the current user's tasks grouped by
project, with a project filter, each row linking to the task view.

## Suggested solution
New server-component page `app/(app)/tasks/page.tsx` (querying the DB like the Dashboard
does, scoped with `ownedBy()` from `lib/task-access.ts` — never unscoped), grouped by
project via a project filter (e.g. searchParams-driven select or chips). Render each group
with the shared task-list component from task 01. Add the nav entry to
`components/nav-links.tsx` (Sidebar and MobileNav both consume it).

## Affected areas
- `app/(app)/tasks/page.tsx` — new page (note: `/tasks/[id]` already exists under the same dir)
- `components/nav-links.tsx` — new "Tasks" entry (flows into `Sidebar.tsx` + `MobileNav.tsx`)
- `lib/task-access.ts` — `ownedBy()` scoping for the query (use, don't modify)
- Shared task-list component from task 01 — reused per project group
- Feature: cross-project task review / filtering
