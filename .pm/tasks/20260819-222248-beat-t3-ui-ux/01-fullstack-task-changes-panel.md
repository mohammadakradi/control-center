---
title: Per-task changes & diff review on the task page
stack: fullstack
assignee: swe
priority: P1
depends_on: []
---

# Per-task changes & diff review on the task page

## Issue
A task's changes are invisible in the task view: the live transcript shows tool calls, but
what the run actually changed on disk is only reachable as the *project-level* "uncommitted
changes" list on the project page — and for a parallel run, those changes live in a git
worktree the project page doesn't show at all. Turn-by-turn diff review is T3 Code's
signature feature and our most-cited gap.

## Goal
The task page (`/tasks/[id]`) shows what this task changed — a per-file changes summary with
click-through diffs — for both a plain checkout run and a parallel-run worktree, without
weakening any of the existing diff hardening.

## Suggested solution
A task-scoped changes endpoint that resolves the task's real working root (the project
checkout, or the task's worktree for a parallel run — the `diff`/`file` routes already accept
a task worktree root) and reuses `gitChanges` / `gitFileDiff` from `lib/git.ts` unchanged.
Render a "Changes" section on the task page reusing `ChangesList` + `DiffModal`. Hard
constraint: stay on the hardened side of `lib/git.ts` / `lib/safe-read.ts` (`repoOpts`,
`NO_HOOKS`, no worktree path handed to a subprocess for content) — the file's own comments
and CLAUDE.md's "Reading files out of a project tree" section document why each clause exists.

## Affected areas
- `app/(app)/tasks/[id]/page.tsx` — hosts the new Changes section
- `components/ChangesList.tsx`, `components/DiffModal.tsx` — reused for the per-task view
- `app/api/projects/[id]/{diff,file}` routes + a new task-scoped changes-summary route (or a task param on the existing one)
- `lib/git.ts` (`gitChanges`, `gitFileDiff`) — consumed as-is; any new call must use `repoOpts`/`gitEnv`
- `runner/worktree.ts` / task row — where a parallel run's worktree path is resolved from
- `lib/task-access.ts` — task lookup must go through `findOwnedTask`
