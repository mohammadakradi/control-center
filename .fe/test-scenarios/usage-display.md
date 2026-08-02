# Test scenario — Usage display (tokens, cost, plan limits)

**Change (pm task 06):** token/cost usage is now visible in three places:
- **Task detail** (`/tasks/<id>`) — a labelled usage line under the header chips
- **Task history rows** (`/projects/<id>`) — a per-row cost
- **Settings** (`/settings`) — a per-user spend card, plus a Claude plan-limits panel that
  only appears if the SDK can actually read plan limits

> **Superseded (2026-08-02):** sections 3 and 4 below have moved to their own page — usage now
> lives at **`/usage`**, not under Settings, and the spend card is headed "Your spend". See
> `.fe/test-scenarios/usage-nav-page.md`. The *content* checks below still apply; only the
> location changed. Sections 1, 2 and 5 are unaffected.

Run the app with `pnpm dev` (Docker) and open http://localhost:3001, signed in.

> **Blocker for section 1 on the current machine:** `/tasks/<id>` returns 500 for every task
> because the live `data/platform.db`'s `task_events` table is corrupt (`SQLITE_CORRUPT` —
> pre-existing, unrelated to this change; see `.fe/notes.md`). Section 1 needs a healthy
> database. Sections 2–5 work today.

## 1. Task detail — usage line (`/tasks/<id>`)
1. Open a task that recorded usage (any completed run with a cost). Under the chip row and
   the project path, a line reads:
   `[coins icon] Input 12.4k · Output 3.1k · Cache read 537M · Cache write 84k · Cost $24.59`
   Labels are faint, values mono; the cost value is the strongest text in the line.
2. Open a task from before usage tracking, or one whose subprocess was killed mid-turn (e.g.
   any task showing `$0.00` in history). **Expected: no usage line at all** — not a row of
   zeros. "No usage recorded" is not the same as "free".
3. Open a task where tokens were recorded but no cost: the four token items appear and the
   **Cost item is omitted** (rather than `$0.00`).
4. Dispatch a new task and stay on the page. When the run finishes, the page refreshes
   itself and the usage line appears/updates without a manual reload. (During the run it is
   a snapshot — usage is only banked at turn boundaries.)

## 2. Task history rows (`/projects/<id>` → Task history)
1. Rows that recorded a cost show it in mono, immediately left of the timestamp and status
   badge — e.g. `$23.66`.
2. Rows with no recorded cost show **nothing** in that slot; the row layout doesn't shift.
3. Click a row — it still navigates to the task; the cost is not interactive.

## 3. Your usage (now `/usage`, was `/settings`)
1. A **Your spend** card headed `N tasks dispatched by you`.
2. With spend recorded: four tiles — **Total spend**, **Last 30 days**, **Tokens**,
   **Billed tasks** — then the token breakdown line, then **Most expensive runs** (up to 5
   rows: title, relative time, cost). Each row links to its task.
3. A run with no title falls back to a mono `/command`; a very long title truncates with an
   ellipsis instead of widening the card.
4. With no spend of your own: a dashed **"No usage recorded yet"** empty state instead of
   the tiles.
5. If any tasks predate per-user attribution, a footnote reads
   *"A further $459.61 across 90 tasks predates per-user attribution and isn't counted
   above."* — check the wording has normal spacing (an earlier build rendered
   "90 taskspredates").

## 4. Claude plan limits (now `/usage`, was `/settings`)
1. **Expected on this deployment: the card does not exist.** No "unavailable" message, no
   empty card, no error, no loading skeleton — the section is simply absent. This is correct:
   plan limits aren't readable with a token injected via the environment (`.swe/notes.md`).
2. To see the populated state, temporarily seed `useState` in `components/PlanLimits.tsx`
   with windows (`five_hour`, `seven_day`, …). Expect: a **Claude plan limits** card with a
   violet subscription chip, one labelled bar per window, the percentage in mono on the
   right, and "Resets in 3h 12m" / "4d" / "1d 4h". Bar colour: green under 75%, amber
   75–89%, red 90%+. A window with no utilization shows "Utilization unknown" and no bar.
   **Revert the seed afterwards.**

## 5. Responsive, dark mode, accessibility
1. **375px:** the task usage line wraps onto multiple rows (no horizontal page scroll); the
   history row's cost and timestamp are hidden below `sm` so the row keeps command + title +
   status; the settings tiles are 2-up (4-up from `lg`); the "most expensive runs" rows wrap.
2. **Dark mode** (theme control in the sidebar): every surface, border, and text tone
   follows the theme — no light-mode artifacts, no stuck-white panels. The utilization bars
   keep their green/amber/red meaning in both themes.
3. **Screen reader:** the task usage line is a definition list, so each value is announced
   with its label ("Input, 12.4k"). A history-row cost is announced as "Cost $23.66" (via an
   `sr-only` prefix). Each utilization bar is a `progressbar` with a name
   ("5-hour window used") and `aria-valuenow`.
4. **Colour is never the only signal:** every bar prints its percentage as text, so the
   green/amber/red is redundant.
5. **Keyboard:** tab through the settings usage card — the "most expensive runs" rows are
   plain links with the global focus outline. Nothing new traps focus.

## Known non-blocking notes (out of scope)
- `tasks.userId` has no DB index, so `/settings` runs four full scans of a ~92-row table.
  Fine now; worth an index if task volume grows. Pre-existing, backend.
- `PlanLimits` swallows fetch errors silently (by design — "no data" must never render as a
  broken card), which also means a genuine runner regression is invisible in the console.
- Usage on the task detail page is a snapshot; it doesn't tick during a run, it refreshes
  when the run ends.
