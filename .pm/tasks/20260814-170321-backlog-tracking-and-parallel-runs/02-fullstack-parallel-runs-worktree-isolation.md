---
title: Opt-in parallel task runs per project via git worktree isolation
stack: fullstack
assignee: swe
priority: P2
depends_on: []
---

# Opt-in parallel task runs per project via git worktree isolation

## Issue
The runner serializes strictly per project — one live job, everything else `queued` and
promoted oldest-first (`runner/session-manager.ts`, `projectBusy`/`promoteNext`). Two tasks
with no real overlap still wait on each other, halving throughput. Simply running both in
the same checkout is not an option: they'd share one git index (`index.lock` races,
`git add -A` sweeping the other task's edits), one HEAD (agents create/switch branches),
and the same builds/dev servers — so "check for overlap first" can't be made safe either,
since which files a task touches is only decided by the agent mid-run.

## Goal
A user can deliberately start a second task on a busy project and have it run concurrently
in full isolation — its own working tree and branch — with queueing remaining the default
and non-git projects unchanged.

## Suggested solution
Isolation instead of overlap-prediction: when dispatch targets a busy project and the caller
opted in ("run in parallel"), the runner creates a `git worktree` for the task (e.g. under
the app's data dir, on a task-named branch), points the SDK session's cwd at it, and removes
the worktree after the run ends (the branch/commits survive — merging is the normal PR/ship
flow, conflicts surface there like any two-dev collaboration). Key touchpoints:
- carry the flag through `lib/dispatch.ts` → runner, and store the task's actual working
  dir on the task row so everything downstream reads the right tree
- task-scoped reads (diff view, file view, git status) must follow the task's working dir,
  not the project path
- refuse the option for non-git projects and for workspace projects if member repos make it
  ambiguous; default flow (no flag) queues exactly as today
- clean up worktrees for tasks found dead on runner boot (it already fails non-terminal
  tasks there)

## Affected areas
- `runner/session-manager.ts` — `projectBusy` gate learns the parallel path; worktree
  create/cleanup around the session lifecycle
- `lib/dispatch.ts` + `POST /api/tasks` — accept and pass the opt-in flag
- `lib/db/schema.ts` + migration (`pnpm db:generate`/`db:migrate`) — persist the task's
  working dir (and/or branch) on `tasks`
- `app/api/diff/`, `app/api/projects/[id]/file` and other task-scoped git/file reads —
  resolve against the task's working dir when set
- Task dispatch UI (`components/NewTaskForm.tsx`) — offer "Run in parallel" only when the
  project is busy; small enough to stay in this task, split to fe if it grows
