# Test scenario — Usage as its own nav page

**Change (pm task `20260802-083437-usage-own-menu`):** the usage cards moved out of Settings
onto a new top-level **Usage** page. Settings is now the Anthropic token vault only.

Run the app with `pnpm dev` (Docker) and open http://localhost:3001, signed in.

## 1. Navigation

1. **Desktop (`md+`), expanded sidebar:** the Navigate list reads **Dashboard · Agents ·
   Projects · Usage · Settings**, in that order. Usage sits directly above Settings and uses a
   gauge/speedometer icon.
2. Click **Usage** → lands on `/usage`. The row gets the filled background, the label turns
   strong, the icon turns accent-coloured, and the thin accent bar appears at its left edge —
   the same active treatment as every other nav item.
3. **Collapsed rail** (click *Collapse* in the sidebar footer): only icons remain. Confirm the
   gauge icon is still recognisable and *distinguishable from the gear (Settings) icon
   directly below it* — both are round-ish at 18px. Hover it: the native tooltip reads "Usage".
4. **Mobile (`< md`, e.g. 375px):** the bottom tab bar now has **five** tabs. Tapping Usage
   navigates and turns the tab accent-coloured.
5. Go to **Settings**. The Usage nav item must be **inactive** (no highlight) — active-state
   prefix matching shouldn't bleed between the two.

## 2. The Usage page (`/usage`)

1. Page title **"Usage"** with the description *"Tokens and cost for the tasks you dispatched."*
2. Below it, a card headed **"Your spend"** (deliberately *not* "Usage" — it would duplicate
   the page title for anyone navigating by headings), with `N tasks dispatched by you` on the
   right.
3. With spend recorded: four tiles — **Total spend**, **Last 30 days**, **Tokens**, **Billed
   tasks** — then the token breakdown line, then **Most expensive runs** (up to 5 rows: title,
   relative time, cost). Each row links to its task.
4. A run with no title falls back to a mono `/command`; a very long title truncates with an
   ellipsis instead of widening the card.
5. Sub-cent spend renders as `<$0.01`, never `$0.00`.
6. With no spend of your own: a dashed **"No usage recorded yet"** empty state instead of the
   tiles. Note the page is then just the header plus that empty state — expected, because the
   only other card (plan limits) normally doesn't render at all (§4).
7. If any tasks predate per-user attribution, the footnote reads *"A further $459.61 across 90
   tasks predates per-user attribution and isn't counted above."* — check the spacing is
   normal (an earlier build rendered "90 taskspredates").

## 3. Settings is now token-only (`/settings`)

1. `/settings` shows the page header and the **Anthropic token** card — and nothing else.
   No spend card, no plan-limit card, no leftover gap or divider where they used to be.
2. The token vault still works end to end: save a token, see the masked `last4`, delete it.
3. Links that point at Settings from elsewhere still make sense — the "add a token" nudge on
   the dashboard and in the new-task form are about the *token*, not usage, so they should
   still go to `/settings`, not `/usage`.

## 4. Claude plan limits

1. **Expected on this deployment: the card does not exist**, on `/usage` just as it didn't on
   `/settings`. No "unavailable" message, no empty card, no error, no skeleton. Plan limits
   aren't readable with a token injected via the environment (`runner/usage-snapshot.ts`).
2. To see the populated state, temporarily seed `useState` in `components/PlanLimits.tsx` with
   windows (`five_hour`, `seven_day`, …). Expect a **Claude plan limits** card below "Your
   spend", with a violet subscription chip, one labelled bar per window, the percentage in
   mono on the right, and "Resets in 3h 12m". Bar colour: green <75%, amber 75–89%, red 90%+.
   **Revert the seed afterwards.**

## 5. Responsive, dark mode, accessibility

1. **⚠️ 320px (narrowest phones) — the check most worth doing.** The tab bar went from four
   tabs to five, so each tab now gets roughly 64px. Confirm:
   - the bottom bar does **not** scroll sideways and the page has no horizontal scrollbar;
   - labels are readable. "Dashboard" is the longest and sits right at the limit — if it
     ellipsizes ("Dashboar…") that's the truncation guard doing its job rather than breaking
     the layout, but if it looks bad, shortening that label to "Home" is the cheap fix.
     *This could not be verified here — the dev box has no browser (see `.fe/notes.md`).*
2. **375px / 768px / desktop:** the Usage page tiles are 2-up on mobile and 4-up from `lg`;
   the "most expensive runs" rows wrap rather than overflow.
3. **Dark mode** (theme control in the sidebar footer): the new page and the nav item follow
   the theme in light, dark, and system — no stuck-white panels, no light-mode artifacts.
4. **Screen reader / keyboard:** on `/usage` the heading order is `h1 Usage` → `h2 Your spend`
   → `h3 Most expensive runs`, with no skipped level. The active nav item is announced as the
   current page (`aria-current="page"`) in both the sidebar and the mobile tab bar. Tab through
   the page — the "most expensive runs" rows are plain links with the global focus outline;
   nothing traps focus.
5. **Signed out:** hitting `/usage` directly redirects to `/signin` (enforced in the
   middleware, the `(app)` layout, and the page itself).

## Verified before handoff

Checked against a throwaway instance (isolated DB, not `data/platform.db`) by inspecting the
rendered HTML: nav order and both active states, `aria-current` presence on `/usage` and
absence on `/settings`, the heading hierarchy, the populated tiles + `<$0.01` + footnote
spacing, the empty state, and that `/settings` retains no usage markup.

**Not verified:** anything needing real pixels — item 5.1 (320px), 5.2, 5.3, and the collapsed
rail icon check in 1.3. No browser on this machine.

## Known non-blocking notes (out of scope)

- `tasks.userId` has no DB index, so `/usage` runs four full scans of the tasks table. Moved,
  not introduced, by this change; worth an index if task volume grows. Backend.
- `pnpm audit` reports 17 vulnerabilities in `next@16.2.9` (fixed in 16.2.11). Pre-existing;
  no dependency changed in this task.
- `isActive()` is a prefix match, so a future `/usage/<sub>` route or a sibling `/usages`
  would need it revisited. Harmless today.
