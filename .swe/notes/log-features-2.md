# log features

Dated log of the feature entity and its branch/merge-back lifecycle as it was built.

Part 2 of 2.

<!-- Split out of a single 232 KB `.swe/notes.md` on 2026-08-24, which was read in full at the start of every request (engineering rule 10). Entries are verbatim and in date order; only this header is new. -->

## 2026-08-21 — the parallel option reaches the backlog and pm-spec dispatch paths
Task 03 of `.pm/tasks/20260821-135656-feature-grouping-branches-parallel/`. Pure plumbing of an
opt-in that already existed end to end (`tasks.parallel` → `launchMode` → worktree), so the
interesting decisions are all about *where the edges go*, not about isolation itself.
- **The run route's body is `{ parallel }` and nothing else, and that is the security-relevant
  part of the change.** An item's text, title, assignee and feature are read off the row the sync
  owns — which is exactly why `POST …/[itemId]/run` had no body at all until now. So the parser
  drops unknown keys rather than spreading them: the same stance `parseBacklogEdit` takes on
  `sourcePath`/`source`/`linkedTaskId`, for the same reason. Verified over HTTP that a body
  carrying `featureId`, `title`, `source` and `userId` changes nothing about the dispatch.
- **A non-boolean `parallel` is refused, not coerced, and the reason is the failure shape.**
  Coercion here is invisible: the run queues, which is *identical* to what happens when nobody
  asks for isolation — so the caller cannot tell the flag was dropped. Same argument
  `lib/search.ts` makes for refusing a bad `limit` rather than clamping it. `null` and `0` are
  refused too; only absent means absent.
- **`await req.json().catch(() => null)`, because this route's back-compat *is* the empty body.**
  Both existing callers (`BacklogItemRow`'s Run, `FileModal`'s Create task) sent none, and an
  unhandled throw in a route handler renders HTML, which the composer can't read an error out of
  — the lesson already paid for in `readFormData`. Checked the four shapes that matter (no body,
  garbage, `text/plain`, `multipart/form-data` with no boundary): all 412 (i.e. straight through
  to the token gate), none 500.
- **`parallelOffer` went into `lib/dispatch.ts` specifically to sit next to the refusal it
  mirrors.** The condition was inlined in the project page, and three pages now need it; had it
  been copied, the copies would answer differently from `createAndStartTask` the first time
  either moved. The spec that matters is *"the offer and the dispatch's refusal cannot drift
  apart"*: it makes three projects busy (git / non-git / workspace), asks the offer, then
  actually dispatches with `parallel: true` and asserts the two agree — distinguishing "refused
  the flag" (400) from "accepted it and then failed on the unreachable runner" (502). It restates
  neither one's logic, so it stays true if either changes shape.
- **Every new spec was checked against its own clause by reverting it**, the habit this journal
  keeps insisting on: dropping `project.isWorkspace` from `parallelOffer` turns 2 red, dropping
  `isNull(tasks.workdir)` from `checkoutBusy` turns 1 red. Neither passes for free.
- **Rendering was verified for real, not reasoned about**, since `pnpm test` can't reach
  `components/`. A `running` task row was inserted straight into the dev DB (through the app's own
  better-sqlite3 inside the container, never host `sqlite3` — see the corruption gotcha) to make
  a checkout busy, then the backlog page's HTML was checked: 34 open items → 34 checkboxes, and a
  scratch project proved a `done` row and an already-running row render none. **A trap worth
  recording:** the scratch project's `path` was `/app`, so `loadProjectBacklog` promptly synced
  *this repo's* 34 `.pm/tasks/` specs into it — a probe project pointed at a real repo is not
  inert. It all cascaded away with the project row, and the real project's item count was
  re-checked afterwards (34, unchanged).
- **The clients gate on `parallel && parallelOffer`.** Not a boundary (the server refuses
  regardless) — it is the difference between a stale checkbox producing a normal queued run and
  producing a 400 the user can do nothing about.
- **Known limitation, documented rather than fixed:** the offer is a page-load snapshot, so the
  first dispatch against a free checkout never sees it and a batch needs one reload. That is
  `NewTaskForm`'s existing behaviour, and task 02's feature-linked runs (which isolate regardless
  of busyness) are the real answer for fan-out. Making it live would mean polling or an SSE
  channel for "is the checkout busy" in the process that already serves the task streams.
- **Not verified with a live agent** — the standing 412 on this install. What a token would add
  is only steps 7+ of `.swe/test-scenarios/parallel-backlog-spec-dispatch.md` (that an isolated
  run really lands in `data/worktrees/` while a plain one queues), which is the part
  `runner/worktree.test.ts` already pins from task 02's side.
- **Both review lenses came back PASS with no blocking findings** — the first time in this
  journal's recent history, which is worth being suspicious of rather than pleased about, so
  what they did find is recorded here in full:
  - *(reviewer)* the drift spec inferred "the flag was refused" from **status 400 alone**. True
    for today's code, but a 400 added ahead of the parallel check would let it keep passing while
    testing nothing — the exact failure mode this journal keeps recording ("a green test is not
    evidence until it can fail"). It now matches `/Parallel runs/` on the message *and* asserts
    the accepted case reaches 502, so the coupling is explicit rather than incidental. Re-verified
    it still goes red when the workspace clause is removed.
  - *(reviewer)* `parallel && parallelOffer` is **not** pure belt-and-braces, and the reasoning is
    worth keeping: `createAndStartTask` validates `isGit`/`isWorkspace` but **never busyness**, so
    for a plain git repo the flag is harmless whether or not the checkout is busy. That means the
    only thing the client gate really suppresses is the busy→free transition, where sending it
    would have been *fine* — so a ticked box can be silently downgraded to a queued run. Kept
    anyway, with the trade written into the comment: it fails safe, the box disappears in the same
    repaint, and it is byte-for-byte the gate `NewTaskForm` has always used. Sending it regardless
    would trade a silently-normal run for a hard 400 on the one shape that truly can't isolate.
  - *(reviewer)* `FileModal`'s `parallel` isn't reset when `path` changes. Unreachable by
    construction — `TaskLiveView` renders the modal behind `{scenarioPath && …}`, so closing it
    unmounts and closing is the only way to reach another file — so it was left as-is rather than
    given a reset nobody can trigger.
  - *(security)* PASS, and it independently reproduced the four things I'd claimed: no mass
    assignment (a body carrying `featureId`/`title`/`userId`/`requestText`/`linkedTaskId` has zero
    observable effect), no existence oracle from the parse ordering, no amplification beyond the
    already-reachable `POST /api/tasks` (`MAX_WORKTREES` is on the shared create path, so a second
    door doesn't raise the ceiling), and boolean-only disclosure at all three call sites. Its one
    note — `req.json()` has no size or depth cap — is the **pre-existing** pattern on
    `POST /api/tasks` too (measured: 40 MB in 0.63 s, 100 k-deep nesting, both fine, server
    healthy after). Filed for both routes together rather than patched on one.
  - Semgrep's only hit in these files (`FileModal.tsx` `console.error` format string) is
    pre-existing and outside the diff's hunks.
- **Test count drifted 580 → 582 mid-task and it was not mine.** `runner/worktree.test.ts` gained
  two specs at 19:35, after my own edits at 19:25–19:27 — task 02's uncommitted work being
  touched in the same tree. Worth checking rather than assuming, since an unexplained count is
  indistinguishable from a spec of your own quietly disappearing.
- **The reviewer saw the drift spec fail once and couldn't reproduce it; chasing it found a real
  coupling in this test file.** `dispatchRefusal` runs *before* the parallel check, so a missing
  `ALLOW_SHARED_TOKEN_FALLBACK` makes every dispatch answer 412 — and a spec that infers
  "accepted the flag" from "not a 400" then reads *accepted* for all three project shapes, i.e. a
  silent false pass on the two that must be refused. Another test in the same file deletes that
  variable and restores it in a `finally`, so it is process-global state these specs share.
  Simulated by removing that restore: the **pre-existing** parallel specs (`the parallel flag is
  refused where no worktree can exist`, `…is stored on a git project's task`) go red, while mine
  survives because it now sets the variable itself and asserts a 412 is a *named test-setup
  failure* rather than a drift. node:test is sequential within a file, so the real suite is fine
  today and the pre-existing specs were left alone — but a spec that depends on a neighbour being
  outside its own `try/finally` is one `--test-concurrency` away from lying, and this file has two
  of those left.

## 2026-08-22 — merge-back honesty, auto conflict resolution, isolation by default
User request with a screenshot of the exact confusion the last two tasks shipped: a cancelled
task with an unreadable "Not merged", two "Merge conflict" chips the user believed were merged,
and no way to tell what any of it meant. **Diagnosed against the live install before planning
anything, and the diagnosis inverted the design** — read this before trusting any merge chip
recorded before today.
- **Neither "Merge conflict" was a conflict.** Both merges failed with `fatal: '<feature
  branch>' is already used by worktree at <main checkout>` — the non-parallel feature runs had
  checked the feature branch out in the main checkout (the preamble tells them to work there)
  and git refuses a second checkout of one branch, so `mergeFeatureTask`'s temp `worktree add`
  failed and the catch-all recorded "conflict" (the exact non-blocking finding both reviewers
  flagged on task 02 and I accepted — it bit a real user within a day). One branch
  (`task/e0754eff`) was in fact **fully merged by hand later**; the other (`task/340946d0`) was
  worse: the run ended `done` **without committing anything** — 20 files sat uncommitted in its
  kept worktree while its branch tip equalled the base, so `--no-ff` would have said "Already
  up to date" and recorded **"merged" for work that was never saved**.
- **What shipped, in dependency order** (613 tests, all green; lint/typecheck/build clean):
  - `gitMerge` classifies structurally: `MergeResult.conflict` = `MERGE_HEAD` existed before
    the abort. **Not** `ls-files -u` through `runGit` — that helper maps empty output to
    `"Done."`, so emptiness is unreadable; my own new spec caught this by failing (a missing
    branch read as a conflict). Trap for any future probe: `runGit` output is prose, exit
    codes are data.
  - `mergeFeatureTask` returns `{state: merged|conflict|blocked|no_commits, output}` and never
    throws — callers act on the kind, not on exception prose. It pre-checks `branchContained`
    (no-commit branches must not read as merged) and `branchCheckoutDir` (where is the feature
    branch checked out), and can merge **in the main checkout** when that's where the branch
    lives and the caller vouches nothing is live there (`mergeInMainCheckout`).
  - `mergeState` grew `blocked` and `no_commits` — plain text column, **no migration needed**.
    `setTaskFeature` now keeps the "null ⇔ no feature" invariant for hand-grouped tasks
    (pending on group, null on ungroup, recorded outcomes never rewritten).
  - **One automatic conflict-resolve turn in the same live session** (`mergeOnDone` +
    `mergeResolvePrompt`): on a real conflict, record `conflict` *first* (a cancel mid-resolve
    keeps the honest state), push the prompt (merge feature INTO task branch in the task's own
    worktree, reconcile both sides, commit, no gates, no push), and re-attempt the merge when
    the turn ends. Bounded to one attempt ever (`handle.mergeResolveAttempted`). **The turn
    accounting is the delicate part:** a mid-turn `[[DONE]]` finalize pushes the prompt while
    that turn's own `result` is still in flight — `mergeResolveSwallowResult` eats exactly that
    one stale result, or the handler re-attempts the merge before the agent has seen the prompt
    and seals `conflict` with the resolution still ahead. The three finalize(done) sites pass
    their context explicitly (`mid-turn` / `boundary` / `none` at stream-end where a pushed
    turn could never run); any new finalize call site defaults to `none` so it can't start an
    agent turn by accident.
  - **`sweepFeatureMerges` (runner/merge-sweep.ts)** at boot + from `promoteNext` (= every time
    a checkout frees, exactly when a checkout-blocked merge can succeed). Reclassifies from the
    object store: contained + clean/absent worktree → `merged` (also heals rows the old
    catch-all mis-recorded — the user's two bogus conflicts fix themselves on next runner
    boot); contained + dirty kept worktree → `no_commits` (marking that "merged" hides unsaved
    work); `blocked` + real commits → re-attempt; `conflict` + real commits → **left alone**
    (needs reconciling, not a retry per sweep). Every flip writes a transcript log — a chip
    that silently changes is a mystery.
  - **`parallelOffer` dropped its busyness clause** (offer ≡ dispatch accepts: git && not
    workspace) and all three checkboxes default **checked**, relabelled "Isolated" with
    plain-language copy. `checkoutBusy` deleted — no consumer left. The old snapshot behaviour
    was what produced un-isolated feature runs in the first place; with isolation the default,
    feature runs always isolate and the blocked-merge case becomes rare instead of systematic.
  - `mergeChipView` (lib/ui.ts) is the one place chip wording is decided; `pending` is no
    longer one word (no chip on cancelled/failed where nothing was attempted; "Merges when
    done" on live runs; "In checkout" + honest tooltip otherwise). Tooltips moved out of
    `FeatureGroup.tsx` into `MERGE_STATE_TITLE` so the whole vocabulary is spec'd.
    `featureMergeSummary` counts `blocked` ("N waiting" — a queue that genuinely drains, unlike
    pending) and still never counts pending/no_commits.
  - `FeatureGroup` is a client-side disclosure now (chevron button, `aria-expanded`/
    `aria-controls`); active features + the ungrouped bucket start open, closed features start
    collapsed (`featureGroupDefaultOpen`, spec'd). Deliberately not persisted — a remembered
    collapse is a filter, not a fold. Chips/count stay outside the button (the branch chip is
    a string to copy; folding it in makes it unselectable without toggling).
- **Verified by reverting, per this journal's standing rule:** the missing-branch conflict spec
  failed against the first implementation and drove the MERGE_HEAD redesign; the sweep specs
  are seeded with the two real field states (hand-merged-after-conflict, done-without-commit)
  rather than synthetic ones.
- **Cost note stated at the proposal gate and accepted:** the resolve turn spends the owner's
  tokens with no click. One turn, logged in the transcript, only on a real conflict, only once
  per run.
- **Not verified end-to-end with a live agent** — standing 412 on this install. The resolve
  flow's orchestration (swallow/boundary) is exactly the untestable seam `startTask`/`finalize`
  have always been; everything below it (`gitMerge` classification, `mergeFeatureTask`
  outcomes, sweep, prompt text) is pinned by real-git specs.

### Two independent reviews of the merge-honesty work: two blocking correctness + three blocking security, all resolved
Both lenses came back CHANGES_REQUIRED. What they found and how it was closed (618 tests green, lint/typecheck/build clean afterward):
- **(correctness, BLOCKING) The mid-turn swallow guard was checked too late.** After a mid-turn
  `[[DONE]]` pushed the resolve turn, the stale result to be swallowed could carry an error
  subtype (`error_max_turns`/`_max_budget_usd`) — and the result handler's `if (isErr) finalize
  failed` ran *before* the swallow branch (which lived inside `else if (!handle.done)`), so it
  sealed the task `failed` and orphaned the just-pushed resolve turn. Fixed by extracting the
  whole branch decision into a pure, exported `resultAction()` with **swallow first, before
  fail**, and dispatching on its result. This also made the precedence unit-testable for the
  first time (the loop that consumes it still needs a live SDK `query`, but the ordering — the
  load-bearing part, and where the bug was — no longer does). The reviewer's push-back that
  "finalize/mergeOnDone aren't as untestable as the note claims" was right about the *decision*;
  the extraction is the answer. Backstop confirmed: if the swallowed error means the subprocess
  is dead and the resolve turn can't run, the iterator ends and the post-loop `finalize(done)`
  (resolve "none", mergeResolveAttempted already true) records the final merge outcome — the task
  still terminates, it doesn't hang.
- **(correctness, BLOCKING) Ungrouping a task left a merge chip that lies forever.** `setTaskFeature`
  only nulled `mergeState` when it was `pending`, so ungrouping a `blocked`/`conflict`/`no_commits`
  row kept that state — but the sweep's query `innerJoin`s through `featureId`, so a feature-less
  row is unreachable and can never be retried or reclassified, while `mergeChipView` still rendered
  "Merge waiting"/etc. with a tooltip promising an automatic retry that nothing would ever perform.
  Fixed to the only sound reading: `mergeState` describes the relationship to the **current**
  feature — **null on ungroup** (restores the codebase-wide "null ⇔ no feature" invariant the sweep
  depends on), **pending on group-or-move** (a recorded outcome was against a *different* feature's
  branch; carrying "merged" onto feature B's heading would read as "this work is in B's branch"
  when it isn't), and unchanged only for an idempotent same-feature PATCH. My earlier "regrouping
  never rewrites a recorded outcome" test was the wrong invariant and was replaced by two: ungroup
  → null, move → pending.
- **(security, BLOCKING/CRITICAL) `branchCheckoutDir` forged-worktree spoofing.** It parsed
  `git worktree list --porcelain` with `.split("\n")` + exact line matching. Git does **not**
  escape a newline inside a worktree *path* in that output, and a task can
  `git worktree add "$(printf '%s\nbranch refs/heads/<feature>' "$PROJECT")" <scratch>` (linked
  worktrees share `.git` bookkeeping) to register an entry whose printed path contains a fake
  `branch refs/heads/<feature>` line — the newline-split parser then attributed the feature branch
  to the project checkout that never held it, and `mergeFeatureTask` ran `git merge` in the user's
  **real tree** against whatever was checked out there. Reproduced end to end by the auditor.
  Fixed with `--porcelain -z`: every field is NUL-terminated and the embedded newline stays inert
  inside the path token. Verified the old parser leaks (returns the real project path for a branch
  never checked out there) and the `-z` parser returns null on the same forged repo. Same `-z`
  class CLAUDE.md already documents for `git status`/`--numstat`; the lesson is that it applies to
  **every** porcelain parse, `worktree list` included.
- **(security, BLOCKING/HIGH) No timeout on `runner/worktree.ts`'s `git()`.** A repo-defined
  smudge filter (untracked `.git/info/attributes`) runs on the `worktree add` this file issues,
  `execFileSync` is synchronous, and the boot sweep runs it *before* the server listens — so a
  poisoned project could wedge the event loop (which also serves the SSE streams) or delay the
  runner from ever starting, install-wide. The auditor timed a planted `sleep`-filter blocking the
  exact wrapped call for its full duration. Fixed by sharing `LOCAL_GIT_TIMEOUT` (now exported from
  lib/git.ts) onto this helper — the same 30s bound lib/git.ts's own `git()` already carried; this
  file had drifted from it, the same drift that once left `-c core.fsmonitor=` off `worktree add`.
- **(security, BLOCKING/CRITICAL) `merge.<driver>.driver` RCE on `git merge`.** Same class as the
  documented `filter.<driver>.clean`: attacker-named driver, no `-c` key to blank, bound via
  untracked `.git/info/attributes`, executes in the runner process during a platform-issued merge.
  **Pre-existing** via the 2026-08-21 `gitMerge` (temp-worktree-only then); this task made it worse
  by (a) also merging in the main checkout and (b) auto-retriggering from boot/promoteNext. Closed
  the two amplifiers this task introduced (the `-z` parser above removes the arbitrary-branch
  main-checkout aim; the timeout removes the DoS half), documented the residual base RCE in
  CLAUDE.md next to the filter.clean entry, and filed the real redesign to the backlog
  (`bli_9925a15a`, swe) — the same "stop letting a platform-issued git command run repo-defined
  command config" fix owed for the whole class. Not papered over: the merge genuinely still runs a
  repo-defined driver on a legitimately-checked-out feature branch.
- **Non-blocking, addressed:** the sweep's `no_commits` log arm was dead code (the sweep only calls
  `mergeFeatureTask` in the `!contained` branch, where `no_commits` can't return) — removed, folded
  into the `blocked` skip. `settle()`'s direct `task_events` insert bypasses `record()`'s redaction
  (no live handle/secret list); documented that it is safe *by construction* — the interpolated
  values are branch names and local `git merge` output, and the owner's token lives only in the
  per-task SDK subprocess env (`buildTaskEnv`), never in the runner's `process.env`, so a local
  platform-issued git command here cannot echo it. Kept the rule explicit: no message built here
  may ever include remote/credential output. `branchContained` gained the leading-dash guard the
  file's own policy demands even though both callers already check.
- **Non-blocking, accepted as-is:** the "two isolated feature tasks can't both merge into the main
  checkout at once" safety rests on `mergeFeatureTask`/`gitMerge` being fully synchronous
  (`execFileSync`), so the event loop serializes them — real and load-bearing, untested because it
  needs two concurrently-finishing live sessions (the standing 412 seam). Flagged so a future move
  to async git here doesn't silently reopen it. And the resolve prompt is pushed without a
  `record("message")` bubble (only a log line explains it) — matches the initial-dispatch pattern,
  left alone.
