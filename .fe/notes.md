# Frontend Notes & Gotchas

_Read before acting · update after every decision or change · keep entries short and accurate_

## Next.js version warning
This project uses Next.js `16.2.9` — far beyond the public release train. Per `AGENTS.md`, read `node_modules/next/dist/docs/` before writing any Next.js code. Route params are typed as `Promise<{id: string}>` (async params), and pages use `export const dynamic = "force-dynamic"`.

## Tailwind CSS v4 — no config file
Tailwind v4 uses a CSS-first config model. There is NO `tailwind.config.ts`. Custom theme tokens go into the `@theme inline {}` block in `app/globals.css`. Utility classes are generated from CSS variables automatically. Don't create a `tailwind.config.*` file — it's not the v4 pattern.

## Light + dark via a semantic token layer (NOT `dark:` classes)
**Superseded the old "dark-only" rule (2026-07-29).** The app now supports `light | dark | system` (default `system`).

Do **not** write `dark:` variants and do **not** use raw palette shades (`neutral-800`, `sky-400`, …) in components. Use the semantic utilities generated from `@theme inline` in `app/globals.css`:
- Surfaces: `bg-canvas`, `bg-surface`, `bg-surface-2`, `bg-surface-3`, `bg-sunken`, `bg-overlay`, `bg-hover`
- Borders: `border-line`, `border-line-strong`
- Text (strong→faint): `text-fg-strong`, `text-fg`, `text-fg-muted`, `text-fg-subtle`, `text-fg-faint`, `text-fg-ghost` (**`fg-ghost` is decorative only — it does not meet AA; use `fg-faint` for real text, including placeholders**)
- Accent: `text-accent`, `text-accent-hover`, `text-accent-contrast`, `ring-ring`
- Tones (`ok`/`danger`/`warn`/`info`/`violet`/`muted`): `bg-<t>-soft`, `text-<t>`, `border-<t>-line`

`:root` holds light values, `.dark` holds dark values; a `@custom-variant dark` exists as an escape hatch but shouldn't be needed. **Every token pair was contrast-checked** — if you change one, re-check it.

## Theme + sidebar state live on `<html>`, not in React
`lib/theme.ts` and `lib/sidebar.ts` export blocking init scripts (injected in `app/layout.tsx`) that set `class="dark|light"`, `data-theme-mode`, and `data-sidebar` **before first paint** — otherwise you get a flash of the wrong theme / an expanded rail snapping shut. Components read that state with `useSyncExternalStore` (never `useState` + effect — see the set-state-in-effect rule below). `<html>` carries `suppressHydrationWarning` because the script mutates it pre-hydration.

The sidebar's collapsed **visuals** are pure CSS via the `rail:` custom variant (`w-60 rail:w-16`, `rail:hidden`), so width is correct on first paint; React reads the state only for ARIA attributes.

## There IS a test suite now (superseded "no test suite", 2026-08-01)
`pnpm test` runs Node's built-in runner via `tsx` over `runner/*.test.ts` **and** `lib/*.test.ts` — no extra deps. Pure UI logic belongs there (`lib/usage-format.test.ts` is the frontend-side example). There's still no DOM/component test tooling, so rendering and interaction are verified by hand; don't invent a React testing setup without agreeing it with the user first.

## Usage lives at `/usage`, not under Settings (2026-08-02)
`UsageSummaryCard` + `PlanLimits` moved out of `/settings` onto their own top-level
`app/(app)/usage/page.tsx` (nav entry in `NAV_LINKS`, `Gauge` icon). Settings is the token
vault only. The card's own heading is **"Your spend"**, not "Usage" — it sits under the
page's `<h1>Usage</h1>` and a duplicate heading is noise when navigating by headings.

## Filter state that drives a server component belongs in the URL (2026-08-03)
`/usage`'s range filter (`SpendRangeNav`, 7d/30d/all) is **three `<Link>`s**, not the
`role="radiogroup"` buttons `ThemeToggle` uses. The theme lives in `localStorage` and can only
be read on the client; a filter that changes server-rendered data is just navigation. Links
keep both spend cards server components (no fetch, no loading flash, zero client JS), make the
range bookmarkable and back-button-able, and match how `Sidebar`/`MobileNav` already mark an
active link (`aria-current="page"`). `role="radio"` on something that navigates also lies to a
screen reader — and a real radiogroup would owe you roving-tabindex arrow keys. Reach for the
radiogroup shape only when the state genuinely can't leave the client.

The page parses `?range=` leniently (`parseRange(...) ?? "all"`) while `/api/usage` 400s on the
same input — a page with a good default shouldn't error on a stale bookmark; an API should.
Next 16 note: `searchParams` is a **`Promise`**, so the page has to `await` it.

**lucide-react here is v1** (`^1.21.0`): `BarChart3` no longer exists (it's `ChartColumn`),
and several other v0 names were renamed. Grep `node_modules/lucide-react/dist/lucide-react.d.ts`
for `declare const <Name>` before importing an icon from memory.

## `drizzle.config.ts` hardcodes the LIVE db — always pass `--url` explicitly
`npx drizzle-kit push` with `PLATFORM_DB=…` in the env **ignores it** and targets
`./data/platform.db`, because the config file hardcodes that path and nothing reads the env
var. To build a throwaway DB, pass the flags the tests use:
`npx drizzle-kit push --dialect=sqlite --schema=./lib/db/schema.ts --url=/tmp/x.db --force`.
(`PLATFORM_DB` *is* honored by `lib/db/index.ts` at runtime — it's only the drizzle-kit CLI
that doesn't see it.)

## Verifying a page without touching the live DB
Better than seeding a session into `data/platform.db` (which has corrupted twice — see the
root memory): run a second instance against a throwaway file —
`PLATFORM_DB=/tmp/x.db npx next dev --port 3099`, `POST /api/auth/signup` for a cookie, then
curl the pages. Fully isolated, and you can seed tasks/spend freely to see populated states.

## Usage display: zeros are not "free", and plan limits normally don't render
- A task row's `usage*` columns read 0 both for tasks that predate usage tracking and for runs whose subprocess was killed before reporting. `hasUsage()` in `lib/usage-format.ts` is the single gate: **render nothing rather than `$0.00`.** Sub-cent spend shows as `<$0.01` for the same reason.
- `formatCost` pins `toLocaleString("en-US", …)`. These values render in server *and* client components, so an unpinned locale is a hydration mismatch waiting to happen.
- `PlanLimits` renders **nothing** unless `/api/usage` reports `rateLimits.available` — which on this app is essentially never (env-injected tokens have no profile scope; see `.swe/notes.md`). That's the designed state, not a bug: no error, no skeleton, no empty card. To see it, stub the state locally. Consequence for `/usage`: with no spend recorded the page is just the header + an empty state, because the *only* other card is one that normally doesn't render.
- Most of this instance's history is unowned (`user_id IS NULL`), so per-user spend reads ~$0 next to hundreds of dollars of real history. The `unattributed` footnote on the usage card exists so the page doesn't look broken. That bucket is **all-time by design** and doesn't follow the range filter, so the footnote says ", all time," out loud whenever a window is selected — otherwise it reads as "a further $459 in the last 7 days".
- With a range filter in play, "no spend" has two different meanings and they need different copy: *nothing ever* ("No usage recorded yet") vs *nothing in this window* ("No spend in the last 7 days… try a wider range"). `isFiltered()` + `NO_SPEND_IN_RANGE_HINT` in `lib/usage-format.ts` keep the two usage cards saying the same thing.

## Interleaving `{expr}` with prose drops the spaces between them
`{n} task{n === 1 ? "" : "s"} predates …` rendered as **"90 taskspredates"** — JSX dropped the leading space of the text node after the expression. Build sentences that mix counts and words as a **single template string** (`{`${n} tasks predates …`}`), or the missing space only shows up in the browser. Found by curling the real page, not by reading the JSX.

## Verifying rendered pages without a browser
There's no Playwright/Puppeteer here. To check real markup: mint a session row directly (`sessions.id = sha256(token)`, see `lib/auth.ts`), `curl -H "Cookie: session=<token>" http://localhost:3001/…`, inspect the HTML, then delete the session row. Client-only branches still render, because App Router SSRs client components — temporarily seeding a `useState` initial value is enough to see them.

## One task row for the whole app — `components/TaskList.tsx` (2026-08-11)
Task rows had drifted into three implementations, and two of them rendered `requestText`
while `tasks.title` (generated at dispatch) sat unused — so the same history read as prose on
the dashboard and as an intent on project detail. `TaskList` is now the only task row;
`TaskHistory` is a `CardSection` wrapper around it. **Add a task list by composing
`CardSection` + `TaskList`, never by writing row markup.** The fallback chain lives in
`taskDisplayTitle()` (`lib/ui.ts`, unit-tested in `lib/ui.test.ts`) precisely because
inlining it is what let two call sites drop the title; the task detail `<h1>` uses it too.
The card shell stays out of `TaskList` — the three hosts head their cards differently
("Task history" + count, "Recent activity", "Recent runs" + count).

Two things reviewers have asked about, so they're settled here: **`v<version>` shows on every
row, including agent detail** where the agent is the same for all of them — because
`tasks.agent_version` is a per-run *snapshot* and an agent can be updated between runs, so the
column genuinely varies down the list. And **`UsageSummaryCard`'s "Most expensive runs" is
deliberately not a `TaskList`**: it reads a narrow `TaskSpend` projection (no status, no agent,
no tokens), is ranked by cost rather than time, and leads with the cost figure. It shares
`taskDisplayTitle()` so an untitled task is named the same way, and nothing else.

## `/tasks` — the cross-project task page (2026-08-11)
`app/(app)/tasks/page.tsx` sits *beside* the existing `[id]/` route in the same folder, so the
nav entry and the task detail page share a prefix — which is what `isActive` wants
(`startsWith`), so `/tasks/<id>` keeps Tasks lit. Server component, one `ownedBy()` query,
grouped in JS by `projectId`; because the query is already `desc(createdAt)`, plain `Map`
insertion order puts the most recently active project first, no second sort.

Three decisions worth not relitigating:
- **Unfiltered groups cap at 8 rows and *disclose* the remainder** ("6 older tasks in this
  project — show all"); filtering to one project lifts the cap entirely. A project with years
  of history would otherwise bury every other project on a page whose whole job is the view
  *across* projects — and once you've asked for one project, capping it is just an obstacle
  (project detail is uncapped too). Same "disclose, never truncate silently" rule as
  `ProjectSpendCard`.
- **A stale `?project=` keeps the filter bar and shows a recoverable empty state**, rather
  than silently falling back to everything. The lenient-parse rule from `/usage` applies to
  *malformed* input (an array from a repeated param, an empty string) — but an id that simply
  matches nothing is a real, answerable question, and silently showing all projects would look
  like the filter is broken.
- **Only projects with ≥1 task appear in the filter.** Tasks are per-owner while projects are
  shared, so on a shared install most projects legitimately have none of *your* runs; offering
  them is offering a guaranteed-empty list.

Verified against a seeded throwaway DB including a task owned by a second user — it does not
appear, which is the `ownedBy()` contract holding at the one place that could leak history.

## `/backlog` — one project at a time, and the nav's label budget ran out (2026-08-12)
The seventh nav entry is the one the tab bar couldn't label: seven `flex-1` tracks at 320px are
~45px, narrower than "Dashboard", "Projects" or "Backlog" itself. The label is now
`sr-only sm:not-sr-only` — **icons only below 640px** — with `py-3 sm:py-2.5` keeping the
icon-only target at 44px. The word never stops being the link's accessible name, so nothing is
lost to a screen reader. The rejected alternative was an iOS "More" tab: two destinations behind
a second tap, plus a sheet with its own focus management, to save a label that the `sm`
breakpoint gives back anyway.

The page itself is a **server component with `?project=` in the URL**, like `/tasks` and
`/usage` — but for one extra reason beyond bookmarkability: `GET /api/projects/:id/backlog`
performs the `.pm/tasks/` scan, and that scan is a documented DoS budget *per project*. Showing
every project's backlog on one page would multiply it by the project count on an unauthenticated
route, so the page shows one project and pays for exactly one scan, same as the API. Both go
through `loadProjectBacklog()` in `lib/backlog.ts`; the route is now a 3-line translation of it.
A second implementation would have dropped the same two things — the sync that makes the list
current, and the `warnings` that stop "nothing imported" reading like "nothing to import".

Three decisions worth not relitigating:
- **The status control renders `item.status` straight from the server, with no optimistic
  copy.** Both the spec sync and the linked-task reflection can move a row from underneath the
  client, so a local value would need reconciling with the props — which is `setState` in an
  effect, a hard error in this build (see the React lint note above). The `Select` value simply
  changes when `router.refresh()` lands.
- **"Open task" only appears on a run the viewer owns.** The backlog is shared install-wide but
  `/tasks/<id>` is `ownedBy`-scoped, so linking every `linkedTask` would hand half the rows on a
  shared install a guaranteed 404. The page resolves ownership server-side and passes a boolean;
  the badge still shows for everyone, because *that this ran* isn't private — the transcript is.
- **A synced item's `description` is the spec file verbatim**, frontmatter included, so
  `specBody()` (`lib/pm-spec.ts`) strips it for the preview. Without that, the first 160
  characters of every imported item are `--- title: … stack: … assignee: …`, which is the least
  informative part of the file.

**Guard the handler, don't disable the control that has focus.** Both mutating rows here refuse
a second request with `if (busy) return` rather than a `disabled` prop. `Select`'s trigger *is*
the focused element the instant its `onChange` fires (`choose()` calls `triggerRef.focus()`), and
disabling a focused button makes the browser move focus to `<body>` — dumping a keyboard user
back to the top of the page for the ~200ms a PATCH takes. Same reasoning for the Add-item
dialog's `close()`: Escape, the backdrop and the header ✕ all route through `Modal`'s single
`onClose`, so guarding that one function is what stops a request outliving the dialog and
clearing fields the user has since retyped. (Both were blocking findings from the frontend
auditor; the shapes above are the fixes.)

Verified against a throwaway DB seeded with this repo's own `.pm/tasks/` (18 synced items), an
agent-filed item, a done item linked to the viewer's task, and one linked to another user's —
the last renders its badge with no link, which is the ownership rule holding. The 50-row section
cap and its `?all=1` disclosure were checked with 60 seeded items.

## Verifying a page: `next start` on a throwaway DB, not a second `next dev`
The documented recipe (`PLATFORM_DB=/tmp/x.db npx next dev --port 3099`) **dies when the dev
container is already running** — two `next dev` processes fight over `.next/`, and the second
exits silently, so you get connection-refused and no error anywhere. Use the production build
instead: `pnpm build` once, then
`docker exec -d platform sh -c 'PLATFORM_DB=/tmp/x.db npx next start -H 0.0.0.0 -p 3099 > /tmp/log 2>&1'`
and curl from inside the container. `next start` only reads `.next`, so it can't disturb the
dev server, and it's what installs actually run. Two container gotchas: **`ps`, `pkill` and
`kill` don't exist** in the image (walk `/proc/*/cmdline` and use the shell builtin via
`sh -c 'kill <pid>'`), and no session cookie is needed at all — `getCurrentUser()` inserts and
returns `user_local` when there's no session, so seeding tasks with `user_id = 'user_local'`
makes them visible.

**Killing that server needs the right pattern, or you verify a stale build.** `next start`
renames its process to `next-server (v16.2.9)` — the port is *gone* from its cmdline — so
walking `/proc/*/cmdline` for the port number only finds the `sh`/`npm exec` wrappers. Kill
those and the real server keeps the port, the next launch can't bind, and you spend a while
wondering why a rebuilt page still renders the old markup (this cost me a round trip: a Run
button kept rendering at its pre-fix size). Match `*next-server*` as well — and take care not to
kill the container's own dev server, which is the low-PID one of the same name.

## The activity badge — chrome that takes a row, not a floating corner (2026-08-12)
`ActivityBadge` is the app's only global sign that agents are working. Four decisions in it are
the ones worth not relitigating:

- **It gets its own sticky row above `<main>`, not `position: fixed` in the corner.** The spec
  asked for a fixed top-right element; measured against the real pages, that lands on top of
  `PageHeader`'s `actions` — `/usage`'s `SpendRangeNav` and `/backlog`'s "Add item" — at every
  width from `md` up, and badly at 768px, where the content column fills its track and there is
  no right gutter to float in. The row is `sticky top-0 z-30` and carries **no vertical padding
  of its own** (the pill supplies `my-2`), so with the badge rendering `null` the row collapses
  to 0px and an idle app is the layout it was before. Cost, accepted: ~48px of content shift
  when a run starts and again when it ends — the same behaviour `UpdateBanner` already has, and
  strictly better than covering a control. Below `md` there is no row at all; the badge goes in
  `MobileTopBar`, because a phone can't spare a second strip of chrome.
- **Two mounts, one poll.** The desktop strip and the mobile bar are both mounted (CSS decides
  which is visible), so two `useEffect` pollers would double the request rate to show the same
  number. `lib/active-tasks.ts` is a module-level store read through `useSyncExternalStore` —
  the `lib/sidebar.ts` shape — with polling ref-counted to the subscriber set and paused on
  `document.hidden`. `sameActiveState()` is what stops a re-render every 5s when nothing moved.
- **A dedicated `GET /api/tasks/active`, not a poll of `GET /api/tasks`.** The latter answers
  with every column of every task you own: 106 rows / ~150 KB here, growing for the life of the
  install, from the process that also serves the SSE transcript streams. At 5s that's ~30 KB/s
  forever to render a number. The new route is `ownedBy`-scoped, filters on the shared
  `ACTIVE_STATUSES`, and returns five short fields per active run.
- **The pill is `bg-surface` + `border-warn-line`, not `bg-warn-soft`.** `--warn-soft` is
  `rgb(245 158 11 / .15)` in dark mode — translucent — and this element floats over scrolling
  page content. Any *floating* element in this app needs an opaque surface token; let the border
  and text carry the tone. Worth remembering before reaching for a `*-soft` background again.

**A self-rescheduling poll must `clearTimeout`, never just drop the handle.** `tick()` first
did `timer = null` at its entry. Hide the tab *during* an in-flight poll and the hidden branch
found `timer` already null, so its clear was a no-op; the resolving tick then scheduled a fresh
timeout while still hidden, and the catch-up tick on return orphaned that timeout instead of
cancelling it — so when it fired, the app had **two** interleaved tick→schedule chains, each
rescheduling forever. The poll rate doubles, compounds with every further hide/show, and
nothing on screen looks wrong. Fixed by clearing at entry and refusing to schedule while
hidden; `lib/active-tasks.test.ts` stubs `document`/`fetch` with `mock.timers` and asserts
**exactly one request per interval**, which is the only way this class of bug is visible.

**Closing a popover on navigation is a render-time state reset, not a derived value.** The
first shape derived `open` from `openedAt.path === pathname`. It closed on the way out but
never *cleared*, so returning to the page it was opened on — Back button, or clicking that nav
entry again — popped it open again with nobody having touched it. The fix is React's documented
"adjust state when something changes" pattern (`if (shownFor !== pathname) { setShownFor(...);
setOpenState(null) }` in the render body), which is explicitly **not** the forbidden `setState`
in an effect. Both of these were blocking findings from the frontend auditor.

**Say "in progress", not "running".** `ACTIVE_STATUSES` includes `queued` and the two
`awaiting_*` gates — states where nothing is running and *you* are the hold-up — and the
dashboard stat tile and `AtAGlance` have always called this set "In progress". The badge said
"running" and the design reviewer called it drift. A test pins the word.

And **the popover survives its own count reaching zero while open**: unmounting mid-interaction
would drop keyboard focus to `<body>`, the same failure mode as disabling a focused button (see
the backlog note), so it stays and says "Nothing in progress now" until the user closes it.

**Put the accessible name in the markup, not in an `aria-label`.** The pill's word is
`sr-only sm:not-sr-only` (the `MobileTabBar` trick) rather than `hidden sm:inline`, so the name
is "2 in progress" at *every* width and WCAG 2.5.3 Label in Name holds by construction. With an
`aria-label` it held only while two separate strings happened to agree — and `display:none`
would have dropped the word from the name entirely below `sm`, leaving a button called "2".

One knock-on: adding the badge to `MobileTopBar` pushed that row over its width budget at
320px, so the brand link is now `min-w-0` + `truncate` and the icon cluster `shrink-0`. The
brand is what gives; the controls aren't allowed to.

Verified against a throwaway DB (`next start` recipe below) seeded with queued /
awaiting_proposal / building runs, a finished one, and **one owned by a second user** — the API
returns 3 and omits the other user's, which is the `ownedBy()` contract holding on a route that
is polled from every page. Markup was inspected by temporarily seeding
`getServerActiveTasksSnapshot()` + the open state, since the badge SSRs to `null` by design.

## `fg-ghost` is the regression this project keeps having (2026-08-13)
Third time. A design audit found **ten** more uses of `text-fg-ghost` on real text after the
token doc already recorded fixing it twice. All ten are now `fg-faint`; a grep for
`text-fg-ghost` should return `aria-hidden` icons, `Markdown` list markers and one
`bg-fg-ghost` status dot, and nothing else.

Why it keeps happening: `fg-ghost` *looks* right for anything you want to de-emphasise, and
every one of these was a deliberate de-emphasis — a path, a file size, a version stamp, a
"no runs yet" fallback. **De-emphasised is not decorative.** The test isn't "is this
important", it's "is this a character a sighted user could want to read" — if yes it's text,
and `fg-ghost` (≈3.25:1 in light) fails AA for it. Two of the ten were in `Sidebar`, which the
audit itself had filed under "consistent micro-typography, not a violation", so it's worth
grepping the whole tree rather than trusting a component's reputation.

## One field primitive, one button primitive — check before hand-rolling (2026-08-13)
`components/ui/input.tsx` now carries `size` (`sm|md|lg`) and `tone` (`default|danger`), which
was the whole reason five inputs had been hand-rolled: the defaults didn't fit, so each call
site rebuilt the treatment and drifted its focus ring (`focus-visible:ring-ring/40` against the
canonical `focus:ring-accent/30`). Extending the primitive was ~15 lines and deleted all five
copies. Same for `Button`, which gained a `warn` variant and absorbed six more hand-rolled
treatments including `GitControls`' local `syncBtn` class string.

Two gotchas from doing it:
- **`fieldClasses` is a function now**, not a string (`fieldClasses("md", "default", extra)`),
  matching `buttonClasses()`. Its one existing caller (`AddBacklogItem`'s textarea) was updated.
- **The field is `w-full`, so a fixed width needs `max-w-*`, not `w-*`.** Two width utilities of
  the same specificity race in the generated CSS and Tailwind's output order — not the class
  attribute's order — decides. `DataSettings`' UNINSTALL field is `max-w-44` for this reason.
- `Button` spreads `{...rest}` *after* its own `type="button"`, so `type="submit"` still works
  when you need a real submit button (`GitControls`' Create).

**Two deliberate visual side effects of adopting the primitive** — recorded so neither gets
rediscovered later as a regression:
- `ProjectName`'s rename-in-place field went from `bg-sunken` to the primitive's `bg-surface-2`.
  Kept: `surface-2` sits further from `canvas` than `sunken` does in *both* themes, so the
  field reads more clearly as editable than the thing it replaced.
- `AddProjectForm`'s field went from `border-line` to `border-line-strong`. That's the
  design system's own stated rule for inputs (`border-line-strong`), so the migration
  *removed* drift rather than introducing it.

## The dashboard is the onboarding surface (2026-08-13)
`components/GettingStarted.tsx` — token → project → first task, `null` once all three hold.
Decisions worth not re-litigating:
- **It replaces `TokenNudge` on the dashboard**, and only there. The token is step 1, so
  rendering both put the same sentence on screen twice. `TokenNudge` still stands alone on
  project detail and backlog, where a full checklist would be off-topic.
- **One CTA at a time**, on the first incomplete step. Three buttons is not a checklist.
- **The three nouns are defined in the card's own intro**, not spread across three pages —
  that was the actual audit finding (a new user had to reverse-engineer what an "agent" was).
  The page headers on `/agents`, `/projects` and `/tasks` now each restate their own noun.
- State is `sr-only` text ("Done: ", "Next: ", "To do: ") before each step title, because a
  green check and a tinted row are colour-only signals.
- It takes `hasProject`/`hasTask` as props rather than querying — the dashboard has already
  run both queries, and a server component doing them again is two wasted round-trips.
  (`getCurrentUser()` *is* called twice, but it's `cache()`-wrapped in `lib/auth.ts`, so it
  dedupes per request.)

Two layout traps this hit, both worth knowing generally:
- **The warn tone had to go on the row, not the card.** `card` already contains
  `border border-line`, so `${card} border-warn-line` puts two same-specificity border-colour
  utilities on one element and the *emitted CSS order* decides — not the class attribute's
  order. It happened to render correctly, which is worse than failing. Tone an element whose
  classes you own end to end.
- **`flex-wrap` doesn't wrap anything if a sibling can shrink to nothing.** The step rows are
  `flex flex-wrap` with a `min-w-0 flex-1` text column and a `shrink-0` button. Rather than
  wrapping the button, flexbox collapsed the text to a sliver — at 390px the explainer wrapped
  one word per line. The floor (`min-w-40`) is what forces the wrap; `min-w-0` is only right
  when the child is *supposed* to truncate.

## Headless Chrome screenshots of this app need `--virtual-time-budget` (2026-08-13)
`--headless=new --screenshot` waits for the load event, and pages here hold open connections
(`ActivityBadge` polls, `UpdateBanner` fetches `/api/updates`, which reaches out to the GitHub
Releases API and can hang for minutes offline). Chrome then never exits and the shell call
times out with no file written. Add `--virtual-time-budget=5000` and background the process
with a hard `kill -9` fallback. macOS has no `timeout(1)` — that's coreutils' `gtimeout`.

## Component library: bespoke only
No shadcn/ui, Radix, or MUI. All components are handbuilt. Reuse `Chip`, `Tile`, `Fact`, `card`, `CardSection`, `PageHeader`, `EmptyState` (from `ui-cards.tsx`), `StatusBadge`, and the `components/ui/` primitives before writing new ones.

## Buttons and modals are primitives — don't hand-roll them
- **`components/ui/button.tsx`** — `Button` / `buttonClasses()` with `variant` (`primary`, `success`, `secondary`, `ghost`, `danger`, `accent`) and `size` (`sm`, `md`, `icon`), plus a `loading` prop that renders the spinner, disables, and sets `aria-busy`. This replaced **11 drifted button treatments**; don't reintroduce a bespoke button.
  - The `primary`/`success` gradients are deliberately dark-stopped (`sky-700→blue-600`, `emerald-700→emerald-800`) so white text clears AA against the **lightest** stop. Don't lighten them.
- **`components/ui/modal.tsx`** — `Modal` provides `role="dialog"`, `aria-modal`, an accessible name, Escape-to-close, a focus trap, focus restore, and body-scroll lock. `DiffModal`/`FileModal` build on it; don't re-implement an overlay.

## SSE for live task view
`TaskLiveView` uses `EventSource` (SSE) to stream task transcripts. The runner at `runner/server.ts` (Hono, port separate from Next.js) is the SSE source. The Next.js dev server and runner must both be running (`pnpm dev` starts both via `concurrently`).

## Agent avatar images
Agent avatars live in `public/` as `<namespace>-agent.png` (e.g. `fe-agent.png`, `swe-agent.png`). The `Avatar` component (`components/AgentAvatar.tsx`) takes a `namespace: string` prop — NOT `agentId`. The `AgentContributors` component also takes `namespaces: string[]` not `agentIds`.

## TaskLiveView requires all 5 props
`TaskLiveView` needs `taskId`, `runnerUrl`, `initialStatus`, `projectId`, and `agentId` — don't pass fewer; the component uses all of them for SSE connection and action routing.

## Grid needs an explicit `grid-cols-1` base
A bare `grid` with only a `lg:`/`md:` column class (e.g. `grid gap-5 lg:grid-cols-2`) has NO column template below that breakpoint, so it falls back to a single implicit `auto` column sized to max-content → horizontal page overflow on mobile. Always write `grid grid-cols-1 … lg:grid-cols-2`. `grid-cols-N` resolves to `minmax(0,1fr)` which clamps the track. (This was the project-detail horizontal-scroll bug.)

## CardSection for card + header blocks
Use `CardSection` (`components/ui-cards.tsx`) instead of hand-rolling `<section className={card}><div header><h2>…</h2></div>`. Props: `title`, `right?` (header right slot), `className?`. It carries `min-w-0` so it shrinks inside grid/flex parents. The project detail page's four blocks (`AtAGlance`, `SourceControl`, `TaskHistory`, New task) all build on it.

## `pnpm build` fails natively in OrbStack Linux
Running `pnpm build` outside Docker fails with `invalid ELF header` on `better-sqlite3.node` because that native binary is compiled for macOS on the host. The full dev/build cycle must run inside Docker (`pnpm dev`). Lint (`pnpm lint`) works natively.

## Shared `Select` lives in `components/ui/select.tsx`
The base, **searchable** select/combobox is `components/ui/select.tsx` (the first component in a new `components/ui/` base-primitive folder). It replaces every native `<select>` — `NewTaskForm` (agent/command/model) and `GitControls` (branch switcher, search-on). Options are passed as a `{value,label,description?,icon?}[]` array (not `<option>` children). `className` controls width/layout (root is `relative inline-flex`); pass `w-full` to fill a flex parent, `min-w-48` for a floor. Search auto-enables past 7 options. **Don't** reach for a native `<select>` or hand-roll a wrapper again.

## React lint: no `setState` inside `useEffect` bodies
This Next 16 / React build errors on `react-hooks/set-state-in-effect` — calling a state setter synchronously in an effect body is a hard error (not a warning). Do resets in event handlers (e.g. an `openMenu()` helper) and **derive** values at render time (clamp an index with `Math.min` instead of correcting it in an effect). Effects may only do DOM/external sync (focus, scrollIntoView), never `setState`.

## The task detail page currently 500s — the live DB is corrupt (2026-08-01)
`/tasks/<id>` returns 500 for **every** task on this instance: reading `task_events` throws `SQLITE_CORRUPT: database disk image is malformed` (even `PRAGMA integrity_check` throws). Verified against a clean tree, so it predates the usage work. `data/platform.db.corrupt.old` shows this has happened before. Every other route is fine — the rest of the schema reads normally. Recovery (`.recover` into a fresh file, or restoring `data/backup/`) is the operator's call, not something to run blind.

## RunDuration uses `createdAt`, not `startedAt`
The prop is `createdAt: number` (Unix ms), `endedAt: number | null`, `active: boolean`. The `active` flag controls whether the timer ticks.

## No native OS dialogs — the app runs in a Linux container (2026-08-04)
The Add-project **Browse…** button used to POST `/api/fs/pick`, which ran macOS
`osascript -e 'choose folder'`. In the normal dev path (`pnpm dev` → Docker) `process.platform`
is `linux`, so it always returned 400 *"The native folder picker is only available on macOS"* —
the visible bug. There is no fix that keeps a native dialog: the container has no macOS GUI and
can't reach the host's. `osascript`, `open`, and anything else GUI-bound are off the table for
this app; build the affordance in-app instead.

Replacement: `components/FolderPicker.tsx` (modal folder browser) + `app/api/fs/list` +
`lib/fs-browse.ts`. Browsing is **jailed** to `PROJECT_ROOTS` (compose sets it to the host's
paths — now `$HOME:/Users:/Volumes`, first entry = where it opens, the rest are switchable
roots; the container's own `homedir()` is `/home/node`, so a default would land there instead).
**The mount, not the jail, is the real limit** — widening the roots to a path that isn't
bind-mounted just shows an *empty folder*, and a project there can't run because the runner
can't see it either. That's also why `/` isn't a root: inside the container it's the container's
filesystem, not the Mac's, so it would advertise host paths that don't exist.

Two consequences worth remembering: (1) `parent` is offered whenever the parent is itself inside
*some* root, so multiple roots let you walk up (`~/you` → `/Users`) while a single root stays a
ceiling; (2) with no env var the roots are home **plus** the parents of registered projects —
not one as a fallback for the other, because `/home/node` always exists in the container and a
fallback would therefore never fire.
Jail checks compare `realpathSync` on both sides — a raw string prefix check breaks on macOS
where `/tmp` and `/var/folders/…` are symlinks. Typed paths bypass the picker entirely and are
still unrestricted, which is the escape hatch for symlinked or dot-dir folders (both skipped by
the listing on purpose).

## A new route directory needs a dev-server restart (2026-08-04)
Adding `app/api/fs/list/route.ts` 404'd in the browser for as long as the dev server kept
running, while `.next/server/app-paths-manifest.json` still listed only the route I had just
deleted. File watching over the macOS bind mount misses newly *created directories*, and
`touch`ing files inside the container does not wake it. Restart (`pnpm stop && pnpm dev`).
Debugging note: `curl`ing an `/api/*` route unauthenticated proves nothing — `proxy.ts:31`
answers 401 before Next routes the request, so the route can 404 and you'd never know.

## `app/apple-icon.png` is poison in this Next build (2026-08-04)
Adding the static `app/apple-icon.png` metadata-image convention made **every** page 500 with
`ReferenceError: require is not defined` — `/signin` included, because the failure is in the
root layout's metadata resolution, not in the icon route. Removing the file fixed it instantly.
`app/icon.svg` (favicon) and `app/manifest.ts` are both fine; it's specifically the raster
`apple-icon` convention. Declare the touch icon by path instead:
`metadata.icons = { apple: "/icons/apple-touch-icon-180.png" }`, with the PNG in `public/`.
Another entry for the AGENTS.md "this is not the Next.js you know" list.

## App icons come from one SVG — never hand-edit the PNGs
`pnpm icons` (`infra/icons/generate.mjs`) composes `app/icon.svg` over the brand's dark radial
background and rasterizes 192/512/maskable-512/apple-180 through macOS QuickLook (`qlmanage`) —
there is no ImageMagick or librsvg on the host or in the container, and `sips` can't read SVG.
Change the mark in `app/icon.svg`, re-run, commit the PNGs.

## Dispatching a spec goes through its backlog item, and a failed lookup refuses (2026-08-14)
`FileModal`'s **Create task** used to `POST /api/tasks` directly, so the backlog item the
`.pm/tasks/` sync had already created for that same file stayed `todo` with no `linkedTaskId`
forever — the backlog only learned about runs started from its own Run button. It now resolves
the item first (`GET …/backlog`, which is also what *syncs*, so an on-disk spec is guaranteed
present and fresh) and dispatches via `POST …/backlog/<itemId>/run`. That route already owns
agent selection, the swe fallback, `/pm:plan` for a pm item, title passthrough (no Haiku rename)
and the already-running 409, so the client-side version of all of it became the fallback.

Three things are load-bearing:
- **`specSourcePath()` (`lib/pm-spec.ts`) matches exactly, never by suffix.** The scan keys
  `.pm/tasks/<request>/<file>.md` **relative to the project root**, but the modal's path comes
  from a clickable code span in agent markdown whose pattern also accepts a *nested*
  `web/.pm/tasks/…`. Suffix-matching a workspace member's spec would link the run to a different
  project's identically-named file. `member` is excluded before the lookup for the same reason.
- **A failed lookup is not "no item".** Folding them together means a transient error on that
  GET silently dispatches through a path with no duplicate check — a second concurrent agent
  session on the same spec, on the user's token, editing the same files. The lookup returns
  `none | item | failed` and `failed` refuses with a message; retrying is one click, undoing two
  live runs isn't.
- **The direct fallback's request text stays byte-identical to `backlogRequestText()`**, which
  `lib/backlog.test.ts` asserts, so the same spec produces the same run either way.

`ErrorAlert` (`components/ui/error-alert.tsx`) came out of this: the error-with-a-link pattern
had three hand-rolled copies. The link belongs **inside** the `role="alert"` paragraph — a
sibling is a second live-region announcement — and `dispatchErrorAction()` (`lib/ui.ts`) is the
shared 409→"Open it" / 412→"Open Settings" mapping, unit-tested.

**Verifying a modal without a browser:** temporarily render it from a component the page already
mounts (editing an existing file hot-reloads; a *new* route directory does not — see above),
seed its `useState` initial values, and curl the SSR'd HTML. **And check your viewport is real:**
macOS Chrome clamps a headless window to a **500px minimum layout width**, so `--window-size=390`
silently renders at 500 and crops — which looks exactly like a horizontal-overflow bug on every
page at once. The control that catches it is screenshotting a *centred* layout (`/signin`): if
it renders off-centre, the width is a lie, not the CSS.

## The update banner has states, and the copy for them is unit-tested (2026-08-18)
`components/UpdateBanner.tsx` held four independent booleans (`applying`, `stalled`, `error`,
`activeTasks`) and derived its wording from the combinations. That is *why* it had the two bugs
the pm task found, so the fix is one discriminated `Phase` union (`idle` · `applying` · `blocked`
· `failed` · `stalled` · `uptodate`) plus `lib/update-ui.ts` for everything pure.

- **A refused update needed to be a state, not a relabel.** `POST /api/updates/apply` 409s
  whenever a task is in an active status — which includes a task merely waiting at a gate, the
  most common thing here — and the old bar answered by renaming its own button "Update anyway"
  and printing the reason beside other copy. Same colour, same shape: the first click read as
  nothing happening. Now the bar changes tone, leads with the count, says what pressing on costs,
  and offers *Not now*.
- **The failure reason arrives in ~2s, not at a 6-minute timeout**, because
  `infra/release/control-center.sh`'s `apply_update()` does download → checksum → `pnpm install`
  → `next build` **all before `stop_all`**. The server is still answering for the failures that
  actually happen, so the poll reads `run.state` and shows `die`'s own words. The timeout is now
  only for "nothing can be learned", and it splits on whether the *last* poll got a reply:
  quit-and-reopen is said only when the server really went away (and it's true — `start` applies
  a pending update on the way up).
- **`stale` is honoured for a failure and must not be for `up-to-date`.** An up-to-date attempt
  targets the version it found installed, so `stale` is true by definition there; checking it
  discards the one record that explains why nothing happened.
- **A record keeps its `startedAt` from `running` through to `failed`**, so "is this record mine?"
  can't be answered by the stamp alone. `isFreshRun` compares against the record that was there
  *before we started an attempt*, and the baseline is deliberately `null` when we're **adopting**
  one already in flight (page load with `state=running`, or a 200 carrying `alreadyRunning`) —
  otherwise its own terminal write compares as unchanged and the failure is never reported.
  Two unknown stamps compare as unchanged on purpose: waiting ends in a message about waiting,
  guessing wrong invents a failure that never happened.
- **The primary action is the same element in the same slot in all six states.** Every transition
  is reached by pressing it, and rendering a *different* element there unmounts the button under
  the keyboard user's focus. This is why the visual "unmissable" work is tone + icon + headline
  rather than swapping controls around.
- **Same element is necessary and not sufficient — `loading` disables it, and disabling the
  focused element drops focus to `<body>`.** So pressing "Update now" by keyboard left focus
  nowhere for the length of the request, and the outcome then landed on a control nobody was
  standing on. Entering `applying` now records whether that button held focus, and an effect
  takes it back **after the commit** (focusing in the same tick hits the still-disabled element
  and silently does nothing) and **only if focus is on `document.body`** — anything else claimed
  it, that's the user's business. Same class of bug as the *Not now* button, which removed itself
  on its own click and now hands focus to the primary slot before it goes.
  **I found this by measuring, not reading.** Static reasoning said the element persists, so
  focus persists — and it was wrong. The cheap harness: temporarily render the component with a
  seeded phase, `focus()` + `click()` the button from an effect, write `document.activeElement`
  into `document.title`, and read it back with `chrome --headless --dump-dom | grep '<title>'`.
  It reported `BODY` before the fix and `BUTTON:Try again` after. Worth reaching for whenever a
  claim is about focus, because nothing else in this repo can catch it.
- **`variant="warn"` is `bg-warn-soft`** — the same wash as the warn bar — so "Update anyway"
  disappeared into it. It's `danger`, which is also the honest label for ending three live agent
  sessions. Check a variant's own background before putting it on a tinted bar.
- **`ErrorAlert` is deliberately not used here**, though the link-inside-the-sentence rule is:
  it pins `text-danger` (documented: callers must not override it), which is wrong on a warn
  wash, and its `role="alert"` nested inside this bar's `aria-live` region is two announcements
  of one message.
- **`min-w-0 flex-1` on the message collapsed it to one word per line** beside the `shrink-0`
  buttons at 500px. `min-w-40` is the floor (`GettingStarted` hit this first), and the notice
  states also take `basis-full sm:basis-auto` so the actions wrap underneath — otherwise a
  headline, a reason and a log panel share a 160px column while the buttons keep the line.
  Nest the icon *with* the message, or `basis-full` leaves it stranded on a row of its own.
- **Copy lives in `lib/update-ui.ts` because it's testable**: 1-vs-N agreement ("1 task is" vs
  "3 tasks are"), the `{expr}`-eats-the-space trap, and `sentenceCase` — `die`'s messages are
  written to follow `error: ` so they start lowercase, and under a headline that reads as a typo.
  The one message it must not touch starts with a URL (`"$URL never answered…"`).
- `lib/update-ui.ts` imports the record's type with **`import type`** from `lib/update-run.ts`,
  which reaches for `node:fs`. Type-only imports are erased, so nothing Node-side follows it into
  the client bundle — but it is one keyword away from a broken build.
- **Verifying it needs a harness**: `packaged` is false in a checkout, so the banner renders
  nothing on `pnpm dev`. Seed the initial `status`/`phase` (see `.fe/test-scenarios/update-banner-states.md`).
- Two smaller review corrections worth keeping: a log/transcript panel is **`bg-sunken`** (what
  the surface table assigns it, and what `GitControls`, `DiffModal`, `TaskLiveView` and
  `Markdown`'s code blocks all use) — `bg-surface` was drift; and a path gets **`break-all`, not
  `truncate`**, because `truncate` ellipsises the *end*, hiding the filename and leaving only a
  `title` attribute that no keyboard and no screen reader reaches.
