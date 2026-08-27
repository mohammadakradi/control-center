# features

How work is grouped: the `features` entity, its branch rules, the merge-back lifecycle in the runner, managing feature groups, and the grouped UI.

<!-- Moved out of CLAUDE.md on 2026-08-24 to bring it inside its 20 KB budget (engineering rule 7). Content is verbatim; only the heading level and this header are new. -->

## Features (how work is grouped)
A `feature` is the unit work is actually organised around — several tasks and several backlog
items, one branch. `lib/features.ts` owns every rule; the routes under
`app/api/projects/[id]/features/` translate HTTP, the same split `lib/backlog.ts` uses.
- **For pm-planned work a feature costs nobody anything, because the grouping already existed
  on disk.** It was the `.pm/tasks/<request>/` folder, buried inside
  `backlog_items.source_path` and never read out. The backlog sync now derives one feature per
  request folder that holds at least one spec (`ensureRequestFeature`, keyed on
  `(projectId, sourceDir)` by a unique index, so it is a no-op on every load after the first)
  and links that folder's items to it. An empty request folder is a folder, not a feature.
- **The name comes from the request's `index.md`** — its frontmatter `title`, else its first
  heading — falling back to the folder name with the timestamp prefix stripped. Deliberately not
  `specTitle`, whose last resort is the *filename*, which is the word "index" for every request
  folder in the project. That read goes through `readSpecFile` like a spec's (O_NOFOLLOW,
  `nlink === 1`, regular files only, size-capped) and is charged to the same scan byte budget: a
  symlinked `index.md` must no more be able to name a feature after `~/.ssh/id_rsa` than a
  symlinked spec can put it in a row.
- **`features.branch` is a reserved name, and it is immutable.** `feature/<slug>`, minted from
  the name by `featureSlug` — an **allowlist** (`[a-z0-9-]`, cut at a word boundary, no leading,
  trailing or doubled dash), because this string becomes a **git ref** that task 02 hands to
  `git` in the runner process. The allowlist is what makes a leading `-` (which git reads as an
  option), `..`, `~^:?*[\`, whitespace and a trailing `.`/`.lock` unrepresentable rather than
  filtered. `lib/features.test.ts` runs the minted names through `git check-ref-format` — the
  regex is an argument, git is the authority. Renaming a feature (or editing its `index.md`)
  changes the name and never the branch: the ref may already exist, and moving it would orphan
  the work on it.
- **One branch per project** (`features_branch_unq`), since two features on one ref would merge
  each other's work. Colliding names get `-2`, `-3`… then the feature's own id; a lost race on
  the unique index is retried once with the id-suffixed form.
- **A synced item's feature is file-owned, so `featureId` is in `FILE_OWNED_FIELDS`** and a
  `PATCH` of it answers 409 naming the file. There is deliberately no `statusOverride`-style
  precedence flag for it: status is the one thing *no file knows*, whereas the request folder
  genuinely does know the grouping, so giving it two owners would be inventing a conflict.
  Someone who wants a spec grouped elsewhere moves the file — or groups its **task**, which is
  freely assignable, because nothing on disk re-derives a task's feature.
- **The sync writes the derived feature as a plain assignment, not `featureId ?? row.featureId`.**
  What keeps a grouped item grouped is that `ensureRequestFeature` resolves an already-derived
  folder *before* it consults `MAX_FEATURES_PER_PROJECT` — so reaching the cap strands only
  *new* folders' items and can't unglue the rest of the project. The fallback was tried first and
  removed: no test could be made to fail with it in place, and in the one state that *is*
  constructible (a feature row deleted with FK enforcement off) it preserved a dangling id.
  `lib/backlog.test.ts` pins the ordering by failing if the cap check moves up.
- **A cross-project `featureId` is refused on every path that accepts one** — dispatch, the task
  PATCH, and both backlog writers — via `parseFeatureRef`/`findFeature`, the stance
  `sourcePath`/`linkedTaskId` already get. Refused rather than dropped: silently unlinking would
  hide the run from every grouped view, and storing it would put this project's work on another
  repo's feature branch once task 02 merges. Addressing a feature through the wrong project
  answers 404, not 403, so ids can't be probed across projects.
- **`PATCH /api/tasks/[id]` is the only owner-scoped one** (`findOwnedTask`, so "not yours" ≡
  "doesn't exist", checked before the body is read). It takes `featureId` and nothing else — a
  task's status belongs to its run, its request text is what the agent was handed. The
  project-scoped feature routes have no auth, like every other project-scoped route here.
- **`MAX_FEATURES_PER_PROJECT` (500) counts every row**, not just open ones as the backlog's cap
  does: nothing closes a feature automatically, and the sync can create one per request folder on
  an unauthenticated GET, so this is what bounds a repo full of `.pm/tasks/` folders.
- `features` is in `EXPORTED_TABLES` **before** `tasks` and `backlog_items` (both carry a
  `feature_id`), so a grouping survives export/import. Both FKs are `set null` — closing out a
  feature must never delete the history of the work done under it. Note drizzle-kit **omits
  `ON DELETE` from an `ALTER TABLE ADD COLUMN`**, so `drizzle/0004_pretty_vapor.sql` was
  hand-completed after generation; a spec asserts the committed SQL, not the ORM's intent.
- The grouped UI is below ("Following one feature in the UI"). Nothing in `lib/features.ts` runs
  `git` — the branch it names is only created, based-on and merged-into by the runner (below).

### The feature branch: lifecycle and merge-back (runner)
Each feature has one real `feature/<slug>` git ref, and a feature-linked task's finished work
ends up merged into it. The *system* merge stays deterministic and never silent — but a real
content conflict now gets **one** shot at being resolved by the run's own still-live session
(below), and a merge that couldn't be *attempted* is retried automatically by the merge sweep.
`runner/worktree.ts` owns the git mechanics; `runner/session-manager.ts` wires them into
dispatch and `finalize()`; `runner/merge-sweep.ts` is the retry half; `lib/git.ts` holds the
hardened merge primitive.
- **A feature-linked parallel run always isolates, busy checkout or not.** `launchMode` gained
  a `feature` input: `canIsolate && (workdir || (parallel && (busy || feature)))`. Before this,
  isolation only kicked in when the checkout was already busy — so the *first* of N parallel
  siblings dispatched against a free checkout would land directly in it, un-isolated, with no
  branch to base on and nothing for the merge step to find. A non-parallel feature run is
  unaffected: it stays a plain checkout run, on purpose (next bullet).
- **On that first isolated run, `ensureFeatureBranch` creates `feature/<slug>` off the
  project's `defaultBranch`** (a plain `git branch <name> [<base>]` — never a checkout, so it
  never touches the working tree and is safe to run even while another session is live in that
  same checkout). Idempotent, and hardened against the one real race: two feature-linked tasks
  dispatched at once both find the ref missing and both attempt the create; `git branch` is
  atomic, so exactly one succeeds, and the loser's failure is swallowed once `branchExists`
  confirms the winner's ref is already there. Anything else (an unusable `base`) still throws.
  `ensureTaskWorktree` then takes an optional `baseRef`: the task's own `task/<id>` branch is
  created **at the feature branch**, not at the checkout's current HEAD — that's what gives
  every task of a feature (and the merge below) a common ancestor. `baseRef` only matters on
  first creation; reattaching an existing branch (continue, or a recreate after cleanup)
  ignores it, same as it already ignored HEAD.
- **On `done`, the merge-back runs *before* the task is sealed (`mergeOnDone`, called from
  `finalize()`), and where it runs depends on where the feature branch is checked out.**
  `mergeFeatureTask` (`runner/worktree.ts`) decides per attempt:
  - branch checked out **nowhere** → a **throwaway worktree of the feature branch** under the
    **OS tmpdir, not `WORKTREES_DIR`** (it must never count against `MAX_WORKTREES`),
    force-removed (plus a defensive `rmSync`) before returning either way;
  - branch checked out **in the project's main checkout** → the merge runs **there**, but only
    while no session is live in it (the caller passes `mergeInMainCheckout`). This was the
    single biggest source of bogus "conflict" rows: a checkout run leaves the feature branch
    checked out (the preamble tells it to work there), git refuses a second checkout of one
    branch, and the failed `worktree add` used to be recorded as a content conflict. Merging
    in place advances the user's checkout together with the branch — which is what a checkout
    sitting on that branch means — and `gitMerge` aborts clean on any failure;
  - branch checked out **anywhere else**, or the checkout is busy → `"blocked"`, retried later.
  It never touches the task's own worktree (still needed a moment longer to read the branch
  off), and never merges a branch with no commits of its own (`branchContained` pre-check —
  a `--no-ff` merge of an already-contained branch answers "Already up to date" and used to
  read as `"merged"` even for a run that committed nothing).
- **The actual merge (`gitMerge`, `lib/git.ts`) is `git merge --no-ff --no-edit <branch>`,
  aborting on any failure, and it classifies what happened.** `--no-ff` always leaves a merge
  commit — without it, the first task merged into a fresh feature branch would fast-forward
  with no merge commit while every later one (having diverged) couldn't, an inconsistency with
  nothing to do with the content. On failure `merge --abort` runs immediately, so no tree is
  ever left mid-merge, and the task's branch is never touched either way. `MergeResult.conflict`
  is decided **structurally, before the abort**: `MERGE_HEAD` exists only once a merge genuinely
  started and stopped needing resolution, so a refused merge (missing ref, dirty files in the
  way) can never read as a content conflict. Deliberately not `ls-files -u` through `runGit` —
  that helper maps empty output to `"Done."`, so emptiness there is unreadable (found by a spec
  that asserted a missing branch isn't a conflict and failed).
- **The outcome is recorded on the task row as `mergeState`** (`lib/db/schema.ts`; migration
  `drizzle/0005`) — now five states, and the column is plain text with no CHECK, so widening it
  needed **no migration**: `"pending" | "merged" | "conflict" | "blocked" | "no_commits"`.
  `"pending"` is set at **dispatch** (`lib/dispatch.ts`) the moment a `featureId` is attached
  — and by `setTaskFeature` when a task is grouped by hand *after* dispatch, which used to
  leave null forever (indistinguishable from ungrouped, so the chip silently omitted itself).
  `"conflict"` now means a **real content conflict only**; `"blocked"` is "couldn't be
  attempted" (retryable, nothing to resolve); `"no_commits"` is "the branch holds nothing to
  merge" — honest for a run that ended `done` without committing (its kept worktree still has
  the work; the log entry says so). A **non-isolated run stays `"pending"` forever** — the
  platform never system-merges one, so that is the honest answer, not a stuck one. `mergeState`
  is independent of the task's own `status`: a task can be `done` with `mergeState:
  "conflict"` at once — the agent's work finished; the system's merge of it didn't.
- **A real conflict gets one automatic resolve turn in the same live session, then the merge
  is retried — nothing is ever auto-picked.** On `conflict`, `mergeOnDone` records the state
  first (a cancel mid-resolve keeps the honest answer), then pushes `mergeResolvePrompt` into
  the session: merge the feature branch *into your branch* in your own worktree, reconcile
  both sides — never discard either — commit, no gates, no push. When that turn ends,
  `finalize()` re-runs the deterministic merge, which now fast-forwards content-wise; if it
  still conflicts, `"conflict"` stands, exactly as before. Bounded by
  `handle.mergeResolveAttempted` (one attempt per run, ever) and it costs one extra agent turn
  on the owner's token, logged in the transcript. The delicate part is turn accounting:
  a mid-turn `[[DONE]]` finalize pushes the prompt while that turn's own `result` is still in
  flight, so `mergeResolveSwallowResult` eats exactly that one stale result — otherwise the
  handler would re-attempt the merge before the agent had even seen the prompt and seal the
  task as `conflict` with the resolution still ahead of it. The stream-end finalize passes
  `resolve: "none"` (the input channel is closing; a pushed turn could never run).
- **`blocked` merges retry themselves: `sweepFeatureMerges` (`runner/merge-sweep.ts`)** runs
  at boot and from `promoteNext` — i.e. every time a project's checkout frees up, which is
  exactly when a merge blocked on that checkout can succeed (it passes
  `mergeInMainCheckout: true`; at that instant nothing is live there). It also **reclassifies
  from the object store**: any `blocked`/`conflict` row whose branch is now fully contained in
  the feature branch becomes `"merged"` (someone resolved it by hand — that is also what heals
  rows the old catch-all mis-recorded), or `"no_commits"` when the run's kept worktree is
  still dirty (marking that "merged" would hide uncommitted work). A `conflict` row with real
  divergent commits is **left alone** — it needs reconciling, not retrying on every sweep.
  Every state change writes a log event into the task's transcript; a chip that silently flips
  is a mystery. Bounded (`MAX_SWEEP_TASKS`), best-effort, and one task's git hiccup never
  stops the rest — or boot, or the queue.
- **A non-isolated (checkout) feature run gets an instruction-level guarantee only, and says so
  to the agent.** The platform can't system-merge a run sharing the user's own checkout, so
  `featureBranchPreamble` (`runner/session-manager.ts`, exported for its own spec) appends a
  line naming the feature and its branch to the dispatched prompt — resent on **every** launch
  (fresh dispatch, continue, and resume alike), since a fresh subprocess remembers nothing of
  an earlier one's instructions. Decided from `handle.worktree` (set, or not, by the
  isolate/queue/run branch before `launch()` ever runs — including the deferred "queue" case),
  not from `mode`, which would read "queue" forever even after a queued task is promoted and
  actually runs un-isolated. Degrades to an empty string if the feature was deleted mid-run
  (`featureId`'s FK is `set null`, so the task can briefly outlive the row) — naming a branch
  that no longer means anything would be worse than saying nothing.
- **No new hook or config exposure.** `gitMerge` goes through `runGit` (the existing
  `repoOpts`/`gitEnv`/`NO_HOOKS`/timeout wrapper); the temp-worktree creation/removal in
  `runner/worktree.ts` goes through that file's own long-hardened `git()`. Verified directly,
  not just inferred from sharing the wrapper: `post-merge` was already in `lib/git.test.ts`'s
  planted-hook set but only ever exercised via `gitPull`'s fast-forward; a real `gitMerge` call
  (prepared before the plant, like every other fixture command in that test) is now in it too.
- **Every new ref reaching git gets the same leading-dash guard the rest of the file already
  uses**, even where the value is provably safe today: `mergeFeatureTask`'s `featureBranch`
  always comes from `features.branch` (an allowlisted slug that can never start with `-`), but
  the function takes a bare string, so it's guarded anyway — defense in depth, not paranoia
  about a path that's actually reachable right now.

### Managing feature groups (create, rename, close out, delete)
Features were readable everywhere and editable nowhere: the sync derived them, a picker assigned
work to them, every list rendered them as headings — and there was no way to add one, fix a name,
or retire one. `components/FeatureManager.tsx` (a full-width **Features** card on project detail)
is that half; `deleteFeature` in `lib/features.ts` is the only new rule, and `DELETE
/api/projects/[id]/features/[featureId]` only translates it.
- **Delete ungroups; it never destroys.** Both FKs are `set null` and `foreign_keys` is ON, so
  tasks (with their transcripts) and backlog items survive the row that grouped them. Deleting is
  the honest verb for "this grouping was a mistake" — `status: done` keeps the heading forever as
  collapsed history, which is right for finished work and wrong for a group nobody wants.
- **`mergeState` is cleared by hand, because the FK can't.** `ON DELETE SET NULL` only touches
  `feature_id`, so without this an ungrouped task keeps `blocked`/`conflict` — breaking the
  invariant `setTaskFeature` documents (`mergeState` null ⇔ no feature) and rendering a chip that
  promises a retry `sweepFeatureMerges` can never perform, since it joins *through* `featureId`.
  Done in one transaction with the delete so neither half is observable alone.
- **A sync-derived feature is refused (409), not deleted.** `ensureRequestFeature` re-derives one
  per `.pm/tasks/<request>/` folder on the next backlog load, so a delete would appear to work and
  then silently undo itself. Same stance renaming one already gets, and the message names the
  folder to remove instead.
- **A feature with a live task is refused (409).** That run's merge-back reads `featureId` when it
  finishes (`mergeOnDone`) and targets this feature's branch; pulling the row out from under it
  would silently drop the merge and leave committed work on `task/<id>` with nothing pointing at
  it. Finished/failed/cancelled runs never block it — history is not a reason to keep a grouping.
- **It never runs git.** The `feature/<slug>` ref and every commit on it are untouched; nothing in
  `lib/features.ts` has ever executed git and this didn't change that. The response and the
  confirmation dialog both say so, because "delete" on a thing spanning several tasks reads as
  "delete the work".
- **The DELETE response returns the backlog-item count and *not* the task count.** A backlog item
  is documented as shared install-wide, so counting them discloses nothing; a task is private to
  whoever ran it (`lib/task-access.ts`) and this route has no auth, so an aggregate over
  everyone's tasks would be a new cross-user disclosure. `backlogCountsByFeature` exists for the
  same reason — the card says "task history stays, ungrouped" with no number.
- **Project-scoped like every sibling route, which is what bounds a destructive unauthenticated
  verb.** `findFeature(projectId, featureId)` means a feature addressed through the wrong project
  answers **404**, so ids can't be probed across projects and nothing can be deleted through a URL
  it doesn't belong to. The wider no-auth gap is the one documented for the backlog routes; it
  wants the same fix, not a special case here.
- **`featureRowActions` (`lib/ui.ts`) decides what a row offers**, and it does *not* consult live
  tasks — that refusal depends on rows a shared page can't scope to the reader and changes second
  to second, so it stays a server 409 surfaced as an error **on the row that was clicked**.
- **The "why you can't edit this one" note is card-level, not per-row** (`FILE_OWNED_FEATURE_NOTE`).
  It began as a sentence on every derived row, which reads fine for one and is a wall of text for a
  pm-planned project — measured on this repo, all twelve features were derived, so the list carried
  twenty-four lines of the same explanation. The **folder path** varies per row and stays there;
  the rule is said once, and only when a derived row is actually on screen.

### Following one feature in the UI
Three surfaces group work by feature — `/backlog`, project detail's **Features** card and
`/tasks` (project → feature) — so one feature's development can be read on its own. `components/
FeatureGroup.tsx` is the single heading on the first and last of those; the grouping and
merge-state rules are pure functions in `lib/ui.ts` with specs, because `pnpm test` cannot reach
`components/`.

**Project detail is one card, not two.** It used to carry a *Features* card and a separate *Task
history* card, and that split made the reader join the two up by eye — a feature **is** several
tasks, so "the groupings" and "the runs" were never independent things. `FeatureManager` now owns
both: every feature is a row that expands to its own runs, and `components/TaskHistory.tsx` is
gone (it had no other consumer). `GroupedTaskList` stays, because `/tasks` still groups a
cross-project list that way.
- **`featureWorkRows` (`lib/ui.ts`), not `groupByFeature`, drives that card**, and the difference
  is the point. `groupByFeature` only emits a group for a feature something is filed under, which
  is right where a heading with nothing under it would be noise. Here the features *are* the
  list — the card manages them — so a feature with no runs still needs a row. Measured on this
  install before building it: two projects had **24 and 12 features with zero linked tasks**
  (features group *backlog items*; a task only gets a `featureId` from the composer's picker or
  from running a linked item), so "only features with work" would have rendered an empty card
  above a pile of ungrouped runs.
- **A row with no runs gets no chevron.** It reads `No tasks yet` with a title naming the two ways
  to change that. A disclosure that expands into nothing is worse than no disclosure, and on the
  numbers above it is the *common* row rather than an edge case.
- **`featureRowDefaultOpen` is deliberately not `featureGroupDefaultOpen`.** That one answers the
  same question for the backlog and `/tasks`, where every group has rows by construction, so
  "active → open" is safe there and would open two dozen empty rows here. The rule: nothing to
  show, nothing to open; otherwise the old defaults are reproduced (active open, closed folded as
  history, ungrouped open) and **a live run overrides all of it** — a task in flight is the one
  thing worth unfolding a closed feature for.
- **The card holds toggle *overrides*, not the whole open/closed state.** Every write calls
  `router.refresh()` and a row's default can legitimately change between renders (a run ends, a
  feature is closed out), so storing the full state would freeze rows at mount. Not persisted, for
  the same reason `FeatureGroup` isn't: a remembered collapse is a filter, not a fold.
- **The per-row task count is the reader's own runs.** It comes from the page's already
  `ownedBy`-scoped history, because a task is private to whoever ran it while a feature is shared
  — the same reason `backlogCountsByFeature` is a server aggregate. Same data the old Task
  history card showed; only the arrangement changed.
- **The task lists are rendered on the *server* and handed down as elements, and that is a
  privacy decision.** `FeatureManager` is a client component, so a `TaskRow[]` prop would
  serialize whole rows across the RSC boundary into the browser — `workdir`, `sessionId`,
  `requestText`, `error` and all — for a list that renders six fields. The first cut of this
  merge did exactly that, and the security audit found `TaskList`'s code in the client chunks.
  The page now builds `taskPanels` (feature id → rendered `<TaskList>`), `taskCounts` and
  `openByDefault`, so what crosses is rendered output plus two numbers and a boolean. Verified by
  A/B: reinstating the client-side import puts `TaskList`'s empty-state literal back into
  `.next/static/chunks` (1 file), removing it takes it to 0. `openByDefault` is computed server
  side for the same reason — deciding it in the client would mean shipping every task's status.
  This is the "client island in a server tree" composition, and it keeps the page consistent with
  `parallelOffer`, where only a boolean crosses.
- **`mergeChipProps` closes the same hole one level down, and it was a live leak.** Moving the
  task list server-side doesn't help if a *row* then hands a whole `TaskRow` to a client
  component — and `TaskList` did: `<MergeStateChip task={t} />`. `MergeChipInput` is structural,
  so a fat row type-checks. Measured with canary values planted in the columns: `workdir`,
  `sessionId` and `requestText` all came back in the served HTML (3/3) for a row that renders six
  fields, and 0/3 once the row went through `mergeChipProps`. It is a **function, not a comment**,
  because the object it returns can be pinned *by width* — `lib/ui.test.ts` asserts its exact key
  set, so a column added to `tasks` can't widen what crosses the boundary without a spec going
  red. Same stance as `listBacklog`'s `linkedTask` projection. `BacklogItemRow`'s call site was
  already safe: it passes that narrow projection, not a row.
- **`groupByFeature` returns `null` when no row has a feature, and that null is the contract.**
  Every caller then renders the flat list it always rendered, so an install that has never used a
  feature is byte-identical to before — grouping everything under one "No feature" heading would
  add a level of hierarchy that conveys nothing. The ungrouped bucket sorts **last** and exists
  only when something is in it. A row whose `featureId` doesn't resolve lands there rather than
  vanishing: `feature_id` is `set null`, so a row can briefly outlive its feature and work must
  never disappear from a list because its grouping did.
- **Every feature group is a disclosure.** `FeatureGroup` is a client component holding the
  open state; the heading (name + chevron, a real `<button>` with
  `aria-expanded`/`aria-controls`) always renders, the rows fold under it. Active features and
  the ungrouped bucket start open, closed features start collapsed
  (`featureGroupDefaultOpen`, spec'd) — their rows are history that would otherwise push live
  work below the fold. Deliberately **not persisted**: a remembered collapse is a filter, not
  a fold. The chips and the count stay outside the button — the branch chip is a string to
  copy, and folding it into the button would make it unselectable without toggling.
- **A row's chip goes through `mergeChipView` (`lib/ui.ts`), and `pending` is no longer one
  word.** The old label "Not merged" was read by a real user as a verdict on work that was in
  fact sitting *in* the feature branch (a checkout run's agent commits there directly). Now:
  a cancelled/failed run whose merge was never attempted gets **no chip**; a live run that may
  isolate reads "Merges when done"; everything else reads "In checkout", with a tooltip
  explaining the agent commits directly. Recorded outcomes render as themselves — labels,
  tones and tooltips all come from `MERGE_STATE_LABEL`/`mergeStateTone`/`MERGE_STATE_TITLE` in
  `lib/ui.ts` (the tooltips moved out of the component so the whole vocabulary is testable).
- **`featureMergeSummary` never counts `pending` or `no_commits`, and does count `blocked`.**
  A checkout-bound feature run stays `pending` forever by design (above), so aggregating it
  would put a permanent "N pending" on every heading — a queue that never drains. `blocked`
  IS that queue's opposite: the sweep genuinely drains it, so "N waiting" earns its chip.
  `no_commits` is terminal with nothing anyone will do about it. A spec pins all of it.
- **A merge conflict is toned `warn`, not `danger`** — the merge failing is not the *run*
  failing (a task can be `done` with `mergeState: "conflict"`), and reserving `danger` for a
  failed run keeps the two tellable apart in a list holding both. `blocked` is `muted`, not
  `warn`: it needs nothing from the user, and a caution tone would summon them to a job the
  sweep already owns.
- **The `feature/<slug>` branch chip wraps and is never truncated.** It is the string a user has
  to type into `git checkout`, so a truncated prefix is useless and a `title` tooltip is
  unreachable by keyboard. It is `min-w-0` + `break-all`, **not** `shrink-0` — at `featureSlug`'s
  60-character cap a rigid mono chip forced 95px of horizontal page overflow at 390px (measured;
  164px at 320px).
- **The feature pickers take the project's features as a prop, not a fetch.** Both hosts
  (`NewTaskForm` on project detail, `AddBacklogItem` on the backlog) render inside server
  components that already hold the rows, so `GET …/features` would buy a loading state for data
  already on screen. The route stays for other consumers. Closed features are offered by neither
  picker — new work must not land on a branch shown everywhere as finished — while still
  appearing as groups in every list.
- `listBacklog`'s `linkedTask` projection grew `mergeState` alongside `id` and `status`. That a
  run happened and how it ended is not the private part; the transcript is. A spec `deepEqual`s
  the whole object, so a fourth column can't reach a shared list unnoticed.
