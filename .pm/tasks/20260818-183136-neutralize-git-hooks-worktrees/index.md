# Neutralize shared git hooks/config across task worktrees

## Request assessment
- **Verdict:** BUILD (partial scope — one part recommended out)
- **What was asked:** Fix that `.git/hooks/`, `.git/config` and `.git/info/attributes` are
  shared across the main checkout and all linked worktrees, letting a prompt-injected agent
  plant a hook from its "isolated" worktree that fires everywhere and persists.
- **What the code actually does (evidence):**
  - PoC confirmed: a planted `.git/hooks/post-checkout` fires on `git worktree add`
    (`HOOK-FIRED from …/wt1`); `git -c core.hooksPath=/dev/null worktree add` suppresses it.
  - `ensureTaskWorktree` (`runner/worktree.ts:165`) runs `git worktree add -b …` on every
    parallel dispatch — an automatic re-trigger of any planted hook.
  - `app/api/projects/[id]/git/route.ts` has no auth (no `getCurrentUser()`); checkout/create/
    pull are on-demand triggers reachable over loopback.
  - No hook/config neutralization exists anywhere today (grep for `hooksPath`/`GIT_CONFIG`/
    `core.hooks` returns nothing).
  - Exactly 4 git subprocess call sites, all funneling through `git()`/`runGit()`/
    `gitShowBytes()` in `lib/git.ts` and `git()` in `runner/worktree.ts`.
  - The `diff.<name>.textconv` half is already fixed (`NO_CUSTOM_DIFF_DRIVERS` =
    `--no-ext-diff --no-textconv`), as the item itself notes.
- **Already implemented?** No for the hooks/config sharing; the textconv/ext-diff half is done.
- **Risks / conflicts:** The fix must not blanket-disable repo `.git/config` — `gitPull`/
  `gitPush` need remote config. Neutralize hooks + system config only; keep the already-pinned
  diff flags.
- **Real need:** Platform-issued git must never execute an attacker-planted hook or honor
  machine-wide config from inside a project tree, removing the persistent-backdoor primitive
  regardless of who can trigger a checkout.
- **Recommendation:** Proceed with one backend (swe) task neutralizing hooks + system config at
  the git-helper level with a regression test. **Out of scope (recommended against bundling):**
  adding auth to `app/api/projects/[id]/git/route.ts` — it collides with the deliberately
  cookie-less local-workspace mode and is the same unresolved design question as the
  unauthenticated backlog routes (documented in CLAUDE.md); the hooks fix stands on its own.

## Solution in brief
Apply `-c core.hooksPath=<empty>` and `GIT_CONFIG_NOSYSTEM=1` consistently at both git-helper
layers (`lib/git.ts` and `runner/worktree.ts`), leaving repo config (remotes) and the existing
diff flags intact. Add a regression test and correct the `runner/worktree.ts` isolation
docstring. Auth on the git route is flagged as a separate, larger design decision, not this task.

## Tasks
- **[swe] Neutralize git hooks & system config on all platform-issued git commands** —
  `01-backend-neutralize-git-hooks.md`
