# log releases

Dated log of the release/update path — the lock, and getting a published release to a running window.

Part 2 of 2.

<!-- Split out of a single 232 KB `.swe/notes.md` on 2026-08-24, which was read in full at the start of every request (engineering rule 10). Entries are verbatim and in date order; only this header is new. -->

## 2026-08-23 — a published release actually reaches a running window, and feature groups are manageable

Two independent halves, one task. Both started from the same complaint: "I haven't seen a new
release notification after several releases, and the update button doesn't work correctly."

**The notification failure was three bugs, not one, and only one of them was the one I expected.**
- `UpdateBanner` fetched `/api/updates` exactly **once, on mount** — and it mounts in
  `app/(app)/layout.tsx`, a persistent App Router layout that client-side navigation never
  remounts. On a window left open (which the Mac app *is*) the check ran when the window opened
  and never again. This is the whole "several releases went by" story.
- The server memoized GitHub's answer for **six hours**, so even a reload could be served stale.
- `control-center start` is the only thing that runs `check_and_update`, and
  `ControlCenter.swift` only calls it when nothing already answers on 7373/3001. Evidence on the
  user's own install: server up for a day, and `logs/update.log` + `run/update.status` **never
  written** — i.e. the Update button had never once run there. That is why "stop and start in the
  terminal" was the only thing that worked.

**And a fourth bug I did not expect, which is the "button doesn't work" half.**
`.github/workflows/release.yml` triggers on `release: published` but uploads the assets at the
**end** of the run, after typecheck/lint/test/build/pack. So for several minutes every release
`/releases/latest` reports a tag whose `control-center-<v>.tar.gz` does not exist —
`apply_update`'s `curl -f` 404s and the attempt dies. **Every release had this window.** It also
explains why a later terminal `stop`/`start` "worked": by then the upload had finished. Fixed by
gating on the asset in both halves (`isInstallable` in lib/updates.ts, `fetch_latest_release` in
control-center.sh).

Three things I got wrong on the way, all caught by tests rather than by reading:
- **Order matters: compare versions first, *then* check the asset.** Screening in
  `fetch_latest_release` made an older assetless release read as "still publishing" instead of
  "already up to date", and `update` exited 1 where it had exited 0. Ten of sixteen CLI specs went
  red at once — including the suite's own `up-to-date` fixture, which is exactly the shape a fork
  or a hand-rolled payload has.
- **`x=$(f)` is a subshell**, so the first cut — return the tag on stdout, put the reason in a
  global — had every caller reading a stale flag. `fetch_latest_release` now sets globals and
  prints nothing, and says so in a comment, because the bug is invisible at the call site.
- **`grep -qF`, not a regex**, since `CC_REPO` can name a fork whose tag is attacker-chosen; and
  never `grep -P` (BSD grep exits 2, which an `if` reads as "no match" — the trap `pack.sh`'s own
  guard was written for).

**`?force=1` needed a floor before it needed a button.** `GET /api/updates` has no auth and is
reachable over loopback from inside the container where a task's Bash tool runs, so an unbounded
force is a way to burn the unauthenticated 60/hour GitHub budget and leave *everyone's* honest
check answering `rate-limited`. `FORCE_FLOOR_MS` lives in `checkForUpdate`, not the route, so no
caller can skip it; verified by hammering the real dev server — six forced requests, one identical
`checkedAt`. Serving the cache inside the floor is honest rather than a refusal, which is why the
Settings card puts "Last checked …" on screen: without the timestamp a cached reply is
indistinguishable from a dead button.

**Deliberately not fixed: the Mac app attaching to a live server still skips the update check.**
Making the attach path run `control-center start` would apply a release unattended while the
window is loading — the same class of surprise being complained about. With the in-app poll the
window tells you and you choose. Documented in CLAUDE.md as a non-goal rather than left implicit.

**Feature groups: the only genuinely new rule is `deleteFeature`, and its subtle part is not the
delete.** Both FKs are already `set null`, so ungrouping is free. What the FK *cannot* do is clear
`tasks.mergeState` — and the invariant the rest of the codebase relies on is "`mergeState` null ⇔
no feature", because `sweepFeatureMerges` joins *through* `featureId`. Without the explicit clear,
a deleted feature leaves ungrouped tasks carrying `blocked`/`conflict` forever: a chip promising a
retry nothing can ever perform. Sabotage-verified (drop the clear → that spec alone goes red).
Two refusals, both 409: a pm-derived feature (the next backlog load re-derives it, so the delete
would silently undo itself) and a feature with a live run (its merge-back reads `featureId` on
finish, so pulling the row would drop the merge and orphan committed work on `task/<id>`).

**The delete response returns the item count and not the task count**, which is the one privacy
decision here: backlog items are documented as shared, tasks are private (`lib/task-access.ts`),
and this route has no auth — so an aggregate over everyone's tasks would be a *new* cross-user
disclosure on an unauthenticated endpoint. Same reason `backlogCountsByFeature` counts items only.

**A UI note worth keeping: the per-row explanation had to become a per-card one.** "This feature is
planned in `.pm/tasks/…`, its name comes from index.md, deleting it here would only bring it back"
reads fine on one row and is a wall of text on a pm-planned project — measured on this repo, all
twelve features are derived, so the list carried twenty-four lines of the same sentence. The folder
path varies per row and stayed; the rule moved to one paragraph under the list, shown only when a
derived row is actually on screen. Caught by screenshotting the real page, not by reading the JSX.

Verified end to end over HTTP against the real dev app, not only by unit test: create → rename
(branch unchanged) → close out → reopen → delete; 409 on deleting and renaming a pm-derived
feature; 404 on addressing a feature through the wrong project (no cross-project id probing); and
a real backlog item surviving its feature's deletion with content intact and `featureId` null. The
new shell function was probed against the real GitHub API with a faked 0.1.0 install
(`LATEST_TAG=v0.9.0 LATEST_INSTALLABLE=yes verdict=newer`), which is what proves the asset gate
doesn't break the happy path.

### 2026-08-23 (round two) — the report card had to explain itself, and a "Done" task wasn't

Follow-up on the same task, from a screenshot: the change report card showed a **"Create fix
task"** button with nothing anywhere saying why one was needed, and the task carried a green
**Done** chip while its transcript was still growing. Two different bugs; only one of them is
fully fixable in this task, and being clear about which is the point of this entry.

**The button that couldn't explain itself.** `reportHasFindings` (`lib/ui.ts`) was a boolean over
the whole report blob, driving a CTA. Two consequences, both real: a report describing bugs it had
already *fixed* matched `bugs?` and got the button; and because the decision was a boolean, the UI
had nothing to render as a reason. Replaced with `fixTaskReasons`, which returns
`{label, evidence}[]` — so the button and its explanation come from one list and cannot disagree.
No reasons → no button. Details in CLAUDE.md; three things worth keeping here:
- **Per line, not per blob.** "no outstanding issues" contains `issues`, which used to light up the
  findings signal for an entire clean report. A line is also the only thing that can be *quoted*.
- **Severity beats all-clear on the same line.** `[Medium] looks good overall, but the count
  leaks.` is a grading, not reassurance — the reverse precedence loses real findings.
- **It is still prose-guessing, and showing the evidence is what makes that acceptable.** The
  heuristic still fires on a "## Bugs found…" heading about fixed work. The difference is the user
  sees the line and can ignore it, rather than being handed a silent verdict. There were **no
  specs at all** before; there are eight now, including that exact false positive.

**Done-while-running.** Traced properly rather than guessed. `classifyTurnEnd`
(`runner/completion.ts`) is the pause detector, and `session-manager.ts` only consults it when a
turn ends with **no** gate and **no** marker. So:
- The half I fixed: `WAITING_RE` never matched *"both review agents are still running"* — the
  sentence doesn't mention waiting at all. `IN_FLIGHT_RE` does, on the no-marker path, and the new
  spec goes red if it's removed (verified by reverting).
- The half I did not, deliberately: a trailing `[[DONE]]` bypasses classification entirely, so a
  report that admits outstanding work still seals the task; and `record()` keeps appending events
  after `finalize()` writes `end`. **The cheap patch is a trap** — running `WAITING_RE` at the seal
  point looks obvious and is wrong: measured, it matches *"Committed on feat/x. I'll wait for your
  approval to push."* and *"All tests pass. Waiting for your go-ahead."*, both finished reports, so
  it would nudge real completions into a loop. That measurement is the whole reason `IN_FLIGHT_RE`
  is a separate, much tighter pattern instead of an extension of the old one. Filed as
  `bli_9119b0b6` (platform: track live background children structurally) and `bli_dd973b87`
  (agent rules: don't open the report gate while reviewers are still out).

**And the honest part: the root cause was mine.** The report in that screenshot was submitted to
the gate while both review agents were still running — and when they did return, each had a
blocking finding (a cross-user task-count leak in the DELETE 409, and a concurrency bypass of the
update check's rate floor). Both were real, both were fixed, and both were found *after* the user
had already been shown a report calling the work complete. Hence `bli_dd973b87`.

**Verified in a browser, not only by unit test.** Both directions of the callout were driven
through headless Chrome against the dev app on a throwaway task row (inserted into the dev DB,
re-homed to `user_local` because `findOwnedTask` correctly 404s a signed-out view of someone
else's task, then deleted — zero residue confirmed): a findings report renders the amber callout
with four labelled, quoted reasons and the button inside it; a clean report renders neither.
The negative case was also confirmed against a *real* existing report (`task_5f294c7f`), which
has no findings and correctly shows nothing.

**Round-two review outcome.** The correctness reviewer returned **PASS, no blocking findings**,
having verified by *reversion* rather than by reading — it reverted each changed module in turn
and confirmed every new spec goes red, and it timed both new regexes against multi-MB adversarial
inputs (single-digit ms, linear growth, no catastrophic backtracking). Three non-blocking items,
all taken:
- **`resetUpdateCache()` mid-flight didn't hold.** A fetch already on the wire wrote its answer
  into the cache *after* the reset, silently repopulating it. Not production-reachable (nothing
  outside the specs calls it), but a half-working test seam makes every later spec
  order-dependent, so it gets pinned like anything else: a `generation` counter, bumped on reset,
  and `remember()` only writes when its era is still current. The new spec goes red if the guard
  is removed.
- Two stale references to `latest_release` (renamed `fetch_latest_release`) in test comments.
- One spec ("an assetless release that isn't newer still reads as up to date") **passes against
  the pre-gate script too**, because what it pins is an *ordering* — version compare before asset
  check — that a draft of this fix got wrong. Left in place with a note saying exactly that, so
  the next person auditing spec value by reverting doesn't read it as dead.

The security auditor's first run died on an API error while composing its final message (it had
completed 58 tool calls), so it was re-run rather than skipped — reporting without a security
pass is the mistake this round exists to correct.

**Round-two security audit: two blocking findings, both fixed.** (The first audit run died on an
API error while composing its report, so it was re-run rather than skipped.)

1. **The asset gate was still spoofable from the release body — and that was a denial of service,
   not just a wrong answer.** My "tighter" fix matched the full download URL instead of the bare
   filename, and the audit simply put that URL in the release `body`. Worse than a bad answer:
   `check_and_update` runs on **every** `control-center start`, and `apply_update` ends in `die`,
   so a fork whose notes mention the URL stopped the install from starting at all. Two fixes, and
   the second is the more valuable one:
   - Anchor on the **unescaped `"browser_download_url": "` key**. The insight is JSON escaping,
     not specificity: every quote inside a string field arrives as `\"`, so a body quoting the key
     can never produce the bare quotes the pattern needs. Verified against a forged payload, and
     the fixture now carries all three spoof attempts (filename, URL, full key/value pair). Both
     `": "` and `":"` spacings are tried, because the anchor now depends on GitHub's formatting
     and a compacted payload would refuse every update *forever* — failing safe but silently.
   - **A failed update must never stop the launch.** `apply_update` now runs in a subshell on the
     `start` path, so its `die` ends the attempt rather than the boot. This needed no attacker at
     all: a flaky network during the download did the same thing. `control-center update` keeps
     exiting non-zero — a command whose job is to update should. My own new spec caught a real
     consequence of the repo-scoped URL while I was writing it: the fixtures' `o/r` asset URLs no
     longer satisfied a gate built from `$REPO`, which is correct and now set via `CC_REPO`.
2. **Bidi overrides in the quoted evidence.** `evidenceOf` now strips `\p{Cc}`/`\p{Cf}`, with real
   whitespace converted to a space *first* so stripping can't glue words together, plus `dir="ltr"`
   on the span. Verified in a browser with the best evidence I got all task: the *same* planted
   line renders "…the log **no security** in plain text" in the markdown body and "…the log
   **ytiruces on** in plain text" in the callout — the attacker's reading versus the truth, side by
   side in one screenshot. That also proves the markdown body has the same exposure; it is
   pre-existing and out of scope, filed as `bli_81e3ed7c`.

Two non-blocking robustness items also taken: `evaluate` now requires `typeof tag_name ===
"string"` (a numeric `tag_name` from a non-GitHub `CC_REPO` threw *outside* the try/catch, i.e. a
500 from a route documented as never failing), and `checkedAgo` no longer renders "NaN days ago".

Traps worth remembering from this round, both self-inflicted and both caught by the suite:
- **Never paste bidi/control characters as literal bytes into source.** U+2028/U+2029 are JS line
  terminators, so a literal one inside a character class ended the regex and esbuild reported
  "Unterminated regular expression". Use `\uXXXX`. The same bytes also make a shell heredoc
  unusable (the tool rejects NUL), so the specs were written via an escaping pass.
- A test expectation asserted the *wrong* behaviour (that a zero-width space should keep two words
  apart). It shouldn't: a ZWSP separates nothing, so removing it correctly closes the gap — the
  distinction the two-pass strip exists for. Fixed the spec, not the code.

**One unexplained flaky test, stated rather than buried.** During final verification a single full
run reported `pass 673 / fail 1`. It has not reproduced: 12 subsequent full-suite runs were clean
(9 idle, 3 deliberately racing a concurrent `pnpm build`, since the failing run overlapped one),
plus 8 targeted runs of the two most timing-sensitive files (`infra/release/control-center.test.ts`,
which spawns real overlapping processes with a `sleep 2` curl stub, and `lib/updates.test.ts`,
whose new coalescing specs use timers). I did not capture the test's *name* before the output
scrolled, so I cannot say which one it was — the honest position is that the suite has an
intermittent failure at roughly 1-in-13 that I could not localise, most likely in the
process-concurrency lock specs, which predate this task. Not a blocker for this change; worth
capturing the name next time it appears (`pnpm test 2>&1 | tee` and keep the file).

### 2026-08-24 — features and tasks were never two things; the page now says so

User feedback on the shipped card: *"features and tasks are not splitted. actually each feature
will be done by several task. so there is no need to have two separated sections for them."*
Correct, and the split was mine — I added a Features card **above** an existing Task history card
that already grouped by feature, so the page derived the same grouping twice and left the reader
to join them by eye. One card now: every feature is a row that expands to its own runs.
`components/TaskHistory.tsx` is deleted (it had no other consumer); `GroupedTaskList` stays for
`/tasks`, which groups a cross-project list.

**The measurement that shaped the design, taken before writing any of it.** On this install:

| project | features | backlog items linked | tasks linked |
|---|---|---|---|
| Award Maven | 24 | 43 | **0** |
| (second) | 12 | 39 | **0** |

Features group *backlog items*; a task only gets a `featureId` from the composer's picker or from
running a linked item. So "one row per feature that has tasks" — which is what `groupByFeature`
gives you — would have rendered an **empty card above 44 ungrouped runs**. Three consequences:
- **`featureWorkRows` is a new function rather than a reuse.** `groupByFeature` only emits a group
  for a feature something is filed under, which is right for the backlog and `/tasks` where a
  heading over nothing is noise. Here the features *are* the list, so a feature with no runs is a
  real row. Both keep the same two invariants (ungrouped last and only when non-empty; an
  unresolvable `featureId` falls into it rather than vanishing).
- **A row with no runs gets no chevron**, and says `No tasks yet` with a tooltip naming the two
  ways to change that. Given the table above this is the *common* row, so a chevron opening an
  empty box would have been the dominant experience.
- **`featureRowDefaultOpen` is deliberately not `featureGroupDefaultOpen`.** The old rule
  ("active → open") is safe only where every group has rows by construction; here it would have
  opened two dozen empty rows. New rule: nothing to show, nothing to open — otherwise reproduce the
  old defaults, with a **live run overriding everything**.

**Toggle state is overrides-only, and that is a bug I avoided rather than fixed.** Every write in
this card calls `router.refresh()`, and a row's default legitimately changes between renders (a run
ends, a feature is closed out). Holding the full open/closed map would have frozen rows at mount;
holding only deliberate toggles lets untouched rows keep answering the default. Not persisted, same
reasoning as `FeatureGroup`.

**Verified in a browser against the real project, not just by unit test**, by temporarily
re-homing 7 tasks to `user_local` and linking 4 of them to the first-rendered feature (originals
saved to a file first, restored afterwards, and the baseline re-asserted: 0 linked, 0 owned by
`user_local`, 44 tasks, 24 features). Confirmed: the header count, a chevron + `4 tasks` + real
task rows with Done badges under the feature, 23 rows reading `No tasks yet` with no chevron, the
`No feature` bucket last with its 3 runs, the pm-derived note once at the foot, and **no second
card on the page**. The signed-out view correctly shows `0 tasks` — tasks are owner-scoped and the
local workspace owns none of them, which is also why the per-row count is documented as *the
reader's own* runs.

Also swept two live docs that named the deleted component: `TaskList`'s own doc comment and the
`TaskHistory` row in `.fe/design-system.md` (struck through with the reason). Left `.fe/notes.md`,
`.fe/test-scenarios/` and `.pm/tasks/` alone on purpose — those are dated records of what happened
at the time, and editing them would falsify history rather than update a catalog.

**Round-two review of the merge: PASS on correctness, and one real regression I had introduced.**

The correctness reviewer found no blocking issues and verified the new `lib/ui.ts` specs by
*mutation* — breaking each invariant in turn and confirming the matching spec went red, with no
vacuous ones. It also disclosed that a chained `git` command of its own had reverted `lib/ui.ts`
and that it had reconstructed the file; I verified that independently before trusting it (one of
each symbol, `git diff` showing +66 and **zero** deletions, 682 specs green). The only thing
actually lost was a pre-emptive move of `ACTIVE_STATUSES` above its first use — and since the
reviewer had separately confirmed there is no temporal-dead-zone hazard (the reference is inside a
function body, evaluated long after module init, exactly as five other call sites do it), I left
the move out rather than churn the diff for a non-issue.

**The security audit's finding is the one that mattered, and it was mine.** Making `FeatureManager`
— a client component — import and render `TaskList` meant every `TaskRow` crossed the RSC boundary
into the browser: `workdir`, `sessionId`, `requestText`, `error`, for a list that renders six
fields. The auditor didn't assert it, it measured it, finding `TaskList`'s code in the compiled
client chunks. Owner scoping meant no *other* user's rows leaked, which is why it was non-blocking
— but it needlessly widened what a same-origin XSS or a bad browser extension could scrape, and it
contradicted this page's own minimization elsewhere (`parallelOffer` ships one boolean precisely so
nothing about whose task holds the checkout crosses).

Fixed by inverting the composition: the **page** now renders each feature's `<TaskList>` and hands
`FeatureManager` a `taskPanels` map of elements, plus `taskCounts` and `openByDefault`. Rendered
output crosses, not source rows. `openByDefault` moved server-side for the same reason — computing
it in the client would have required shipping every task's status to do it.

**Proved by A/B rather than asserted**, after a first attempt at a detector failed honestly: the
`page_client-reference-manifest.js` does *not* list `TaskList`, but that manifest only records
`"use client"` boundaries, so it cannot see a plain module inlined into the client bundle — it was
the wrong instrument and would have "confirmed" the fix either way. Grepping the chunks for a
literal unique to `TaskList` (`"No tasks yet."`) with the client import reinstated gives **1** file;
with the fix, **0**. The three remaining files carrying task-row markers are pre-existing client
components (`Toaster`, `ActivityBadge`, `TaskLiveView`).

Also took the reviewer's two cosmetic notes: the ungrouped row's count moved outside its button
(matching the feature rows and `FeatureGroup`'s documented rule, and it became its own
`UngroupedRow` component rather than a second near-duplicate branch in a long map), and a row's
task panel is now hidden while that row is being renamed. Re-verified in a browser after the
refactor — byte-identical rendering, which is the point: the composition change is invisible to the
user. Dev DB re-homing repeated and restored, baseline re-asserted (0 linked, 0 `user_local`, 44
tasks, 24 features).

### 2026-08-24 — the merge review, and a leak found one level below the one I'd just fixed

Both agents returned **PASS with no blocking findings** on the merged Features card. Four
non-blocking items; two were worth acting on and two were not, and the split is the interesting
part.

**Acted on — `MergeStateChip` was still taking a whole `TaskRow`.** The correctness reviewer
spotted this as "the same class as the `taskPanels` refactor, one level down", and it was live.
`MergeChipInput` is `{mergeState, status, parallel?}`, but it is *structural*, so
`<MergeStateChip task={t} />` type-checked with a full row — and `MergeStateChip` is a client
component, so every column went into the page's HTML. Measured rather than assumed: canaries
planted in `workdir`, `session_id` and `request_text` on a scratch task came back in the served
HTML **3 of 3**, and **0 of 3** after routing the row through the new `mergeChipProps`. The chip
and the row still render identically (asserted: `mergeChipView(mergeChipProps(row))` deep-equals
`mergeChipView(row)`).

The shape matters more than the fix. A comment saying "don't pass the whole row" would have been
one edit away from untrue, so this is a **function whose return value is width-pinned by a spec**:
`Object.keys(...).sort()` must equal exactly `["mergeState","parallel","status"]`. A column added
to `tasks` therefore cannot widen the RSC boundary without a test going red. `parallel` is
normalised to `null` rather than left `undefined`, because the key set is asserted exactly and
absent would drop the key. `BacklogItemRow`'s call site needed nothing — it already passes
`listBacklog`'s narrow `linkedTask` projection, which is the same idea arrived at independently.

**Acted on — the doubly-empty card.** With no features *and* no runs, the merged card answered
only half the question ("No features yet"), where the two-card layout had said both. Merging two
surfaces must not quietly drop one of their empty states; the copy now names both and what to do
about either.

**Deliberately not acted on:**
- `featureRowDefaultOpen` diverging from `featureGroupDefaultOpen` — the live-run override means a
  closed-out feature with a running task shows expanded here and collapsed on `/backlog` and
  `/tasks`. That is the intended asymmetry (this card lists *every* feature, including the 24 empty
  ones this install actually has; those pages only ever list features with rows), and it is
  documented in both places. Flagged to the user rather than "fixed" into consistency, because
  making them agree would either open two dozen empty rows here or hide a live run there.
- `featureWorkRows`'s `byId` dedupe on duplicate feature ids — unreachable, `features.id` is a
  primary key. Left as is rather than adding a guard for a state the schema forbids.

**Process notes.** The working tree changed *under* both reviewers mid-run (they said so, and
re-read after hashes stabilised) because the `taskPanels` privacy refactor landed while they were
reading — worth avoiding next time by freezing the tree before dispatching. Also: the dev
container had exited between sessions, which silently reverted an earlier scratch mutation of real
rows; the lesson taken was to stop mutating real data for visual checks at all and build a
**throwaway project** instead, since `tasks.project_id` is `ON DELETE cascade` and one delete
takes the whole fixture with it. Verified zero residue both times.
