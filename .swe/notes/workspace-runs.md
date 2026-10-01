# Workspace runs — scoping a task to one member repo

Decided 2026-10-01 (user-approved plan; repo is **picked explicitly** in the composer, never
guessed from the request text — a wrong guess would put two sessions in one repo).

## What it does
A workspace task can name one member repo (`tasks.member`, migration `0008`). Tasks on
different members run side by side; tasks on the same member, or a whole-workspace task
(member null — the pre-existing behavior), queue. No worktrees: a member-scoped run executes in
that member's real checkout, which its slot makes exclusive.

## The pieces, and why each is where it is
- **`slotsConflict` / `runnableQueued` (`runner/worktree.ts`)** — pure, beside `launchMode`, for
  the same reason: this decides whether two sessions ever share a checkout. A slot is a
  member's **real path** (never the declared string — the security audit showed "." and "./"
  would otherwise be two slots over one checkout) or null; null conflicts with everything, so
  a non-workspace project is the old one-job-per-checkout rule byte for byte. Two members
  conflict when one directory contains the other (a nested repo).
- **`MAX_WORKSPACE_SESSIONS` (6)** caps live checkout sessions per workspace: the member list has
  no length limit and dispatch is unauthenticated over loopback (same reasoning as
  `MAX_WORKTREES`).
- **The queue is fair, not greedy.** A queued run reserves its slot against everything queued
  *behind* it. Without that, a waiting whole-workspace run starves behind a stream of member
  runs that each fit beside the previous one. `runTask` applies the same rule to a new
  dispatch, but **only in a workspace** — counting queued handles on a plain project would have
  changed `launchMode`'s `busy` input there (a stuck queued handle would flip runs to queue or
  isolate), and the old behavior had to stay identical.
  - Queued *handles* (in memory) are what a new dispatch checks, not queued *rows*: two rows
    created concurrently, each seeing the other queued before either handle existed, would
    deadlock with nothing live to call `promoteNext`.
  - `promoteNext` now starts **every** runnable queued job, not just one: a whole-workspace run
    finishing frees all members at once.
- **`resolveMemberSlot` (`lib/workspace.ts`) is the one member check**, used by dispatch
  (`memberRefusal`) and by the runner. Declared-by-exact-string is **not enough**:
  `projects.members` is copied from `.swe/workspace.json`, which anything in the tree (an
  agent's Bash included) can rewrite, and the project page re-syncs it on every render. So a
  member must also be declared relative, resolve (by real path) to a directory *inside the
  workspace's parent folder* (siblings like `../portal-frontend`; not the parent itself), and
  be its own git repo. Raised by the security audit; note that `POST /api/projects` already
  lets a loopback caller register any folder, so this is defence in depth, not the only gate.
  Non-string `member` in JSON is a 400 in the route.
- **The runner checks twice: in `runTask`, and again inside `launch()` against a fresh project
  row.** A queued run is started by `promoteNext` through the captured `launch` closure, never
  re-entering `runTask` — checking only at dispatch let it launch into a member removed while it
  waited (the correctness review's blocking finding). It also fails if the member now resolves
  to a different folder than the slot it was queued under. Never falls back to the root.
- **cwd = the member repo, plus `memberPreamble`** naming the repo, warning that siblings may be
  live, and pointing at the workspace root for shared context (the root's CLAUDE.md /
  `.swe/workspace.json` are not auto-loaded from a sibling cwd).
- **`runner/member-guard.ts`** — an in-process `PreToolUse` hook (holds under
  `bypassPermissions`) that denies Edit/Write/MultiEdit/NotebookEdit into **another member**.
  Owner of a path = the most specific member dir containing it, compared by real path (a
  symlink is judged by where it lands; a not-yet-created file by its nearest existing
  ancestor). Paths outside every member pass — blocking them broke scratch dirs and agent
  memory for no conflict benefit. **Not a security boundary: Bash can write anywhere.**

## Still open (deliberately out of scope)
- `parallel` (worktree isolation) is still refused on a workspace; two runs on the *same*
  member queue.
- Backlog/spec runs (`parseRunOptions`) can't pick a member yet; they run whole-workspace.
- `resolveTaskWorkRoot` still answers `unavailable` for every workspace task, so a
  member-scoped task has no Changes card.
- `queuedAhead` in `runTask` orders by handle-creation order, `promoteNext` by `createdAt`; they
  agree except under a true two-request race, where fairness may deviate (never a double-start
  — `runTask` is synchronous).
- A member-scoped run never triggers `sweepFeatureMerges`' checkout path — feature merge-back
  needs a non-workspace git project anyway.
