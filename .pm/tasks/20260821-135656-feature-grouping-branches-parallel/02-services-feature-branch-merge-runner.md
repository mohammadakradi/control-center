---
title: Feature branch lifecycle and merge-back in the runner
stack: services
assignee: swe
priority: P1
depends_on: [01-backend-feature-entity-schema-sync-api.md]
---

# Feature branch lifecycle and merge-back in the runner

## Issue
A parallel run's `task/<id>` branch is created off the checkout's current HEAD with no base
option (`ensureTaskWorktree`, `runner/worktree.ts`), and nothing ever merges: `finalize()`
(`runner/session-manager.ts`) only records the branch and removes a clean worktree. So
running all of a feature's tasks leaves N disconnected task branches — there is no branch a
user can check out to get the feature's combined work.

## Goal
Each feature has one `feature/<slug>` branch; a feature-linked task's finished work ends up
merged into it deterministically. When every task of a feature is done and merged, the
feature branch holds all the changes. Merge conflicts surface as visible per-task state —
never auto-resolved, never silent.

## Suggested solution
- On the first run of a feature-linked task, create the feature's branch (name reserved on
  `features.branch` by task 01) off the project's default branch.
- Feature-linked parallel runs **always isolate** (extend `launchMode` in
  `runner/worktree.ts` — today it isolates only when the checkout is busy, so the first of N
  parallel siblings would land in the shared checkout), and `ensureTaskWorktree` bases the
  `task/<id>` branch on the feature branch instead of current HEAD.
- On a task reaching `done`, merge its task branch into the feature branch **in a temporary
  worktree of the feature branch** — never the user's checkout — via the hardened git path
  (`NO_HOOKS`/`gitEnv` from `lib/git.ts`, pinned config, timeouts). On conflict: abort the
  merge, record a per-task merge state (e.g. merged / conflict / pending, on the task row or
  feature-side — implementer's call, coordinate the migration with task 01), leave the task
  branch intact for manual resolution.
- A checkout (non-parallel) feature run can't be system-merged — the agent owns git there.
  Add a preamble line to the dispatched request naming the feature branch so the agent works
  on it (instruction-level guarantee; state it honestly in the merge state).
- Respect `MAX_WORKTREES` (16) — the temp merge worktree should be short-lived and not count
  against or exhaust the cap.

## Affected areas
- `runner/worktree.ts` — `launchMode` (feature ⇒ always isolate), `ensureTaskWorktree`
  (base ref = feature branch), feature-branch creation
- `runner/session-manager.ts` — `finalize()` gains the merge-on-done step; dispatch preamble
  for checkout runs of feature-linked tasks
- `lib/git.ts` — a merge helper on the hardened wrapper (no new hook/config exposure)
- `lib/db/schema.ts` + migration — per-task merge state (shared naming with task 04's chips)
- Consumes `features.branch` / `tasks.featureId` from task 01
