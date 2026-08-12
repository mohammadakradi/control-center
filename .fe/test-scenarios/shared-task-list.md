# Test scenario — One shared task row, titles everywhere

**Change:** every task list in the app now renders the same row, and that row leads with the
task's **name** (`tasks.title`, generated at dispatch) instead of the raw request prose. The
Dashboard's "Recent activity" and agent detail's "Recent runs" used to hand-roll their own rows
and show `requestText`; project detail already showed the title. Now all three compose
`CardSection` + `TaskList`.

- `components/TaskList.tsx` — **new**; the task row + its empty state. No card shell.
- `components/TaskHistory.tsx` — now a thin "Task history" `CardSection` around `TaskList`.
- `app/(app)/page.tsx` — "Recent activity" uses `TaskList`; the local `CardHead` helper is gone
  (all three cards use `CardSection`, with a `ViewAll` link in the header slot).
- `app/(app)/agents/[id]/page.tsx` — "Recent runs" uses `TaskList`.
- `lib/ui.ts` — `taskDisplayTitle()` (`title` → `requestText` → `null`), the fallback chain
  defined once; also used by the task detail `<h1>`. Tests: `lib/ui.test.ts`.
- `components/UsageSummaryCard.tsx` + `lib/usage-summary.ts` — `/usage`'s "Most expensive runs"
  keeps its own cost-ranked row but now names tasks through the same helper (needed one extra
  column, `requestText`, on the `TaskSpend` projection).
- `app/(app)/agents/[id]/page.tsx` — the three card headings that weren't converted got
  `text-fg-strong` so all four match what `CardSection` gives "Recent runs".

## 1. The point of the change — titles, not prose
1. Open `/` (Dashboard). Each row in **Recent activity** shows a short task name
   (e.g. "Show task titles in every task list"), *not* the multi-sentence request that was
   typed to dispatch it.
2. Open an agent with history, `/agents/<id>` → **Recent runs**: same names.
3. Open `/projects/<id>` → **Task history**: unchanged from before (it already did this).
4. Click any row in each of the three lists → lands on `/tasks/<id>` for that task, and the
   page `<h1>` shows **the same name** the row did. The row and the heading must never disagree.
5. Older tasks with no generated title (pre-titling history, or a failed title call) fall back
   to their request text. To see both kinds side by side, run
   `pnpm db:backfill-titles --dry-run` for a list of which tasks have titles.

## 2. Row anatomy (all three lists)
Left to right: `/namespace:command` + `v<version>` (mono, accent) · the task name ·
the project (Dashboard + agent detail only) · cost · time-ago · status badge.

1. **Project detail has no project cell** — every row there belongs to the project on screen.
   Dashboard and agent detail *do* show it, because those lists span projects.
2. **Cost renders nothing rather than `$0.00`.** Find a cancelled or very old task with no
   recorded usage: no cost text at all. A sub-cent run reads `<$0.01`.
3. A task with **neither** a title nor request text reads **"no description"** in muted grey —
   not a blank row.
4. The version label is absent on tasks that predate version tracking, present otherwise.
   It legitimately varies row to row on agent detail (each run snapshots the version it used).
5. Counts and pluralization: the "Task history" and "Recent runs" headers read **"1 task"** /
   **"1 run"** with one, and **"2 tasks"** / **"2 runs"** with more. (Interleaving `{expr}` with
   prose has eaten the space here before — see `.fe/notes.md`.)

## 3. Empty states — each list keeps its own copy
1. A project with no tasks → "No tasks yet."
2. An agent that has never run → "This agent hasn't run any tasks yet."
3. A fresh install / empty workspace, Dashboard → "No tasks yet. Add a project and dispatch one."
   All three sit inside their card with the header and count still visible ("0 tasks").

## 4. The fourth list — `/usage` → "Most expensive runs"
This one is **not** a `TaskList` and shouldn't become one: it's a cost ranking over a narrow
projection (no status, no agent, no tokens) and leads with the cost figure. But it shares the
naming rule, which it previously didn't.
1. Open `/usage` with spend recorded. Each row of **Most expensive runs** names the task.
2. Find (or seed) a run with **no** title but a real request. It must show the request prose —
   before this change it showed only `/command`, so an untitled expensive run was unidentifiable.
3. A run with neither still falls back to the mono `/command`, which is correct here: unlike a
   task-history row, this row has no separate command cell.

## 5. Responsive — 375px, 768px, 1280px
1. **375px (iPhone SE).** The task name **stays visible** — this is the behaviour change: the
   Dashboard and agent lists used to hide their main text below `sm`, which now would leave a
   row with no subject. Cost and time-ago are the cells that drop out instead. Rows wrap to a
   second line rather than overflowing; **no horizontal page scroll** on `/`, `/agents/<id>`, or
   `/projects/<id>`.
2. Long values must truncate with an ellipsis, not push the row wide: a long task name, and a
   long project name in the project cell.
3. **768px**: cost and time-ago are back. **1280px**: the Dashboard's Agents/Projects cards sit
   two-up; "Recent activity" is full width; agent detail's "Recent runs" spans both columns.
4. Regression check on the grids (a documented trap in this project): the Dashboard stat grid
   and card grid, and the agent detail grid, now carry an explicit `grid-cols-1` base. Confirm
   at 375px that nothing overflows sideways.

## 6. Dark mode + light mode
1. Toggle light / dark / system in the sidebar footer on all three pages. Rows, borders,
   the muted "no description" text, the mono command label and every status badge follow the
   theme — the component uses only semantic tokens (no `dark:` variants).
2. Specifically check the version label and "no description": both moved from `fg-ghost` to
   `fg-faint` because `fg-ghost` is below AA for text. They should be clearly readable in both
   themes, slightly dimmer than the task name.

## 7. Accessibility
1. **Keyboard:** Tab through a task list — each row is one link with a visible focus ring
   (global `:focus-visible`). Enter opens the task.
2. **Screen reader:** each row announces as one link reading roughly
   "/fe:task v0.4.0 · <task name> · Project <name> · Cost $1.23 · 11m ago · Done". The
   "Project" and "Cost" words are `sr-only` labels — without them the project name and the
   number are unlabelled.
3. Decorative icons (the folder glyph in the project cell, the arrow in "View all") are
   `aria-hidden` and are not announced.
4. Headings: each card still has exactly one `<h2>` (from `CardSection`) — the Dashboard's
   heading outline should read Dashboard (`h1`) → Agents / Projects / Recent activity (`h2`).
5. `prefers-reduced-motion: reduce` — the running-status spinner stops animating (global rule).

## 8. Verifying without a browser
There's no Playwright here. To see populated rows against a throwaway database (never
`data/platform.db`), see the recipe in `.fe/notes.md` — build once, then run `next start` with
`PLATFORM_DB` pointed at a temp file. A second `next dev` will *not* work while the dev
container is running. Seed tasks with `user_id = 'user_local'` and no session is needed.

## What is not covered
No DOM/component test tooling exists in this project, so only `taskDisplayTitle()` is
automatically tested (`lib/ui.test.ts`, `docker exec platform pnpm test`). Everything above is
by hand.
