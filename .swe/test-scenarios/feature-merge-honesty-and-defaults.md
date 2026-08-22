# Test scenario: honest merge states, auto conflict resolution, isolation by default

_Task: feature merge-backs now classify their outcome honestly (merged / real conflict /
blocked-will-retry / nothing-to-merge), retry themselves when the checkout frees up, ask the
run's own agent to resolve a real conflict once, isolation is the default everywhere, and
feature groups collapse. · 2026-08-22_

## Setup / preconditions
- A signed-in (or local-workspace) user with a working Anthropic token — the auto-resolve
  step needs real runs. Without a token, only the UI parts (sections 1, 4, 5) are testable.
- A registered project that is a plain git repo (not a workspace) with at least one feature
  (add one via the backlog page's feature picker, or use a project with `.pm/tasks/` folders).
- Start the stack: `pnpm app` (or `pnpm dev` for foreground logs).

## 1. Isolation is the default now
1. Open the project's detail page and look at the composer.
   - **Expected:** a checkbox **"Run isolated (in parallel)"** is visible *even though
     nothing is running*, already **checked**, with copy explaining the run gets its own copy
     of the project on its own branch. Before this change the box only appeared while another
     task was running.
2. Open the Backlog page and find any open item on a git project.
   - **Expected:** an **"Isolated"** checkbox next to Run, checked by default; hovering it
     explains the worktree in plain words and that unticking queues into the shared checkout.
3. On a **workspace** project (or a non-git folder), check the same two places.
   - **Expected:** no checkbox at all — isolation is impossible there and is not offered.

## 2. Honest merge states end to end (needs a token)
1. Create a feature (say "Merge demo"), then dispatch **two tasks into it** from the composer
   with requests that touch **different files** (e.g. "add file alpha.md with one line" and
   "add file beta.md with one line"), leaving "Run isolated" checked. Approve their gates.
   - **Expected:** both run at the same time (neither queues). While running, their rows in
     Task history show a muted **"Merges when done"** chip.
2. Let both finish.
   - **Expected:** both rows show a green **"Merged"** chip; each task's transcript ends with
     a `🔀 Merged task/… into feature/merge-demo.` log line. `git log feature/merge-demo` in
     the project shows one merge commit per task.
3. Now dispatch two tasks into the feature that **edit the same line of the same file**
   (e.g. both: "replace the single line of alpha.md with your own one-line slogan").
   - **Expected:** the first finisher merges clean. When the second finishes its report and
     you approve, it does **not** end immediately: its transcript shows
     `⚠️ Merging … hit a real conflict — asking the agent to resolve it…`, then one extra
     agent turn where it merges the feature branch into its own branch and reconciles **both**
     slogans' intent (nothing discarded), then `🔀 Merged …`. The row ends **Done + Merged**.
4. Check the feature heading in Task history.
   - **Expected:** it aggregates e.g. **"4 merged"**; a conflict that the agent resolved never
     shows as a conflict.

## 3. Blocked is not a conflict, and it heals itself (needs a token)
1. In the project checkout, `git checkout feature/merge-demo` by hand (this is what a
   non-isolated feature run also does). Dispatch one more isolated task into the feature and
   let it finish while the checkout **stays free**.
   - **Expected:** the merge runs **in your checkout**: `git log` on it shows the new merge
     commit and your working tree advances. The chip reads **"Merged"**.
2. Repeat, but this time keep the checkout **busy** while the task finishes: dispatch a plain
   (unticked "Isolated") long-ish task first so it occupies the checkout, then the isolated
   feature task.
   - **Expected:** the feature task ends Done with a muted **"Merge waiting"** chip (tooltip:
     retried automatically — nothing to do), and the heading shows "1 waiting". When the
     checkout run finishes, the merge retries by itself: the chip flips to **"Merged"** and
     the task's transcript gains a `🔀 Merge sweep: merged …` line. (A runner restart —
     `pnpm stop && pnpm app` — also triggers the sweep.)
3. Old mis-recorded rows: any pre-existing task whose chip said **"Merge conflict"** but whose
   branch was later merged by hand (e.g. the Core-component task from the 2026-08-22
   screenshot) heals the same way.
   - **Expected:** after the next runner start, its chip reads "Merged" and its transcript
     says `Merge sweep: … is now fully contained …`. A run that ended `done` without
     committing anything (the Usage-page task) flips to **"Nothing to merge"** instead, with
     the tooltip pointing at its kept worktree.

## 4. Pending is no longer one confusing word
1. Find a **cancelled** feature task (cancel one mid-run if none exists).
   - **Expected:** **no merge chip at all** — a merge that was never attempted says nothing.
2. Find a feature task that ran **in the checkout** (untick "Isolated" when dispatching).
   - **Expected:** chip reads **"In checkout"**, tooltip explaining the agent commits directly
     (usually straight onto the feature branch) so there is nothing separate to merge.

## 5. Feature groups collapse
1. Open the Backlog page and the project's Task history on a project with features.
   - **Expected:** every feature heading has a chevron; clicking it (or pressing Enter/Space
     with it focused) folds the rows. The branch chip, merge summary and count stay visible
     while collapsed. Active features start open; a **closed** feature starts collapsed.
2. Keyboard: Tab to a heading, toggle with Enter.
   - **Expected:** focus stays on the button; screen readers get `aria-expanded` flipping.

## Edge / failure cases
1. Dispatch an isolated feature task and cancel it **during** the conflict-resolution turn
   (section 2.3 shape).
   - **Expected:** the task ends Cancelled with the **"Merge conflict"** chip preserved (the
     state was recorded before the resolve turn started); both branches intact.
2. A second conflict in the same run after the one resolve attempt (or an agent that fails to
   resolve).
   - **Expected:** the task ends Done + "Merge conflict" — there is never a second automatic
     attempt, and the transcript's last merge line says it was left for manual resolution.

## What success looks like
You can read every feature group top-to-bottom and know exactly where each run's work is:
merged (and by whom — platform or sweep, per the transcript), genuinely conflicted, waiting
on a busy checkout, in the checkout by design, or never attempted. Parallel runs are the
default with no reload dance, real conflicts resolve themselves once without discarding either
side, and the two bogus "Merge conflict" rows from the screenshot heal on the next start.
