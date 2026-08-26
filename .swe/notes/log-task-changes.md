# log task changes

Dated log of the per-task changes panel and `lib/task-root.ts`.

<!-- Split out of a single 232 KB `.swe/notes.md` on 2026-08-24, which was read in full at the start of every request (engineering rule 10). Entries are verbatim and in date order; only this header is new. -->

## 2026-08-19 — per-task changes panel (`lib/task-root.ts`, `GET /api/tasks/:id/changes`)
pm task `01-fullstack-task-changes-panel` from `.pm/tasks/20260819-222248-beat-t3-ui-ux/`. The
task page now shows what the run changed, for a checkout run and for a parallel run's worktree.
Nothing in `lib/git.ts` or `lib/safe-read.ts` changed — the whole task is *resolving a cwd* and
handing it to `gitChanges`/`gitFileDiff` as-is.

- **Resolution is its own module because the test harness can't reach a route.** `pnpm test`
  globs `lib/`, `lib/discovery/`, `runner/`, `infra/release/` only, so anything living in
  `app/api/**` or a component is untestable here. `resolveTaskWorkRoot` (`lib/task-root.ts`)
  therefore owns every state and the route is a five-line translator — the same move as
  `launchMode` (`runner/worktree.ts`) and `orderSkills` (`lib/ui.ts`). It takes the two rows and
  spawns nothing, so it costs no subprocess and can't be made to hang.
- **`existsSync(workdir)` is the obvious "is the worktree still there" test and it is wrong in a
  way that shows another repository's changes under this task's name.** A directory git no longer
  recognises (pruned, or its `.git` file removed) makes git walk *up* — and `data/worktrees/`
  **sits inside the platform's own repo in a dev checkout** (the 2026-08-16 gotcha). Measured: with
  the workdir pointed at such a dir, `gitChanges` returned the platform checkout's entire change
  set. The guard is `existsSync(join(dir, ".git"))`, matching `repoOpts` and `isGit` so all three
  agree on what a root is (a linked worktree's `.git` is a *file*; both forms are roots). Chosen
  over `rev-parse --show-toplevel` — which is what `runner/worktree.ts` uses, where a subprocess is
  already in hand — because this runs in the web process on request. `lib/task-root.test.ts` pins
  it *and* characterises the leak it prevents, so if anyone reduces it to an existence check the
  suite says which failure they've reintroduced.
- **No fallback from a missing worktree to the project checkout**, matching the diff route's
  existing stance: `worktree-removed` is its own reported scope, not "working tree clean", because
  those are different claims and the branch is where the work actually is.
- **The panel says whose changes these are.** For a worktree run the list is exclusively the
  task's, so it renders expanded. For a checkout run it is that shared tree's uncommitted state —
  which on a task from three weeks ago is just "whatever is in the tree today" — so it renders
  collapsed behind a summary, with a line saying it isn't necessarily all from this task. Scope
  drives the default; a user toggle overrides it (`manualOpen ?? default`, no effect needed).
- **Not polled, deliberately.** Each load is two git subprocesses in the process that also serves
  the SSE streams. A live run refreshes when it *ends* — `TaskLiveView` already calls
  `router.refresh()` on the end event, so threading the server-rendered `status` in as a prop is a
  free signal — plus a manual refresh button. The cost of that choice: changes accumulating during
  a long run are not live until you press refresh.
- **`react-hooks/set-state-in-effect` shaped the fetch.** The React-compiler lint rule rejects a
  synchronous `setState` in an effect body, so `load()` sets nothing synchronously (`loading`
  starts `true`) and only the manual refresh — an event handler — turns the spinner on. Worth
  knowing before adding any fetch-on-mount component here.

### Two verification traps, and the first one nearly made me "fix" working code
- **A falsification edit poisoned the Turbopack cache and the dev server kept serving it.** I
  reverted the guard to `existsSync(dir)` to prove the spec could fail (it did), restored it, and
  later verified over HTTP — and the route reported `scope: "worktree"` for a stale dir, i.e. the
  falsified behavior, *after* a full `docker restart`. `existsSync` measured inside the same
  container answered correctly, which is what stopped me concluding my own guard was broken. The
  giveaway was that `lib/git.ts`'s untouched `repoOpts` disagreed with `lib/task-root.ts` about the
  same path in the same process — impossible unless one of them was stale. This is the
  incremental-reparse corruption already in this file (2026-08-12, "surviving even a full container
  restart"), reached by a new route: **wipe `platform_platform_next` and restart.** Standing rule
  now — do falsification passes *before* any manual verification, or wipe the volume in between;
  and if two callers of the same function disagree, suspect the cache before the code.
- **The runner's boot sweep deleted my verification worktree.** `data/worktrees/tmpverify` vanished
  on the next container restart: the sweep removes worktree dirs whose *name* matches no task row,
  and the row was `task_TMPVERIFY`. Working as designed. Name a hand-made worktree exactly after
  its task id, or it won't survive a restart.
- Verified end to end over HTTP against the real dev app (temporary `user_local` task row, since
  every real task here belongs to a signed-in account; row and worktree removed afterwards): a
  live worktree returns only its own two files while the checkout has fifteen; a stale dir returns
  `worktree-removed` with an empty list; `?task=` on the diff route renders the worktree's
  untracked file, and the same path without `?task=` correctly renders nothing; another owner's
  task id and a nonexistent one both answer an identical 404. Both card states screenshotted.
- The `RunDuration` hydration mismatch seen while verifying is an artifact of the synthetic row
  (`status: done` with `endedAt: null`, so the duration keeps ticking) — not a real defect, and not
  reachable from a real finished task.
### What the two reviews changed (both returned PASS with no blocking findings)
- **The security audit reproduced a raceless bypass of my own guard, and it is the important
  finding of this task.** `existsSync(dir + "/.git")` is true for an **empty directory named
  `.git`** — and git then walks straight up into the enclosing repo, exactly the misattribution the
  guard exists to stop. Same for a symlink to a non-git directory. One `mv .git .git.real && mkdir
  .git` from inside its own worktree is all an agent needs; no timing. My docstring's claim that "a
  stale pointer degrades safely" was true only of a *dangling* pointer, so the comment was actively
  misleading — the 2026-08-19 attachment-upload lesson (an overclaiming comment is worse than none)
  applied to my own code within a day.
  - `isTaskWorktree` now requires a **regular file** (`lstat`, so a symlink is judged as itself and
    nothing non-regular is opened — a planted FIFO would otherwise block the request), size-capped,
    holding a `gitdir:` that exists and resolves **under the project's own `.git`**. That last
    clause also bounds the *retargeted* pointer — the documented `.git`-file redirect, which the
    audit showed leaking another repo's tracked paths and line counts through this route — at the
    one place in the codebase holding both `project.path` and `task.workdir`, which is the auditor's
    own suggestion and the reason it belongs here rather than in `lib/git.ts`.
  - **Containment is skipped when the project is itself a linked worktree** (its `.git` is a file,
    so its worktrees' admin data lives under the *main* repo). Enforcing it there would silently
    report "no changes" for a legitimate run, and this file's own history says a false negative for
    real users beats a bound against a contrived plant.
  - Four new specs, each falsifiable: reverting to either weaker form turns exactly those four red
    (verified by reverting, per the standing rule above). Re-verified over HTTP too — the empty
    `.git` dir, a cross-repo pointer and a symlink all answer `worktree-removed` now.
  - **Left open, filed:** the spawn-window TOCTOU (`.git` removed after the check, before git's
    discovery). The audit verified `GIT_CEILING_DIRECTORIES=<dirname(cwd)>` in `gitEnv()` closes it
    *and* leaves legitimate repos byte-identical — but that is shared hardening on every git call in
    the app, and `repoOpts`' own history (the `--work-tree`-on-a-subdirectory corruption) says a
    change there earns its own task and its own review. What survives is names + line counts, never
    content, from an attacker who is already same-uid.
- **The audit's severity framing is worth keeping:** `POST /api/projects` is unauthenticated and
  takes an arbitrary absolute path, so anyone on loopback can already make the project page run
  `gitChanges` on *any* directory — strictly more than this route leaked. It also confirmed no new
  git invocation was added (`git diff --stat` empty over `lib/git.ts`/`lib/safe-read.ts`), that the
  404s are byte-identical with no timing oracle (80 samples × 4 id shapes), and that `tasks.workdir`
  is not client-controllable.
- **The correctness review's real find was a refetch race.** Two loads overlap when a run ends
  mid-refresh; neither carried a request id, so the older reply could resolve last and overwrite the
  newer list with stale counts. `load()` now stamps a sequence number in a ref and drops superseded
  replies. Also from that review: a failed *refresh* used to replace a good list with an error
  banner — the banner is now additive, keeping the last-known-good list underneath.
- **It also caught that the branchiest new code was the least verified**, since `pnpm test` cannot
  reach `components/`. The render derivation moved out to `taskChangesView` (`lib/ui.ts`, beside
  `orderSkills`) with five specs, including that an *unknown* scope defaults to the cautious
  "shared checkout" reading rather than claiming exclusivity.
- Suite went 395 → 405. Both reviewers independently re-ran it, tsc, lint, and my falsification.

- **The graph was left stale on purpose, and the caveat is worse than documented.** `graphify
  update .` without `GEMINI_API_KEY` didn't just strip `community_name` — it re-extracted from 883
  curated nodes to 3 937 with **zero** named. Reverted (`git checkout -- graphify-out/`) per the
  CLAUDE.md caveat, which prefers a slightly stale graph to a de-named one. So the graph does not
  know about `lib/task-root.ts` yet; refresh it with a key set.
### Deferred work — recorded here because the backlog tool was unavailable
The `swe-platform` MCP server disconnected mid-session, so `add_backlog_item` could not be called.
These are not filed as rows yet; **file them before this list goes stale.** (Deliberately not
POSTed to `/api/projects/:id/backlog` over loopback: that route is unauthenticated and would write
`source: "manual"`, i.e. an unfenced row attributed to a person, which is the hole CLAUDE.md's
backlog section documents.)
1. **`GIT_CEILING_DIRECTORIES` on every git invocation in `lib/git.ts`** (swe). Closes the
   spawn-window TOCTOU left by `isTaskWorktree`, *and* every "git walks up out of the directory we
   meant" variant at once, inside the child where no race exists. The audit verified
   `GIT_CEILING_DIRECTORIES=<dirname(cwd)>` neutralises the empty-`.git` and symlink plants and
   leaves a legitimate linked worktree and a normal checkout byte-identical. Care needed: it must
   not be sent where git legitimately has to discover upward — `memberPath()` can hand `gitChanges`
   a workspace member that is *not* its own repo root, and `repoOpts` already gates `--work-tree` on
   exactly that condition, so reuse that gate rather than applying it unconditionally.
2. **Move `/api/projects/:id/{diff,file}` onto `resolveTaskWorkRoot`** (swe). Both still gate on a
   bare `existsSync(task.workdir)`, so both inherit every bypass this task just closed — and the new
   card is what makes `?task=` one-click reachable rather than a hand-crafted URL. Behaviour change
   to decide in that task: the `file` route currently falls through to the **project checkout** for a
   removed worktree with no stored branch (reachable — `worktreeBranch` returns null on a detached
   HEAD), which contradicts the diff route's own stance.
3. **`Cache-Control: no-store` + `Vary: Cookie` on per-user JSON routes** (swe). The audit measured
   that the new route, `/api/usage` and `/api/projects` all send no cache directives, so a shared
   browser profile could heuristically cache one account's data across a sign-out. Pre-existing and
   install-wide, hence its own item.
4. **`DataSettings.tsx`'s archive-import upload** still has the live-`File`-in-`FormData` shape
   (already noted 2026-08-19 as `bli_c24269be` — that one *is* filed).

- **Deliberately not done:** switching the existing `diff`/`file` routes onto the same resolver.
  It would close the stale-dir trap there too and stop three call sites drifting, but it changes
  shipped behavior in one edge — the `file` route currently falls through to the *project checkout*
  for a removed worktree with no stored branch (reachable: `worktreeBranch` returns null for a
  detached HEAD). Filed to the backlog instead of half-done under a different task's name.
