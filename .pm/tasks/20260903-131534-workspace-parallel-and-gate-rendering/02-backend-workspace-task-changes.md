---
title: Report per-task changes for a workspace across its member repos
stack: backend
assignee: swe
priority: P1
depends_on: [01-services-workspace-member-worktrees.md]
---

# Report per-task changes for a workspace across its member repos

## Issue
The task detail page's Changes card is missing entirely on Award Maven. `resolveTaskWorkRoot`
(`lib/task-root.ts:48`) returns `{ kind: "unavailable", reason: "workspace" }` before it asks any
git question, so `GET /api/tasks/[id]/changes` answers `{"available":false,"reason":"workspace"}`
(verified live against the running install; the same task on a plain-git project answers
`{"available":true,"scope":"checkout",…}`). The refusal exists because the resolver returns one
`cwd` and a workspace has several repos — but that makes the one project with the most repos the
only one that can't see its own diff.

## Goal
A workspace task's changes are reported for **every** member repo it could have touched — the
root and each member, or the corresponding isolated worktrees when the run was parallel — so the
Changes card works on Award Maven the way it does everywhere else.

## Suggested solution
Turn the resolver's single root into a **`workRoots`** list: one entry per repo, each carrying the
repo's label (its directory name / the `role` from the project's `members`), its `cwd`, and the
existing per-root `kind` (`checkout` / `worktree` / `worktree-removed`). A plain-git project
returns a one-entry list, so nothing else changes shape conceptually. `isTaskWorktree` containment
is then applied **per root** against that repo's own `.git` — do not widen it to accept a member's
worktree under a different repo's admin directory, which is the hole that guard exists to close.
`GET /api/tasks/[id]/changes` returns a per-repo array (keeping `available`, and reserving
`reason` for the genuinely unavailable cases: not-git, and a workspace whose members are all
unreadable). `/api/projects/[id]/diff?task=…` needs to know *which* repo a clicked file belongs
to, so the file entries should carry their repo label. Keep the route's "no path parameter, the
task id is the only input" stance — the roots still come from the rows.

## Affected areas
- `lib/task-root.ts` — `resolveTaskWorkRoot` (`:44-56`) becomes `workRoots`; `isTaskWorktree`
  (`:85-118`) applied per repo, unchanged in substance
- `app/api/tasks/[id]/changes/route.ts` — per-repo response; `gitChanges` still consumed unchanged
- `app/api/projects/[id]/diff/route.ts` — resolve a file against the right member repo; note it
  currently gates on a bare `existsSync(task.workdir)`
- `lib/task-root.test.ts` — the specs that pin each containment clause and the leak it prevents
- Features affected: the task page's Changes card and the diff modal; consumed by task 07
