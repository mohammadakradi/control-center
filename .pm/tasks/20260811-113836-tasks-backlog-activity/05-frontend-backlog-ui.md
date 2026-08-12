---
title: Backlog nav page and per-project backlog UI
stack: frontend
assignee: fe
priority: P2
depends_on: [03-backend-backlog-model-api.md]
---

# Backlog nav page and per-project backlog UI

## Issue
Once the backlog exists in the database (task 03) there is no UI for it — the user can't see
which planned items are done vs. not started, change an item's status, add one manually, or
run one as a task.

## Goal
A "Backlog" nav entry opens the backlog view: pick a project, see its items with status,
change status manually, add an item, and dispatch an item as a task (then follow the link to
the running task).

## Suggested solution
New `app/(app)/backlog/page.tsx` with a project selector (backlog is per project), listing
items with a status control (todo / in_progress / done / cancelled), a manual "Add item"
form (title, description, assignee fe/swe), and a "Run" action calling the task-03 run
endpoint then navigating to `/tasks/<id>` — mirroring the `FileModal.tsx` dispatch UX. Show
the linked task's state on items that ran. Add the nav entry in `components/nav-links.tsx`;
also link to the project's backlog from the project detail page. Reuse `CardSection`,
`StatusBadge`-style chips, `Button`, `Modal`, `select` primitives; semantic tokens only.

## Affected areas
- `app/(app)/backlog/page.tsx` — new page (+ client components as needed under `components/`)
- `components/nav-links.tsx` — new "Backlog" entry (Sidebar + MobileNav)
- `app/(app)/projects/[id]/page.tsx` — link/entry point to that project's backlog
- `app/api/projects/[id]/backlog/` routes from task 03 — consumed (list/create/update/run)
- `components/FileModal.tsx` — reference UX for dispatch-and-navigate
- Feature: reviewing and driving planned work per project
