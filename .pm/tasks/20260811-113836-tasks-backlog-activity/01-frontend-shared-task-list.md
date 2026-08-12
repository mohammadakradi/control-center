---
title: Extract a shared task-list component and show task titles everywhere
stack: frontend
assignee: fe
priority: P1
depends_on: []
---

# Extract a shared task-list component and show task titles everywhere

## Issue
Task rows are rendered three separate times with drifting behavior: the project detail page
uses `components/TaskHistory.tsx` (which correctly shows `title || requestText`,
line 57), but the Dashboard recent-activity list (`app/(app)/page.tsx:190`) and the agent
detail task list (`app/(app)/agents/[id]/page.tsx:222`) hand-roll their own rows and render
raw `requestText` — so history there reads as request prose instead of the smart task name
that `tasks.title` already holds.

## Goal
One encapsulated, reusable task-list component (following the project-detail standard set by
`TaskHistory.tsx`) renders every task list in the app, title-first with `requestText` as
fallback — Dashboard, agent detail, and project detail all use it.

## Suggested solution
Generalize `components/TaskHistory.tsx` into the shared component (or a new
`components/TaskList.tsx` that `TaskHistory` wraps): keep the title-first line, status badge,
cost, and time-ago; make per-context extras optional props (e.g. show-project column for the
Dashboard, agent `/namespace:command` label via `namespaceById`, card title/count header).
Replace the bespoke row markup in `app/(app)/page.tsx` and `app/(app)/agents/[id]/page.tsx`
with it. Semantic tokens only, per `.fe/design-system.md`.

## Affected areas
- `components/TaskHistory.tsx` — becomes (or wraps) the shared task-list component
- `app/(app)/page.tsx` — Dashboard "Recent activity" switches to the shared component
- `app/(app)/agents/[id]/page.tsx` — agent detail task list switches to the shared component
- `app/(app)/projects/[id]/page.tsx` — existing `TaskHistory` usage keeps working
- Feature: task history everywhere becomes scannable by task name
