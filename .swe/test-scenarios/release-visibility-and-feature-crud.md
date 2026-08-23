# Test scenario: releases become visible on their own, and feature groups are manageable

_Task: a published release now reaches a running window without a reload (and is only offered
once it can actually be installed), plus features can be created, renamed, closed out and
deleted from the project page. · 2026-08-23_

## Setup / preconditions
- Start the stack: `pnpm app` (or `pnpm dev` for foreground logs). The dev app is
  http://localhost:3001.
- A registered project that is a plain git repo. For section 4 you want one with
  `.pm/tasks/<request>/` folders (this repo has them) **and** one without, to see both kinds
  of feature row.
- No Anthropic token is needed for any step below except 5.3, which is optional.
- **Sections 1–2 behave differently in a dev checkout than in an installed app.** A checkout
  reports `packaged: false`, so the *banner* never renders there by design. Test the banner on
  a real install (`~/.control-center`); test the Version card and the API in either.

## 1. The Version card in Settings (works in a checkout)
1. Open **Settings**. Scroll to the new **Version** card.
   - **Expected (dev checkout):** "Running from a checkout (0.9.x)" and "Updates are applied
     with git pull, not from here — there's no release for the launcher to install." Tone is
     muted/grey, not a warning — nothing is wrong.
   - **Expected (installed app, current):** "Version 0.9.0 is up to date" in green, with
     "0.9.0 is the newest release."
2. Read the line under the box.
   - **Expected:** "Last checked just now. The app re-checks on its own every half hour, and
     whenever you come back to this window." Leave the window open a few minutes and the
     "just now" becomes "2 minutes ago" **without a reload**.
3. Press **Check now**.
   - **Expected:** it spins briefly and the state stays correct. Because the answer was
     seconds old, the timestamp may still say "just now" — that is the 60-second floor doing
     its job (see 3.2), not a dead button.

## 2. A release published while the window is open (the actual bug)
This is the behaviour that was missing: previously the banner fetched **once**, on mount, in a
layout that client-side navigation never remounts — so a window left open never learned about a
new release at all, which is why several releases went unnoticed.

Two ways to test it. The honest one needs a real release; the second simulates it.

**2a. On a real install, with a real release**
1. On the installed app (`control-center start`), leave the window open on any page. Do not
   reload it.
2. Publish a new release (bump `package.json`, tag, push, publish on GitHub).
3. Wait. Do **not** touch the window for the first few minutes.
   - **Expected:** nothing appears while the workflow is still uploading assets (that's
     section 3). Within ~30 minutes of the assets landing — or immediately when you click back
     into the window after being away — the blue bar appears at the top: "Version X is
     available — you're on Y", with **Update now**, **Release notes** and a dismiss ✕.
4. Press **Update now**.
   - **Expected:** the bar becomes "Updating to X… the server restarts, and this page
     reconnects on its own." The server goes away and comes back; the page reloads itself onto
     the new version. `~/.control-center/logs/update.log` holds the whole transcript and
     `run/update.status` ends `state=succeeded`.
   - **If a task is running:** it refuses first with an amber bar naming the count and an
     "Update anyway" button. That is the pre-existing gate, unchanged.

**2b. Simulating it on an install (faster, and safe)**
1. Stop the app: `control-center stop`.
2. Edit `~/.control-center/app/package.json` and set `version` to something *older* than the
   latest release (e.g. `0.8.0`).
3. `CC_SKIP_UPDATE_CHECK=1 control-center start` — the skip is what stops the CLI updating it
   back before you can look.
4. Open the window.
   - **Expected:** the banner appears offering the real latest version.
5. Press **Update now** and let it run.
   - **Expected:** it reinstalls the current release properly. `~/.control-center/app.old`
     holds the previous copy and `data/backup/` gains a database snapshot, so this is
     recoverable. Afterwards `control-center version` reports the real version again.

## 3. A release that is published but not yet installable
The window between "Publish release" on GitHub and the workflow's asset upload was a real
failure: `/releases/latest` reported the new tag, the banner offered it, and the Update button
died on a 404 from `curl`. Every release had this window.

1. **Check the current behaviour is unaffected.** With the app on the latest version:
   ```
   curl -s localhost:3001/api/updates | python3 -m json.tool
   ```
   - **Expected:** `latest` is the real newest tag, `updateAvailable: false`, and **no**
     `unavailable` field. The asset gate must not misfire on a complete release.
2. **The floor on forced checks.** Run this several times in a row:
   ```
   for i in 1 2 3 4 5; do curl -s 'localhost:3001/api/updates?force=1' \
     | python3 -c 'import json,sys; print(json.load(sys.stdin)["checkedAt"])'; done
   ```
   - **Expected:** the same `checkedAt` every time — GitHub was contacted once. That route has
     no auth, so an unbounded force would be a way to burn the 60-requests-per-hour budget and
     leave everyone's real check answering `rate-limited`.
3. **The shell side, without publishing anything.** Against a throwaway home:
   ```
   TMP=$(mktemp -d); mkdir -p "$TMP/app"; echo '{"version":"0.1.0"}' > "$TMP/app/package.json"
   CC_HOME="$TMP" control-center update
   ```
   - **Expected:** it finds the real latest release, says "Downloading…", and proceeds (it will
     install into `$TMP`, which you then `rm -rf`). What it must **not** say is "still
     publishing its assets" — that message is only for a release whose tarball is genuinely
     missing.
4. **The real mid-publish case**, if you happen to be publishing: during the workflow run,
   before the "Publish the release" step finishes, the banner shows **nothing** and the
   Version card in Settings says "Version X is still publishing — its install files are still
   uploading — this usually takes a couple of minutes." A minute or two later it becomes a
   normal offer. Nothing ever fails.

## 4. Managing feature groups (the new Features card)
1. Open a project's detail page. There is a new **Features** card between Source control and
   Task history.
   - **Expected (project with `.pm/tasks/`):** one row per planned request folder — name,
     `feature/<slug>` branch in mono, an item count, and the `.pm/tasks/<folder>/` it came
     from. Each row offers only **Close out** (no pencil, no trash). One paragraph under the
     list explains why, once — not on every row.
   - **Expected (project with none):** an empty state: "No features yet", explaining that a
     feature groups tasks and backlog items onto one branch.
2. **Add one.** Press **Add feature**, type `Checkout redesign`, press Add feature.
   - **Expected:** the dialog explains that a `feature/…` branch is reserved from the name and
     never changes afterwards. The row appears with **pencil (Rename)**, **Close out** and
     **trash (Delete)**, and branch `feature/checkout-redesign`.
3. **Rename it.** Press the pencil, change the name to `Checkout rework`, Save.
   - **Expected:** the name changes and the **branch does not** — still
     `feature/checkout-redesign`. That is deliberate: the ref may already exist in the repo,
     and moving it would orphan the work on it.
4. **Close out and reopen.** Press **Close out**.
   - **Expected:** a "Done" chip appears and the button becomes **Reopen**. Check the project's
     Task history and the Backlog page: this feature's group heading is now **collapsed** by
     default (closed features are history), while active ones stay open. Press **Reopen** and
     it goes back.
5. **A closed feature is not offered for new work.** With it closed, open the composer's
   Feature picker and the Backlog's Add-item Feature picker.
   - **Expected:** the closed feature is **absent from both pickers** but still visible as a
     group heading in the lists. New work must not land on a branch shown as finished.
6. **Try to rename a pm-derived one.** Attempt it via the API (the UI doesn't offer it):
   ```
   curl -i -X PATCH localhost:3001/api/projects/<pid>/features/<derived-id> \
     -H 'content-type: application/json' -d '{"name":"nope"}'
   ```
   - **Expected:** **409**, naming the `index.md` to change instead.
7. **Try to delete a pm-derived one:**
   ```
   curl -i -X DELETE localhost:3001/api/projects/<pid>/features/<derived-id>
   ```
   - **Expected:** **409**, `"reason":"derived"`, telling you to delete the folder — because
     the next backlog load would re-derive the row and the delete would silently undo itself.
     Reload the page: it is still there.

## 5. Deleting a feature never deletes the work
1. **Set up something to lose.** On the feature from 4.2, add a backlog item under it (Backlog
   → Add item → pick the feature). Note the item's title.
2. Press the **trash** icon on that row.
   - **Expected:** a confirmation dialog that spells out exactly what survives — its backlog
     items, its task history *with transcripts*, and the branch with every commit on it
     ("nothing here runs git"). It also suggests closing out instead if you only want it out of
     the way.
3. Press **Delete feature**.
   - **Expected:** the row disappears. The backlog item is **still there**, with its title and
     description intact, now ungrouped (no feature heading). In the project repo,
     `git branch --list 'feature/checkout-redesign'` still lists the branch, and
     `git log feature/checkout-redesign` still shows its commits.
4. **A live run blocks it.** (Needs a token.) Create a feature, dispatch a task into it, and
   while that task is running (or waiting at a gate) press its trash icon and confirm.
   - **Expected:** **no** deletion. The dialog closes and a red message appears **on that row**:
     "1 task is still running on this feature. Its branch is where their work gets merged, so
     wait for it to finish or cancel it first." Let the task finish, then delete again — it
     works, and the finished task remains in Task history with no feature heading.
5. **A finished or cancelled run does not block it.** Delete a feature that has only
   done/failed/cancelled tasks on it.
   - **Expected:** it deletes. History is not a reason to keep a grouping alive.

## 6. A report explains its own "Create fix task" button

The report card used to show that button with nothing saying why, and it fired on reports
describing bugs that were already fixed.

1. Open any finished task whose change report contains a findings section, a `[High]`-style
   severity tag, an unchecked `- [ ]` item, or the word "recommend".
2. **Expect** an amber callout at the bottom of the report card, headed **"This report flags
   follow-up work"**, listing one row per signal — `Findings section`, `Severity callout`,
   `Unfinished item`, `Recommendation` — each quoting **the report's own line**, and with the
   **Create fix task** button *inside* the callout.
3. Read the note: it should say a fix task starts a fresh run, and that ignoring it is fine.
4. Now open a task whose report is clean (e.g. "Committed. Nothing blocking. No outstanding
   issues.").
5. **Expect no callout and no button at all** — not a greyed-out button, nothing. The offer and
   its explanation come from one list, so a button can never appear unexplained.
6. Press **Create fix task** on the first task. **Expect** a new task dispatched against that
   report's text, exactly as before — this change did not touch what the button does.

Two specific things that should NOT happen:
- A report saying "no outstanding issues" must not produce a `Findings section` row (the word
  "issues" is in an all-clear sentence, and it's judged per line).
- A report with twenty findings must not produce twenty rows — one per *kind*, capped at four.

## 7. A task must not look finished while it is still working

This is only **partly** fixed, and the scenario is written to show both halves.

1. Dispatch any task that ends a turn narrating that its review subagents are still out — the
   phrasings that count are "the reviewers are still running", "the audit hasn't returned",
   "both subagents are still in flight", with **no** `[[DONE]]` or `[[GATE:…]]` marker.
2. **Expect** the run to be *nudged to continue* rather than sealed: a log line reading
   "Agent paused mid-workflow (waiting); nudging it to finish", and the status staying active.
3. **Expect NOT to see** a report card synthesized from that narration, and not a `Done` chip.
4. Now the known gap, so nobody reports it as new: if the agent stamps a trailing `[[DONE]]` on
   a report that says its reviews are still running, the task **will** still be sealed `Done`,
   and background subagent activity can still land in the transcript afterwards. That is
   `bli_9119b0b6` (platform) and `bli_dd973b87` (agent rules), deliberately not fixed here —
   the cheap fix (reusing `WAITING_RE` at the seal point) also matches "I'll wait for your
   approval to push", which would put finished runs in a nudge loop.

Counter-check that must stay working: a report that merely *mentions* reviews or things running
must still be accepted as final — "I ran the reviewer and the security auditor. Both came back
clean", "Tests are still running in CI, but the change is complete and verified locally".

## 8. A quoted finding can't lie about what it says

1. Find (or plant) a task whose report contains a line with a Unicode RIGHT-TO-LEFT OVERRIDE —
   e.g. a `[High] …` finding with `U+202E` mid-sentence.
2. **Expect the callout's quoted evidence to read in its true logical order** (the reversed
   characters appear reversed), while the report body above it may still render the override.
   Those two disagreeing is the fix working: the callout shows what the bytes say, the markdown
   body shows what the author wanted you to read. (The body is a known pre-existing gap,
   `bli_81e3ed7c`.)
3. **Expect no zero-width or bidi characters at all** in the callout text.

## 9. A failed update never stops the app from starting

1. Simulate an update that can't complete — easiest is to point `CC_REPO` at a repo whose newest
   release has no tarball asset, or to be offline mid-download.
2. Run `control-center start`.
3. **Expect** a warning naming the version it couldn't reach and the one it's carrying on with
   ("The update to X didn't finish — starting Y instead"), and then **the app starts normally**.
   Before this, `start` exited and the server never came up.
4. **Expect `~/.control-center/run/update.lock` to be gone** afterwards — released, not leaked.
5. Now run `control-center update` against the same failure. **Expect exit code 1** and no
   "starting Y instead" — a command whose job is to update must report that it couldn't.

## 10. Regressions to rule out
1. Reload the project page, the Backlog page and `/tasks`.
   - **Expected:** feature grouping, branch chips, merge-state chips and the collapse
     behaviour are all exactly as before. A project with no features shows flat lists with no
     "No feature" heading.
2. `curl -i -X DELETE localhost:3001/api/projects/<other-pid>/features/<a-real-id-from-pid-A>`
   - **Expected:** **404**, not 403 and not a deletion — a feature addressed through the wrong
     project reads as missing, so ids can't be probed across projects. Confirm the feature is
     still there in its own project.
3. `curl -s 'localhost:3001/api/updates?force=0'` and `?force=`
   - **Expected:** both behave as a normal check (200). Only exactly `1` forces.
4. Open Settings and Usage; dispatch one ordinary task.
   - **Expected:** unchanged. Nothing in this task touched dispatch, tokens or usage.
