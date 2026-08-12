# Tasks menu, per-project Backlog, activity badge, title-first task lists

**Requested:** show the task name (not the raw request text) in task history lists; add a
**Tasks** menu (all tasks grouped by project, filterable); add a per-project **Backlog**
(fed by the pm agent's planned tasks and by fe/swe agents when asked, with manual status
changes and run-from-backlog); and a top-right **activity badge** popping up the running
tasks for quick navigation.

## Request assessment
- **Verdict:** PARTIAL (part 1 half-exists; parts 2–4 are BUILD)
- **What was asked:** title-first task lists, a Tasks menu, a per-project backlog, a
  running-tasks activity badge.
- **What the code actually does:** tasks already have a smart `title`
  (`lib/db/schema.ts:139`, generated at dispatch by `runner/model-router.ts`, backfill via
  `pnpm db:backfill-titles`); `components/TaskHistory.tsx:57` (project detail) and the task
  header (`app/(app)/tasks/[id]/page.tsx:72`) already prefer it — but the Dashboard recent
  activity (`app/(app)/page.tsx:190`) and agent detail list
  (`app/(app)/agents/[id]/page.tsx:222`) still render `requestText`. There is no all-tasks
  page (`app/(app)/tasks/` only has `[id]/`), no backlog anywhere, and no global
  running-tasks indicator.
- **Already implemented?** Titles: yes (mechanism + project-detail list). Everything else: no.
- **Risks / conflicts:** task lists must stay scoped through `lib/task-access.ts`
  (`ownedBy`); backlog is shared per project (projects are deliberately shared); new table
  needs a versioned migration committed with the schema change.
- **Real need:** scannable history by intent, a global work view, a persistent per-project
  queue both humans and agents feed, and at-a-glance awareness of running work.
- **Recommendation:** proceed; for part 1, extract one shared task-list component instead of
  patching each list (user-approved direction).

## Approved solution (in brief)
- **Shared task list:** one encapsulated component modeled on `components/TaskHistory.tsx`
  (title-first: `title || requestText`), reused by Dashboard, agent detail, project detail,
  and the new Tasks page.
- **Tasks page:** `/tasks` nav entry; the user's tasks grouped by project with a project
  filter (server component, `ownedBy` scoping).
- **Backlog:** new `backlog_items` table (+ versioned migration) with status
  todo/in_progress/done/cancelled and optional `linkedTaskId`; API for CRUD/status/run;
  idempotent sync of the pm agent's `.pm/tasks/` spec files (keyed by file path — no
  pm-agent changes); `add_backlog_item` MCP tool on the runner's existing `swe-platform`
  in-process server so fe/swe agents can add items when asked; Backlog UI with manual add,
  status controls, and run-from-backlog dispatch (same shape as `FileModal.createTask`).
  A linked task reaching `done` marks its backlog item done; manual override always works.
- **Activity badge:** global indicator (desktop top-right, mobile top bar) polling
  `GET /api/tasks` and filtering with `ACTIVE_STATUSES`; hover/click popover lists running
  tasks linking to `/tasks/<id>`.

## Tasks
1. `01-frontend-shared-task-list.md` — **[fe]** Shared task-list component, title-first, used everywhere
2. `02-frontend-tasks-page.md` — **[fe]** Tasks nav page grouped by project (depends on 1)
3. `03-backend-backlog-model-api.md` — **[swe]** Backlog table, migration, API, `.pm/tasks/` sync, run dispatch
4. `04-services-runner-backlog-tool.md` — **[swe]** Runner MCP tool `add_backlog_item` (depends on 3)
5. `05-frontend-backlog-ui.md` — **[fe]** Backlog nav page + per-project backlog UI (depends on 3)
6. `06-frontend-activity-badge.md` — **[fe]** Running-tasks activity badge + popover
