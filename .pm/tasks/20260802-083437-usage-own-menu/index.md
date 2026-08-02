# Usage: own nav menu instead of Settings

## Request
User request: "usage should be displayed in a new menu named 'usage' instead of settings.
Also, like the attached image, claude shows how much we have used in percent, I need a plot
like it as well in the usage page to see how much of my tokens remain." Attached a screenshot
of Claude's own "Your usage limits" panel: per-window progress bars (Current session, All
models, a per-model row) each with a `% used` figure and a reset countdown.

## Request assessment
- **Verdict:** PARTIAL
- **What was asked:** (1) move usage off the Settings page onto its own "Usage" nav item; (2)
  add a percent-used plot for remaining tokens like the attached Claude screenshot.
- **What the code actually does:** Usage today lives inside `app/(app)/settings/page.tsx`,
  which renders `TokenSettings`, `UsageSummaryCard` (real per-user spend, `lib/usage-summary.ts`),
  and `PlanLimits` (`components/PlanLimits.tsx`). `PlanLimits`'s `WindowBar()` already draws a
  labeled progress bar per rate-limit window (`five_hour`, `seven_day`, `seven_day_opus`, …)
  with a `%` used figure and a "Resets in …" countdown, sourced from `/api/usage` →
  `runner/usage-snapshot.ts` — the same visual shape as the screenshot. Nav is one shared list,
  `components/nav-links.tsx` (`NAV_LINKS`), consumed by both `Sidebar.tsx` and `MobileNav.tsx`;
  there is no "Usage" entry today, only Dashboard/Agents/Projects/Settings.
- **Already implemented?** Part 1: no — real navigation gap. Part 2: yes, at
  `components/PlanLimits.tsx`, but it usually renders nothing. This app injects each user's
  Claude token via `Options.env` rather than a logged-in profile, which the SDK's experimental
  usage API reports as lacking "profile scope" (`available: false` in the normal case) — a
  documented, previously-decided behavior (`.pm/notes.md`, 2026-07-29: "best-effort, hidden
  when unavailable"). No amount of new frontend work changes an SDK/auth-architecture
  limitation; the existing component is the correct one to carry forward.
- **Risks/conflicts:** None. `graphify affected "SettingsPage"` returns no dependents, and
  `UsageSummaryCard`/`PlanLimits` are only imported from the settings page today, so relocating
  them is isolated. `TokenNudge`/`NewTaskForm` keep linking to `/settings` for the token vault,
  unrelated to usage.
- **Real need:** A discoverable, dedicated "Usage" section separate from account/token
  settings, showing spend plus (whenever the SDK can supply it) the same percent-used bars
  Claude's own UI shows — a chart that already exists; the gap is placement/navigation.
- **Recommendation:** Proceed with the navigation move as a single frontend task. Don't build a
  new chart for part 2 — carry `PlanLimits` over as-is. If the bars still don't appear on the
  new page, that's the known SDK limitation, not a bug that further UI work can fix.

## Tasks
- **[fe] Move usage to its own "Usage" nav page** —
  `01-frontend-usage-own-menu.md`
