# log features

Dated log of the feature entity and its branch/merge-back lifecycle as it was built.

Part 1 of 2.

<!-- Split out of a single 232 KB `.swe/notes.md` on 2026-08-24, which was read in full at the start of every request (engineering rule 10). Entries are verbatim and in date order; only this header is new. -->

## 2026-08-21 — feature branch lifecycle and merge-back in the runner
pm task `02-services-feature-branch-merge-runner` from
`.pm/tasks/20260821-135656-feature-grouping-branches-parallel/`, depends on task 01 (the
`features` table + `features.branch` slug, done and committed separately as
`feat/feature-entity-backend` before this task started). Full design is now in CLAUDE.md
("The feature branch: lifecycle and merge-back"); this is the *why*, and where the two reviews
landed.
- **Verified the merge mechanics against real git before writing any code**, not from memory:
  a hand-built race (two branches diverging from the same base, one merged first) confirmed
  `git merge --no-ff --no-edit` succeeds cleanly for a non-conflicting second branch and fails
  with real conflict markers for a colliding one, and that `git merge --abort` afterward
  restores a byte-clean tree removable *without* `--force`. That measurement is what fixed the
  design on `--no-ff` (a plain `merge` would fast-forward the *first* task merged into a fresh
  feature branch but not any later, diverged one — an inconsistency with nothing to do with
  content) rather than assuming it.
- **`launchMode`'s new `feature` input only matters together with `parallel`, by design.** A
  feature-linked task that *isn't* parallel stays a plain checkout run on purpose — the whole
  point of the preamble/instruction-level fallback is that a checkout run is agent-owned git,
  and silently isolating it would contradict `mergeState` staying `"pending"` for exactly that
  case.
- **The temp merge worktree deliberately lives under the OS tmpdir, not `WORKTREES_DIR`.** The
  spec called this out explicitly (`MAX_WORKTREES` must not see it), and it was the one part of
  the design that couldn't share `ensureTaskWorktree`'s machinery at all — that function's cap
  check, birth-branch naming and reattach logic all assume a *task's* worktree, and shoehorning
  the merge scratch space through it would have made the cap arithmetic lie.
- **`ensureFeatureBranch` was written twice.** The first cut checked `branchExists` before
  attempting the create — cheap, but it meant the "branch already exists" recovery path
  (needed for the real race: two feature-linked tasks dispatched at once both finding the ref
  missing) could only be exercised by genuine concurrency, which a single-threaded test can't
  construct. Removed the pre-check; the function now always attempts the create and only
  consults `branchExists` from inside the `catch`. The ordinary "second task of this feature"
  case now runs through that exact recovery branch, which is what makes it a real regression
  test rather than an assertion that never falsifies — the existing idempotency spec's second
  call **is** the race's aftermath, just without needing two processes to produce it.
- **`finalize()`'s merge step is fully synchronous, and that's what makes it race-free without
  a lock.** Two tasks of the same feature finishing "at the same time" are still two separate
  JS callbacks in one event loop; since neither `finalize()` nor anything it calls contains an
  `await`, one call runs to completion before the other's callback is even scheduled. Worth
  stating plainly because it's easy to *look* concurrent (two independent async task sessions)
  while not being concurrent at the one point that matters.
- **The non-isolated preamble is decided from `handle.worktree`, not from `mode`.** `mode` is
  fixed the moment `launchMode` runs and never recomputed, so a task that sat `"queue"` and was
  later promoted would read as `"queue"` forever even though it's now running un-isolated in
  the checkout exactly like a `"run"`-mode task — checking the handle instead is what stays
  correct across the deferred-then-promoted path, which the queue tests don't otherwise touch.
- **Every new ref that reaches git got the same leading-dash guard as everything already in
  these files, even the one (`mergeFeatureTask`'s `featureBranch`) that's provably unreachable
  today.** `features.branch` is minted by task 01's allowlist and can never start with `-`, but
  the function takes a bare string parameter, and this codebase's own history (`gitShowFile`,
  `ensureTaskWorktree`'s `stored`/`birthBranch`) is a record of exactly this class of value
  becoming reachable later than expected. Guarding it here cost one `if` and a test.
- **Security self-check, done before requesting review:** the feature-name/branch preamble
  interpolates `feature.name` and `feature.branch` into agent-facing text with no fencing —
  deliberately, and not a new gap. `cleanFeatureName` (task 01) already reduces a name to one
  line with no control characters, the same treatment a backlog item's *title* gets (not its
  body) — titles are documented as unfenced by design, since a plain single-line string in a
  sentence is a much weaker injection surface than a whole untrusted body, and fencing every
  title/name would degrade legitimate ones for a threat this shape doesn't really carry. Nothing
  new here inherits the agent-item body-fencing requirement.
- **Not verified end-to-end with a live agent** — same standing limitation as every runner task
  in this journal (`user_local` has no Anthropic token on this install, so a real dispatch
  answers 412). Isolation/merge semantics are pinned by real-git specs in
  `runner/worktree.test.ts` (23 specs, git repos in temp dirs) and `lib/git.test.ts` (extended:
  `gitMerge` clean/conflict/unsafe-ref, plus added to the existing hook-neutralization spec);
  `featureBranchPreamble` gets its own `runner/session-manager.test.ts` (new file — nothing in
  that module had a dedicated spec file before, since `redactString`/`redactPayload`/
  `defaultTitle` are exported but untested; this doesn't retroactively cover those, only the new
  function). Manual steps needing a token are in
  `.swe/test-scenarios/feature-branch-merge-runner.md`.
- **Migration `drizzle/0005_sweet_magma.sql`**: `ALTER TABLE tasks ADD merge_state text` — no FK,
  so none of task 01's `ON DELETE` hand-completion gotcha applies here; `db:generate` produced
  the whole file correctly on the first try.

### Two independent reviews: one blocking security finding, fixed; the rest accepted or filed
- **BLOCKING, fixed: `runner/worktree.ts`'s local `git()` was missing `-c core.fsmonitor=`,
  and `git worktree add` — unlike `branch` or `worktree prune` — does invoke a planted one.**
  The security auditor reproduced it live before I touched anything: a `core.fsmonitor` script
  pointed at `.git/config` fired on `worktree add` under `NO_HOOKS` alone, in the runner
  process, with no attacker action beyond a feature-linked task reaching `done` — an
  *unattended* trigger, since `mergeFeatureTask` calls `worktree add` automatically from
  `finalize()`. I reproduced both the exploit and the fix myself before writing any code (a
  throwaway repo, a marker-touching script as the fsmonitor, `-c core.fsmonitor=` present vs
  absent) rather than trusting the report. Root cause was exactly the thing this file's own
  comment already warned about for `NO_HOOKS`/`gitEnv` ("an earlier version inlined the same
  two lines and a reviewer rightly called it a second place to keep in sync by hand") — this
  file had drifted from `lib/git.ts`'s fuller `repoOpts()` (which also carries
  `core.fsmonitor=`, `diff.renames`, `status.renames`, and the conditional `--work-tree`) by
  keeping only the narrower `NO_HOOKS` pair. Fixed by **exporting `repoOpts` from `lib/git.ts`
  and having `runner/worktree.ts`'s `git()` use it directly** — one pin list, not two — which
  closes the gap for every call site including the pre-existing `ensureTaskWorktree`, not just
  the new `ensureFeatureBranch`/`mergeFeatureTask`. Verified `--work-tree=<cwd>` doesn't change
  the behavior of `worktree add`/`branch`/`worktree remove`/`worktree prune` before relying on
  it (a bad interaction there would corrupt a repo, per this file's own documented `--work-tree`
  subdirectory gotcha) — all four are unaffected when `cwd` is a genuine repo/worktree root,
  which every call site here always passes.
  - **Added a regression test that plants `core.fsmonitor` across `ensureFeatureBranch`,
    `ensureTaskWorktree`, `mergeFeatureTask` and `removeWorktreeIfClean` in one spec, and
    verified it the honest way: reverted the fix (`sed` back to `NO_HOOKS`), watched the new
    test fail with the exact planted-marker assertion, then restored it.** The first version of
    the test itself had a bug worth remembering: it asserted no-firing immediately after
    committing test-fixture work *inside* the task worktree with the test file's own
    unhardened `git()` helper (used only for fixture setup) — `git add`/`git commit` do run
    fsmonitor themselves, so that assertion was checking the wrong thing and failed for a
    reason unrelated to `mergeFeatureTask`. Fixed by discarding the marker right after the
    fixture commit and re-checking only around the actual `mergeFeatureTask` call.
- **Non-blocking, accepted as-is (both reviewers independently flagged the same thing, and I
  agree it's polish, not a defect):** `mergeIntoFeature`'s catch-all sets `mergeState:
  "conflict"` for *any* thrown error from `mergeFeatureTask`, not only a real content conflict
  — e.g. the feature branch already checked out elsewhere (reproduced live by the security
  auditor: fails clean, no corruption, recoverable by retry once the branch frees up; now has
  its own regression test — "mergeFeatureTask throws cleanly when the feature branch is
  already checked out elsewhere"). `"conflict"` specifically implies "needs manual git
  resolution," which overstates an infra hiccup. Left alone: the log line carries the real
  error text either way, and task 04 (not yet built) is where a more granular state would
  actually get read.
- **Non-blocking, accepted:** `mergeIntoFeature`/the `!handle.worktree && task.featureId`
  preamble gate have no automated test reaching `finalize()`/`runTask()` themselves — nothing
  in this codebase does, `startTask`/`continueTask`/`finalize` have zero pre-existing coverage
  either, and the SDK's `query()` has no mocking harness anywhere in this repo. Both reviewers
  called this out and both accepted it for the same reason: it needs a live Anthropic token,
  same standing limitation as every runner task in this journal.
- **Filed to the backlog rather than fixed here (the `add_backlog_item` MCP tool errored
  "Stream closed" on every attempt when I tried to file it properly — noting it here instead
  so it isn't lost):** `setTaskFeature` (`lib/features.ts`, task 01, already committed) sets
  `tasks.featureId` on `PATCH /api/tasks/[id]` but never touches `mergeState`. Task 02's
  invariant ("`mergeState: null` ⇔ no feature") only holds for a task whose feature was set at
  *dispatch* (`lib/dispatch.ts`), so a task feature-assigned by hand afterward stays
  `mergeState: null` forever — indistinguishable from having no feature at all. Out of scope
  here (touches a task-01 file this diff never opens), but worth fixing before task 04 ships a
  merge-state chip, or that chip will silently omit itself for every hand-grouped task.

## 2026-08-21 — the feature entity (`lib/features.ts`, `features` table)
pm task `01-backend-feature-entity-schema-sync-api` from
`.pm/tasks/20260821-135656-feature-grouping-branches-parallel/`. A durable grouping that backlog
items and tasks link to, plus the branch name task 02 will create for real. Nothing here runs
`git`. Rules are in CLAUDE.md ("Features"); what belongs here is why the edges are where they are.

- **The grouping was already on disk, and that is the whole reason this is cheap.** For pm-planned
  work the group *is* the `.pm/tasks/<request>/` folder — it was sitting inside
  `backlog_items.source_path` and nothing ever parsed it out. So the sync derives one feature per
  request folder rather than asking anyone to re-state it, and on this repo that turned 34 existing
  backlog items into 11 features with **zero** ungrouped, on the first load, with no manual step.
  That retroactive path is the one that mattered: a grouping feature that only grouped work planned
  *after* the migration would have looked broken on every existing install.
- **A feature's name comes from the request's `index.md`, and `specTitle` could not be reused.**
  Its last resort is the *filename*, which is the word "index" for every request folder in the
  project — so `requestTitle` (`lib/pm-spec.ts`) is frontmatter title → first heading → folder name
  with the timestamp prefix stripped. The read goes through `readSpecFile` and is charged to the
  same scan byte budget as a spec's, because `index.md` is a file inside a tree an agent can write:
  a symlinked index must no more be able to name a feature after `~/.ssh/id_rsa` than a symlinked
  spec can put it in a row.
- **`featureSlug` is an allowlist because its output is a git ref**, and task 02 hands that string
  to `git` in the runner process. `[a-z0-9-]` only makes a leading `-` (an option), `..`, `~^:?*[\`,
  whitespace and a trailing `.`/`.lock` *unrepresentable* rather than filtered. The spec runs every
  minted name through **`git check-ref-format`** — the regex is my argument, git is the authority.
  Reverting the class to a whitespace-only replace turns four specs red, including that one.
- **The branch is immutable, and the cut is at a word boundary.** Renaming a feature (or editing
  its `index.md`) changes the name and never the branch — the ref may already exist. The word
  boundary is not cosmetic in the way it looks: on real data a blind 60-char slice produced
  `feature/…-so-it-reliably-updates-the-a`, a ref a human has to type. Found by looking at the
  eleven branches the real repo derived, not by a test.
- **A synced item's feature is file-owned (`FILE_OWNED_FIELDS`), and the alternative was worse.**
  I considered a `statusOverride`-style precedence flag and rejected it: status is the one thing
  *no file knows*, whereas the request folder genuinely does know the grouping, so a second owner
  would be inventing a conflict. Someone who wants a spec grouped elsewhere moves the file, or
  groups its **task**, which is freely assignable because nothing on disk re-derives that.
- **I removed a guard because its test could not fail, and that was the right call.** The sync
  first wrote `featureId ?? row.featureId` ("never clear a grouping we merely failed to derive").
  No falsification could make the accompanying test go red — because `ensureRequestFeature` resolves
  an already-derived folder *before* it consults the cap, so `featureFor` never misses a folder
  whose items are already grouped. The one state I *could* construct (a feature row deleted with FK
  enforcement off) made the fallback preserve a **dangling** id, i.e. actively wrong. So the write
  is a plain assignment, and the test was rewritten to pin the thing that is actually load-bearing:
  the **ordering** inside `ensureRequestFeature`. Moving the cap check up now turns three specs red
  (verified by moving it, and independently reproduced by the reviewer). This is the 2026-08-16
  lesson applied in the other direction — the fix for an unfalsifiable test is sometimes to delete
  the code, not to write a cleverer test.
- **A cross-project `featureId` is refused, never dropped.** Silently unlinking would hide the run
  from every grouped view; storing it would put this project's work on another repo's feature branch
  once task 02 merges. `POST /api/tasks` originally *coerced* a malformed `featureId` to null — a
  failure with no symptom — so it now goes through `parseFeatureRef` too, with
  `createAndStartTask`'s own check kept as the gate for non-HTTP callers.
- **drizzle-kit drops `ON DELETE` from an `ALTER TABLE ADD COLUMN`.** The generated `0004` shipped
  both new FKs as `no action` while the ORM said `set null` — silent drift, and `migrateDatabase`'s
  schema check only compares table/column existence so it would never have caught it. SQLite does
  accept the clause there; the SQL was hand-completed and a spec asserts the *committed migration's*
  behaviour (delete a feature with FKs on, expect the task to survive with a null). Re-running
  `db:generate` after the edit produces nothing, so CI's snapshot check is undisturbed. Verified by
  reverting the edit: that spec goes red.

### What the two reviews changed
- **The correctness review's best find had nothing to do with logic: `lib/features.test.ts`
  contained a literal NUL byte**, because I wrote `"\x00\x1f"` as raw bytes instead of an escape.
  Legal JS, all specs passing — and it made **git classify the whole 429-line file as binary**, so
  `git diff`, `git show` and any PR view would have rendered "Binary files differ" for precisely the
  file that validates the ref-injection defences. Fixed, and I scanned every file in the diff for
  raw control bytes rather than just the one that was reported.
- **`features` was in `EXPORTED_TABLES` with no test at all.** Now covered, and writing it corrected
  my own comment: the ordering binds **nowhere** today — export sets `foreign_keys = OFF`, and
  `control-center import` copies the archive's database file wholesale rather than replaying rows.
  My first version of that test claimed the opposite ("an archive is restored by replaying these
  same tables"), which would have been a confident lie in a comment. Both the test and
  `EXPORTED_TABLES`' own docstring now say plainly that the order is a documented invariant rather
  than a satisfied constraint, and the assertion that *does* bite is that a feature row and its
  branch survive the rebuild.
- **`createFeature`'s blanket `catch` was hiding real database errors** (non-blocking, taken
  anyway): it returned null for a unique-index conflict *and* for an FK violation, a full disk or a
  corrupt page — surfacing as a misleading 409 in the API and a silently ungrouped item in the sync.
  Now `.onConflictDoNothing()` + `changes > 0`, the same primitive the `backlogItems` insert uses,
  so only a conflict is absorbed and everything else throws where it can be seen. There is a spec
  that an FK violation throws; restoring the catch turns it red.
- Also closed the two coverage gaps the reviewer named: `MAX_BRANCH_ATTEMPTS` exhaustion (the 21st
  feature named "Collide" gets the id-suffixed branch, and all 21 stay distinct), and the
  scan-cap-inside-a-folder case — the folder the byte budget stops *inside* must still be reported
  as a feature, which is the entire reason the cap `break`s out of both loops instead of returning.
  Reverting that to the old early `return` turns it red.
- **The security audit came back PASS with no blocking findings**, having independently attacked the
  slug with live POSTs (`--upload-pack=…`, `../../../../etc/passwd\nHEAD`, a name with no Latin
  characters), confirmed the cross-project refusal is byte-identical for a real foreign id and a
  fabricated one (no existence oracle), and confirmed the `index.md` read inherits `readSpecFile`'s
  hardening and the shared byte budget. gitleaks/semgrep/`pnpm audit` findings were all pre-existing
  and in files this diff doesn't touch. It flagged, correctly, that `features.branch` is minted here
  but not yet consumed by any `git` invocation — so **task 02 is where this allowlist earns its
  keep, and is worth re-auditing then**.

### Verification notes
- Verified end to end over HTTP against the real dev app, not only by unit test: the 11 features and
  their branches, idempotency, the retroactive re-grouping, hand-made creation and duplicate-name
  disambiguation, `branch`/`sourceDir` being dropped from a POST body, the 409 on renaming a
  pm-derived feature, the 409 on reassigning a synced item, 400 on all three cross-project paths,
  404 for a feature addressed through the wrong project, and the owner-scoped task PATCH (via a
  temporary `user_local` task row, since every real task here belongs to a signed-in account —
  named `task_TMPVERIFY` and removed afterwards, along with every feature and item created).
- **A successful dispatch carrying a `featureId` was not exercised over HTTP** — `user_local` has no
  Anthropic token and `ALLOW_SHARED_TOKEN_FALLBACK` is unset, so the run route answers 412. What
  HTTP did confirm is that the refused run leaves the item `todo`, unlinked and still grouped; the
  row-storing and the before-any-row refusal are covered by `lib/dispatch.test.ts` against a dead
  runner port.
- **Both new route directories 404'd until a container restart, and the nested one needed its own.**
  `app/api/projects/[id]/features/` registered while `…/features/[featureId]/` did not, on the same
  restart — so the documented bind-mount watch gap can leave a route table *partly* updated, which
  reads as a routing bug. Restart again and check `.next/server/app-paths-manifest.json`.
- Suite 510 → 562. The `.next` volume was wiped before manual verification, per the standing rule
  about falsification passes poisoning the Turbopack cache.
- **Process note: this task was interrupted twice mid-flight and both times left debris worth
  checking for.** Once a falsification pass was killed *between* the edit and the restore, leaving
  `lib/data-transfer.ts` in its deliberately-broken state; once a resumed session re-added a
  `MAX_BRANCH_ATTEMPTS` test that an earlier turn had already written, so the suite briefly carried
  two specs for one behaviour. Both were caught by re-reading the working tree rather than trusting
  the plan. **After any interruption: diff the tree, and grep for the thing you are about to add
  before adding it.**
