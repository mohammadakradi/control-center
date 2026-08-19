---
title: Neutralize git hooks & system config on all platform-issued git commands
stack: backend
assignee: swe
priority: P1
depends_on: []
---

# Neutralize git hooks & system config on all platform-issued git commands

## Issue
`git worktree add` gives each linked worktree its own HEAD, index and working dir, but
`.git/config`, `.git/hooks/` and `.git/info/attributes` are **shared** with the main checkout
and every other linked worktree. A task's Bash tool has ordinary write access inside its
worktree, so a prompt-injected agent can plant `.git/hooks/post-checkout` and have it fire in
every other context. None of these files are tracked, so they never appear in `git status`, a
diff, a review, or a clone. Confirmed by PoC: a planted `post-checkout` fires on
`git worktree add`, and `ensureTaskWorktree` (`runner/worktree.ts:165`) runs that command on
every parallel dispatch — an automatic re-trigger. It can also be fired on demand through the
unauthenticated git route (checkout/create/pull). This contradicts the isolation docstring in
`runner/worktree.ts`, which claims sessions never share what matters for a security boundary.

## Goal
Platform-issued git commands never execute a hook or honor machine-wide config planted inside a
project tree, so a worktree can no longer become a persistent backdoor that fires in the main
checkout or in other tasks' worktrees. The existing worktree/diff/branch behavior is unchanged.

## Suggested solution
Apply hook and system-config neutralization consistently at the git-helper layer, in both the
`lib/git.ts` wrappers (`git()`, `runGit()`, and the direct `gitShowBytes()` call) and the
`git()` helper in `runner/worktree.ts`:
- Pass `-c core.hooksPath=<empty/nonexistent>` so no `.git/hooks/*` script runs (PoC: `/dev/null`
  works; an empty temp dir is a more portable choice — pick what's cross-platform-sound).
- Set `GIT_CONFIG_NOSYSTEM=1` in the subprocess env to ignore machine-wide config.
- **Do not** blanket-disable repo `.git/config` — `gitPull`/`gitPush` need remote config to
  work; the specific dangerous diff keys are already pinned (`--no-ext-diff --no-textconv`,
  `--submodule=short`). Keep those.
Add a regression test (drive a real repo with a planted `post-checkout`, assert it does not fire
through the platform helpers, and assert push/pull remotes still resolve). Update the isolation
docstring in `runner/worktree.ts` so it no longer overclaims. Note in the code/notes that adding
auth to the git route is a separate, out-of-scope design question (same as the backlog auth gap).

## Affected areas
- `lib/git.ts` — `git()` (:55), `runGit()` (:72), `gitShowBytes()` (:533): the three git
  subprocess entry points; apply hooksPath + `GIT_CONFIG_NOSYSTEM` here.
- `runner/worktree.ts` — `git()` (:53) used by `ensureTaskWorktree`/worktree lifecycle: the
  `worktree add` re-trigger path; apply the same neutralization; fix the isolation docstring.
- `lib/git.test.ts`, `runner/worktree.test.ts` — add the hook-neutralization regression test(s).
- Flows: parallel-worktree task runs, the file/diff viewer, and the git controls
  (checkout/create/pull/push via `app/api/projects/[id]/git/route.ts`).
