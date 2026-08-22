# Test scenario — feature grouping across Backlog, project detail, and Tasks

_Task 04 of the feature-grouping epic. Manual walkthrough; ~15 minutes._

## What changed, in one line
Work is now grouped by **feature** on `/backlog`, on project detail's Task history and on
`/tasks`, each group headed by the feature name, its `feature/<slug>` branch and a merge-state
summary — and you can file a new backlog item or dispatch a task into a feature.

## Setup

Features are **derived**, not created by hand, for pm-planned work: the backlog load turns each
`.pm/tasks/<request>/` folder that holds at least one spec into one feature. So the fastest way
to get real data is to open the backlog of a project that has `.pm/tasks/` folders (this repo
does).

1. `pnpm app` (or `pnpm dev` and open http://localhost:3001).
2. Open **Backlog** and pick a project with pm-planned specs. That load is what derives the
   features — nothing else in the app does.

To see merge states you need feature-linked runs that finished. Either dispatch two tasks into
one feature with **Run in parallel** ticked and let them finish, or set the column directly on
existing rows for a read-only pass:

```sql
-- against a throwaway copy, never data/platform.db while the app is running
UPDATE tasks SET merge_state='merged'   WHERE id='<some feature-linked task>';
UPDATE tasks SET merge_state='conflict' WHERE id='<another one>';
UPDATE tasks SET merge_state='pending'  WHERE id='<a third>';
```

`.fe/notes.md` has the throwaway-DB recipe (`next start` on `PLATFORM_DB=/tmp/x.db`) — use it
rather than the live database, which has corrupted twice.

## 1 — Backlog groups within Open / Done & cancelled

1. Open **Backlog** for a project with pm-planned specs.
2. Each of the **Open** and **Done & cancelled** cards now holds one block per feature:
   - the feature **name** as a heading,
   - a mono **`feature/<slug>`** chip with a branch icon,
   - the group's **item count** on the right.
3. Items with no feature (hand-added ones, agent-filed ones) sit under a **"No feature"**
   heading — and it is **last**, after every real feature.
4. ✅ A feature whose items span both statuses appears in **both** cards, each time counting only
   that card's items.
5. ✅ The existing per-section 50-row cap and its "N more items — show all" link still work, and
   the numbers still add up: grouping happens *after* the cap, so a group's count describes the
   rows you can see and the disclosure speaks for the rest.
6. ✅ Nothing else about a row changed — status `Select`, Run/Re-run/Running/Done button,
   priority chip, `/assignee`, spec path, the warn-toned **agent-filed** chip, the expandable
   description preview.

## 2 — Merge state on a backlog row

1. Find an item whose linked run has a merge state.
2. On its **"Last run"** line, next to the run's status badge, there is a merge chip:
   **Merged** (green), **Merge conflict** (amber) or **Not merged** (grey).
3. ✅ It sits **beside** the status badge, not instead of it — a task can be `Done` *and*
   `Merge conflict` at once. Both should be visible together.
4. ✅ Hover it: the tooltip explains the state. "Not merged" specifically says a run sharing the
   project's own checkout is never merged by the platform, so it can be a final answer.
5. ✅ An item that has never run shows **no** merge chip at all.

## 3 — Feature summary on a heading

1. Find a feature with a mixture of merged and conflicted runs.
2. Its heading carries up to two summary chips: **"N conflicts"** (amber, with a warning
   triangle) and **"N merged"** (green, with a merge icon). Conflicts come first.
3. ✅ A feature whose runs are **all pending** shows **no** summary chips. This is deliberate:
   a checkout-bound feature run stays pending forever, so a permanent "N pending" would read as
   a queue that never drains. The per-row chips still say "Not merged".
4. ✅ A feature that has been closed out shows a **Closed** (or **Cancelled**) chip, and its work
   is still listed — closing a feature never hides history.

## 4 — Project detail groups its Task history

1. Open a project that has feature-linked runs.
2. The **Task history** card groups by feature, same headings as the backlog.
3. ✅ The run count in the card header is still the **card total**, not a per-group number.
4. ✅ Rows inside a group show a merge chip; rows in "No feature" do not.

## 5 — Tasks page nests project → feature

1. Open **Tasks**.
2. Each project card now groups its runs by feature: project name (`<h2>`) → feature (`<h3>`) →
   rows.
3. ✅ The per-project 8-row cap and its "N older tasks in this project — show all" link still
   work; filtering to one project still lifts the cap.
4. ✅ Filtering with the project pills still works, and the page description still follows the
   filter.

## 6 — Feature pickers

1. On project detail, in **New task**: below the prompt box there is a **Feature** row with a
   select defaulting to "No feature", listing the project's **active** features with their
   branch as the option description.
2. Pick one and dispatch. ✅ The new run appears under that feature everywhere in section 4/5.
3. On **Backlog → Add item**, the dialog has the same **Feature** select between Description and
   Agent. Add an item under a feature. ✅ It appears in that feature's group.
4. ✅ A **closed** feature is *not* offered in either picker (you cannot file new work onto a
   branch that has been merged or abandoned) but still appears as a group in the lists.
5. ✅ On a project with **no** features, neither picker renders at all — not an empty select.
6. ✅ Submit a bad item (blank title) and reopen: the feature you chose is still selected. It is
   cleared only after a successful add.

## 7 — The no-features case must look untouched

This is the most important regression check.

1. Open a project that has **never** used features (or `UPDATE tasks SET feature_id=NULL` for one
   on a throwaway DB).
2. ✅ Its Task history is a **flat list** — no group headings at all, **not** a single
   "No feature" heading over everything.
3. ✅ No merge chips anywhere on those rows.
4. ✅ The **Dashboard**'s "Recent activity" and **agent detail**'s "Recent runs" are unchanged:
   no grouping, no merge chips, whether or not features exist. The merge chip is opt-in and only
   grouped lists switch it on.

## 8 — Responsive

Check at **390px** and **320px** (device toolbar, or a real phone).

1. ✅ **No horizontal scrollbar on any of the three pages.** This is the specific thing that was
   broken during development: a long `feature/<slug>` branch (they run to 68 characters) in a
   rigid chip forced ~95px of page overflow at 390px. The branch now wraps.
2. ✅ A long feature name wraps across lines rather than truncating.
3. ✅ The full branch is always readable — it wraps, it is never cut short with an ellipsis. You
   should be able to select and copy a complete, checkout-able ref at any width.
4. ✅ Below 640px the per-row merge chip is visually hidden (the row has no width to spare) but
   **remains in the row's accessible name** — see the a11y check below.
5. ✅ The feature pickers stay usable: full-width in the Add-item dialog, and the New-task
   Feature row wraps rather than overflowing.

> Note: project detail has a **pre-existing** 320px overflow in its header (the Rescan/Remove
> button cluster), unrelated to this work and filed as its own backlog item. Judge this feature
> on `/backlog` and `/tasks` at 320px.

## 9 — Dark mode

Toggle light → dark → system in the sidebar footer.

1. ✅ Every heading, branch chip, merge chip and summary chip is legible in both themes.
2. ✅ Chips read as tinted pills with visible borders, not as washed-out blocks — the tone
   backgrounds are translucent in dark mode, so check they sit on the card surface properly.
3. ✅ Amber "Merge conflict" is clearly distinguishable from green "Merged" **and** from a red
   "Failed" status badge in the same row.

## 10 — Accessibility

1. **Heading order.** With a heading-navigation tool (or VoiceOver's rotor), the outline is
   `h1` page → `h2` card (project name / "Open") → `h3` feature. ✅ No level is skipped.
2. **Merge state is never colour-alone.** ✅ Every chip carries a word ("Merged", "Merge
   conflict", "Not merged") and an icon, so the three are distinguishable in greyscale. Take a
   greyscale screenshot to confirm.
3. **The narrow-width chip stays announced.** At 390px, put a screen reader on a grouped task
   row. ✅ You still hear the merge state even though it isn't painted — it is `sr-only`, not
   `display: none`.
4. **The pickers are named.** ✅ Tab to each feature select: it announces as "Feature", matching
   the visible label beside it. Open with Enter/Space, move with arrows, filter by typing, close
   with Escape.
5. **Keyboard only.** ✅ Tab through a grouped backlog section: each row's status select, its
   Parallel checkbox where offered, and its Run button are all reachable in order, and grouping
   has not introduced a focus trap or a skipped row.
6. ✅ The group heading itself is not focusable — it is a heading, not a control. There is
   deliberately no expand/collapse on it.

## Regression checks

- ✅ Dispatching from a **task page's file modal** (a `.pm/tasks/` spec → "Create task") still
  routes through the spec's backlog item and still moves that item's status.
- ✅ "Run in parallel" still appears on a backlog row and in the composer only when the
  checkout is busy on a plain git repo.
- ✅ The command palette (⌘K) still finds tasks, projects, agents and backlog items.
- ✅ `/backlog`'s warnings banner (a clipped `.pm/tasks/` scan) still renders above the sections.

## Automated coverage

`pnpm test` (run inside the container with `RUNNER_HOST` unset:
`docker exec platform env -u RUNNER_HOST pnpm test`) covers the branchy parts that
`components/` can't reach:

- `lib/ui.test.ts` — `groupByFeature` (the null-when-no-features contract, row order, ungrouped
  bucket last and only when non-empty, a row whose feature no longer resolves),
  `featureMergeSummary` (never counts `pending`), `mergeStateTone` (conflict is `warn`, not
  `danger`), `featureOptions` (no-feature first, closed features hidden, always ≥1 option).
- `lib/features.test.ts` — `findFeaturesByIds` across projects, and the empty-list short-circuit.
- `lib/backlog.test.ts` — `linkedTask` exposes exactly `{id, status, mergeState}` and nothing
  more (a shared list must not grow columns off the private task row), and a real merge state is
  carried through.
