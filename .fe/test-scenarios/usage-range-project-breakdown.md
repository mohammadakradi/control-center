# Test scenario — Usage page: date-range filter, project labels, per-project breakdown

_Manual verification for the `/usage` page changes. Companion to the backend scenario in
`.swe/test-scenarios/usage-range-and-projects.md` (the API side of the same feature)._

## Setup
Sign in and open **Usage** in the left nav (`http://localhost:3001/usage`).

You need at least one task that recorded spend, or you'll only see empty states — which are
themselves worth checking (see "Empty states" below). If this instance's history is mostly
unowned (it usually is), dispatch a task or two first so there's per-user spend to look at.

## 1 · The range control
1. Look at the top-right of the page header.
   - **Expected:** a three-segment control — **7 days · 30 days · All time** — styled like the
     theme switcher in the sidebar footer. **All time** is selected on first load.
2. Click **7 days**.
   - **Expected:** the URL becomes `/usage?range=7d`, the selected segment moves, and every
     figure on the page re-reads for that window: the first tile's label changes to
     "Last 7 days", the card's header count reads "N tasks in the last 7 days", the
     "Most expensive runs" list drops older runs, and "Spend by project" re-sorts.
3. Click **30 days**, then **All time**.
   - **Expected:** `?range=30d`, then a clean `/usage` with no query param for the default.
4. Press the browser **Back** button a few times.
   - **Expected:** each range is a real history entry — you step back through the windows you
     visited, and the selected segment follows.
5. Copy the `/usage?range=7d` URL into a new tab.
   - **Expected:** it opens with **7 days** already selected. The range is shareable.

## 2 · Project labels on "Most expensive runs"
1. Look at each row under **Most expensive runs**.
   - **Expected:** every row shows a small folder icon + the project name, in the same quiet
     grey treatment used on the Dashboard and agent-detail task lists.
2. Click a row.
   - **Expected:** it opens that task. The project name is **not** separately clickable — the
     whole row is one link.

## 3 · Spend by project
1. Scroll to the **Spend by project** card.
   - **Expected:** the card header's right side names the active window ("Last 7 days", etc.).
     Projects are listed most expensive first, each with its cost, a horizontal share bar, and
     a line reading "`<tokens>` tokens · `N` runs · `X`% of spend".
2. Check the arithmetic.
   - **Expected:** the percentages are shares of the "Your spend" total above, and the bar
     lengths match them. The two cards can never disagree — they read the same query.
3. Click a project name.
   - **Expected:** it opens that project's page.
4. If you have more than 8 projects with spend:
   - **Expected:** only the top 8 are listed, followed by "A further $X across N smaller
     projects." — the remainder is disclosed, never silently dropped.

## 4 · Empty states
1. Select **7 days** on an account that hasn't run anything billable this week.
   - **Expected:** "**No spend in the last 7 days**" with the hint "Nothing you dispatched in
     this window reached a billable turn. Try a wider range." — **not** the "No usage recorded
     yet" copy, which would wrongly imply you've never spent anything.
2. Switch to **All time** on a brand-new account.
   - **Expected:** "**No usage recorded yet**" with the dispatch-a-task hint.

## 5 · Honest zeros (regression guard)
1. Find a project whose tasks banked tokens but never reached a billable turn.
   - **Expected:** its row reads "**No cost recorded**" and has **no** share bar — never
     `$0.00`, which would read as "this was free".
2. Look for a run costing less than a cent.
   - **Expected:** `<$0.01`, not `$0.00`.
3. If a task's project row has been deleted:
   - **Expected:** the label reads "Unknown project" (plain text, not a broken link).

## 6 · The unattributed footnote
1. With **All time** selected, read the footnote under "Your spend".
   - **Expected:** "A further $X across N tasks predates per-user attribution…"
2. Switch to **7 days**.
   - **Expected:** the same figure, now explicitly qualified — "…across N tasks, **all time**,
     predates…" — because that bucket is all-time by design and mustn't be read as a
     7-day number.

## 7 · Responsive (resize to ~375px, or use device emulation)
- **Expected:** the range control wraps onto its own line below the "Usage" heading and its
  three segments still fit on one row.
- **Expected:** no horizontal page scroll at any range. Long project names truncate with an
  ellipsis instead of pushing the layout wide — the seeded name
  `a-project-with-a-really-long-name-that-must-truncate` is the case to watch.
- **Expected:** "Most expensive runs" rows wrap (title, project, age, cost) rather than
  overflowing.

## 8 · Dark mode
Toggle **Light → Dark → System** in the sidebar footer, on `/usage`.
- **Expected:** the range control's selected segment stays legible in both themes (it's a
  raised `surface` chip on a `surface-2` track), the share bars stay visible against their
  track, and no element keeps a light-mode-only colour. Nothing should flash on reload.

## 9 · Accessibility
- **Keyboard:** Tab to the range control — each of the three segments is a link and takes
  focus in order, showing the global focus outline. Enter activates.
- **Screen reader:** the control is a navigation landmark named "Spend range"; the active
  segment is announced as current. Folder icons are decorative and announce nothing.
- **Not colour-alone:** every share bar's percentage is also printed as text, so the bars
  carry no information on their own. The bars are hidden from assistive tech for that reason.
- **JS off:** the whole feature still works — the control is plain links, and both cards
  render on the server.

## 10 · Bad input (shouldn't be reachable, but)
1. Visit `/usage?range=bogus`, then `/usage?range=7d&range=30d`.
   - **Expected:** both fall back to **All time** and render normally — no error page.
     (The API is stricter: `GET /api/usage?range=bogus` returns 400.)
