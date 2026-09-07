---
title: Isolate a workspace's member repos so its tasks can run in parallel
stack: services
assignee: swe
priority: P1
depends_on: []
---

# Isolate a workspace's member repos so its tasks can run in parallel

## Issue
Award Maven is the install's only `isWorkspace: true` project (root `AW-Maven/portal`, members
`../portal-frontend` and `../am-workers`), and workspaces are refused git-worktree isolation in
three places: `parallelOffer` never offers the checkbox, `createAndStartTask` answers 400, and
`launchMode` can't pick `isolate`. So a workspace's concurrency is hard-capped at 1 — every task
after the first queues. Confirmed empirically: **81/81 Award Maven tasks ran with
`parallel = false` and `workdir = null`**, while plain-git projects show 5 and 4 parallel runs
respectively. The stated reason ("member repos make the isolated worktree ambiguous") is real but
solvable: the members are *siblings* of the root, so one per-task directory holding a worktree per
repo reproduces the workspace's own relative layout exactly.

## Goal
A workspace task can opt into parallel isolation like any git project: it gets its own working
copy of the root **and** each member repo, the `../member` relative paths still resolve from the
root, and its work merges back per repo. Award Maven runs several tasks at once.

## Suggested solution
Give a task a **set** of worktrees instead of one. Lay them out under a single per-task directory
keyed by repo directory name — e.g. `data/worktrees/task_<id>/{portal,portal-frontend,am-workers}`
— so `../portal-frontend` from the isolated root lands on the isolated member, not the user's
checkout. `ensureTaskWorktree` grows a workspace variant that walks the project's `members`, and
the session's cwd becomes the isolated root. Persist enough on the task row to resolve the set
again after a restart (task 02 and the file/diff views need it); a per-repo branch named the same
way the single-repo case names it keeps `merge-sweep` per-repo logic straightforward. Then lift
the `isWorkspace` refusal in `parallelOffer`, `createAndStartTask` and `launchMode` — keeping them
in lockstep, which `lib/dispatch.test.ts` already pins. A member repo that isn't a git repo, or
whose worktree can't be created, should fail the launch loudly rather than half-isolate. Consume
`lib/git.ts` and `isTaskWorktree` unchanged — no new git invocation shapes.

## Affected areas
- `runner/worktree.ts` — `launchMode` (`:86-92`, the `canIsolate` clause), `ensureTaskWorktree`,
  and the merge/`mergeState` machinery that must now run per member repo
- `runner/merge-sweep.ts` / `sweepFeatureMerges` — merge-back and cleanup across a set of repos
- `lib/dispatch.ts` — `parallelOffer` (`:89-94`) and the workspace 400 in `createAndStartTask`
  (`:174-183`)
- `runner/session-manager.ts:1039-1046` — the `launchMode` call site and the `workdir`/`branch`
  persistence at `:1082-1089`
- `lib/discovery/projects.ts` — the project `members` list (`path` + `role`) this reads from
- Features affected: parallel/queued dispatch, feature-branch merge-back, worktree cleanup at
  `finalize()` and the boot sweep (`runner/server.ts:227-256`)
