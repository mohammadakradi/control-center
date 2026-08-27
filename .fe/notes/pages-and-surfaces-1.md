# pages and surfaces

Per-surface notes: what each page is for and the decisions behind it.

Part 1 of 3.

<!-- Split out of a single 79 KB `.fe/notes.md` on 2026-08-24, which was read in full at the start of every request (frontend rule 10). Entries are verbatim; only this header is new. -->

## `loading.tsx` is the prefetch switch, not a spinner (2026-08-20)
Route skeletons for every `app/(app)/**` route, on `Skeleton`/`SkeletonPage` (`ui-cards.tsx`) and
the composite shapes in `components/Skeletons.tsx`. The design-system doc covers the components;
what belongs here is the Next-16.2.9 behaviour, because all of it was measured and none of it is
guessable from the component code.

- **A `force-dynamic` route is not prefetched at all without a loading boundary.** The docs'
  own table (`02-guides/prefetching.md`) reads "Dynamic page → **Prefetched: No, unless
  `loading.js`**", and that is literal. Measured with `curl -H 'RSC: 1' -H 'Next-Router-Prefetch: 1'`
  against `/projects/[id]`: **254 bytes, 5.7 ms**, and the body is the route *tree* only
  (`{"f":[[["",{"children":["(app)",…]}]],"q":"","i":…}`) — no UI. Every page here is
  `force-dynamic`, so before this change `<Link>` prefetch was firing on every link in the app
  and buying **nothing**. With a `loading.tsx` the same request returns **20 KB carrying a
  rendered skeleton**. So these files are a performance feature that happens to look like a
  spinner, and deleting one silently un-prefetches that route.
  - **Which skeleton the prefetch carries is not the one you'd guess, and it doesn't matter.**
    A prefetch stops at the *first* loading boundary from the root, and `app/(app)/loading.tsx`
    sits above every other segment — so the cached payload for **every** route holds the
    dashboard skeleton (grep a prefetch of `/projects/[id]`: one hit for `Loading dashboard…`,
    zero for `Loading project…`). It would be reasonable to conclude from that alone that the
    nine tailored skeletons are dead weight, or that clicking flashes a dashboard shape first.
    **Both are wrong**, and only measuring the visible sequence settles it: on a click the
    route-specific skeleton is the *only* one that ever renders, at **13 ms**. A `loading.tsx`
    is client-side JS, so React renders the correct Suspense fallback locally the instant
    navigation starts — it never waits for a server payload to learn its shape. The prefetch's
    job is warming the route tree and the segment code, not supplying the skeleton.
    Found by the frontend audit, which was right about the payload; the flash it implied does
    not exist. Don't restructure the group to "fix" this — a `(dashboard)` route group would
    add a directory level for no measurable gain.
- **Therefore: measure in a production build, never `pnpm dev`.** "Automatic prefetching runs
  only in production" (same doc). A dev-server measurement of this work would have shown a
  no-op. Recipe: `pnpm build`, then the `next start` recipe further down this file, then drive it
  with the CDP driver.
- **What it bought, click → first visual change** (CDP `MutationObserver` on `<main>`, seeded DB
  of 4 projects / 96 tasks):

  | navigation | before | after (queue drained) |
  |---|---|---|
  | Projects → project | **2696 ms** | **17 ms** |
  | nav → /backlog | 720 ms | 6 ms |
  | nav → /tasks | 238 ms | 20 ms |
  | nav → /usage | 55 ms | 4 ms |

  The 2.7 s was real and worth understanding: `/projects/[id]` re-scans the project, reads git
  branch info and walks the working tree, and with no boundary above it **the previous page stays
  on screen for the whole render**. Nothing was slow to *appear* — there was nothing to appear.
- **The prefetch-storm worry was unfounded, and it was worth checking rather than assuming.**
  `/tasks` renders 45 in-viewport links; once boundaries make them prefetchable that's 61 RSC
  prefetch requests per page load. Measured total transfer: **6.2 KB** (compressed, deduped). So
  default prefetch stays on everywhere and **no `prefetch={false}` was added**. Re-measure before
  adding one; the cheap instinct here is wrong in both directions.
- **A prefetch does not execute the page, and that is proved by side effect rather than by
  timing** — which matters, because it's the claim the whole prefetch decision rests on. Timing
  is only suggestive; this app conveniently has pages that *write* when they render.
  `/projects/[id]` runs `refreshProject` (updates the project row) and `/backlog` runs the
  `.pm/tasks/` scan (inserts `backlog_items`). So: poison the row
  (`default_branch='SENTINEL', is_git=0`), clear `backlog_items`, fire **25** prefetch-shaped
  requests at both routes (`-H 'RSC: 1' -H 'Next-Router-Prefetch: 1'`), and re-read. Result:
  sentinel **intact**, `backlog_items=0`. Then the positive control — **one** request with `RSC: 1`
  and *no* prefetch header — rewrote `default_branch` and inserted 30 backlog rows. The detector
  demonstrably works, and 50 prefetches tripped none of it. Reuse this shape for any future
  "does X actually run the page" question; it beats reasoning about response sizes.
- **The shared layout is why this works at all.** `(app)/layout.tsx` awaits `getSignedInUser()`,
  i.e. reads cookies, and `loading.md` warns that a layout touching runtime data blocks
  navigation. It doesn't here, because layouts **do not rerender** on client navigation
  (`layout.md` → Caveats): the sidebar, mobile bars, toasts and `ActivityBadge` all stay live and
  interactive under the skeleton. Confirmed in the screenshots — the nav entry stays lit and the
  activity pill keeps polling while the skeleton is up. Don't move page data into that layout.
- **`app/(app)/loading.tsx` is the dashboard's boundary *and* the group's fallback.** There is no
  way to scope a `loading.tsx` to only its own segment's `page.tsx`, and a `<Suspense>` inside the
  page can't help (the page function itself is what suspends, so the boundary must sit above it).
  Every route today has its own, so this only renders for `/`; a route added later inherits a
  dashboard-shaped skeleton, which is strictly better than the old behaviour.
- **Holding a skeleton still long enough to look at it** needs no source change: drain the
  prefetch queue, then `Network.emulateNetworkConditions` with `latency: 3000` and click. The
  skeleton comes from the prefetch cache instantly while the real render is stalled behind the
  latency. That's how the light/dark and 390px passes were done.
- **`unstable_instant` is not available to us.** It's the export the docs' AI-agent hint pushes
  for instant navigation, and it "only works when `cacheComponents` is enabled"
  (`route-segment-config/instant.md`). Turning that on means every uncached read in the app must
  sit behind `<Suspense>` or `use cache` or the build fails — an architecture change, not a flag.
  Filed rather than smuggled in.
- **View transitions work here but were deliberately not shipped.** Verified, not assumed:
  `experimental.viewTransition: true` validates and `pnpm build` passes with it (prints
  `✓ viewTransition`), and `import { ViewTransition } from "react"` typechecks as this project is
  configured — even though `@types/react`'s `index.d.ts` doesn't declare it (it's in
  `canary.d.ts`) and the installed `react@19.2.4` doesn't export it. The runtime component comes
  from Next's vendored React (`next/dist/compiled/react` exports it). Three reasons it stayed out:
  the measured problem is already solved without it; the flag changes React's integration for
  **every** navigation in an app whose main view is a live SSE transcript, an interaction not
  worth validating for polish; and it needs its own reduced-motion CSS, because the global reset
  in `globals.css` matches `*, *::before, *::after` and so does **not** reach
  `::view-transition-old(*)`/`-new(*)`/`-group(*)`. Clean follow-up — nothing here blocks it.

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

## Usage display: zeros are not "free", and plan limits normally don't render
- A task row's `usage*` columns read 0 both for tasks that predate usage tracking and for runs whose subprocess was killed before reporting. `hasUsage()` in `lib/usage-format.ts` is the single gate: **render nothing rather than `$0.00`.** Sub-cent spend shows as `<$0.01` for the same reason.
- `formatCost` pins `toLocaleString("en-US", …)`. These values render in server *and* client components, so an unpinned locale is a hydration mismatch waiting to happen.
- `PlanLimits` renders **nothing** unless `/api/usage` reports `rateLimits.available` — which on this app is essentially never (env-injected tokens have no profile scope; see `.swe/notes.md`). That's the designed state, not a bug: no error, no skeleton, no empty card. To see it, stub the state locally. Consequence for `/usage`: with no spend recorded the page is just the header + an empty state, because the *only* other card is one that normally doesn't render.
- Most of this instance's history is unowned (`user_id IS NULL`), so per-user spend reads ~$0 next to hundreds of dollars of real history. The `unattributed` footnote on the usage card exists so the page doesn't look broken. That bucket is **all-time by design** and doesn't follow the range filter, so the footnote says ", all time," out loud whenever a window is selected — otherwise it reads as "a further $459 in the last 7 days".
- With a range filter in play, "no spend" has two different meanings and they need different copy: *nothing ever* ("No usage recorded yet") vs *nothing in this window* ("No spend in the last 7 days… try a wider range"). `isFiltered()` + `NO_SPEND_IN_RANGE_HINT` in `lib/usage-format.ts` keep the two usage cards saying the same thing.

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

## Grouping work by feature — three surfaces, one heading (2026-08-22)
`/backlog`, project detail's task history and `/tasks` all group by feature now. The components
are in `.fe/design-system.md`; what belongs here is the measured behaviour and the two
verification traps, neither of which is guessable from the code.

- **The grouping decision is `groupByFeature` in `lib/ui.ts`, and its `null` return is the whole
  contract.** No row has a feature → answer null → the caller renders the list it always
  rendered. Without that, every task list and backlog section in the app would grow a single
  "No feature" heading: a level of hierarchy conveying nothing, on every install that hasn't used
  features. Verified both ways on a seeded DB — a project whose tasks all have `feature_id` NULL
  renders **zero `<h3>`s and zero merge chips**, and the dashboard's "Recent activity" (plain
  `TaskList`) is untouched. The ungrouped bucket sorts **last** and only exists when something
  is in it; a row whose `featureId` doesn't resolve lands there rather than disappearing, since
  `tasks.feature_id` is `ON DELETE SET NULL` and a row can briefly outlive its feature.
- **`featureMergeSummary` never counts `pending`, and that is a product decision, not an
  omission.** A non-isolated (checkout) feature run stays `pending` **forever** by design — the
  platform only system-merges isolated runs — so aggregating it would put a permanent
  "N pending" on the heading of every feature whose work ran in the checkout, reading as a queue
  that will never drain. The per-row chip still says "Not merged", so nothing is hidden; what's
  dropped is only the aggregate, which is where the false impression came from. A spec pins it.
- **A long branch name was a real horizontal-overflow bug, found by measuring rather than
  looking.** The branch chip started as `shrink-0` around a mono string, which is rigid — and a
  branch is `feature/` plus up to `MAX_SLUG_LENGTH` (60) characters. On a real project's derived
  features that forced **95px of page overflow at 390px and 164px at 320px**: a horizontal
  scrollbar on the whole page. Now `min-w-0` + `break-all`, so it **wraps and stays complete**.
  Not `truncate` + `title`: this is the string you came to copy, and a tooltip is unreachable by
  keyboard. Worth noting the near-miss — `/tasks` looked fine the whole time, because the
  branches *I* seeded were short while the ones the backlog derived from the repo's real
  `.pm/tasks/` folders sat near the slug cap. **Seed the worst case, not a plausible one.**
- **The per-row merge chip is `sr-only sm:not-sr-only`, and it was measured, not assumed.**
  `position: absolute`, 1×1px at 390px — so it takes no flex space and a mobile row is
  byte-identical to before the chip existed, while "Merge conflict" stays in the row's
  accessible name at every width (`MobileTabBar`'s trick). The tight title truncation visible on
  a row with a wide status badge at 390px is pre-existing `TaskList` behaviour, not this.

### `chrome --headless --window-size=W,H --screenshot` does not lay the page out at W
This cost a full round of wrong conclusions, so it is the load-bearing note here. That flag sets
the *window*, then Chrome renders at some wider viewport and **crops to W** — so a "390px"
screenshot shows desktop-width line breaks with the right-hand side cut off, which looks exactly
like a responsive regression you just introduced. I "found" clipping on the grouped pages this
way and then reproduced the identical clipping on the **dashboard**, which this task never
touched — that control is what exposed the tool, and it is the check to run first next time.

The only truthful way is real device emulation over CDP: launch with
`--remote-debugging-port=9222`, `PUT /json/new`, then `Emulation.setDeviceMetricsOverride`
(`width`, `height`, `deviceScaleFactor: 2`, `mobile: width < 768`) before `Page.navigate`. Node
22+ has a global `WebSocket`, so the whole driver is ~40 lines with no dependencies. Two things
worth building into it:
- **Measure, don't eyeball**: `documentElement.scrollWidth - clientWidth`, and when that's
  positive, walk `body *` for elements whose `getBoundingClientRect().right` exceeds
  `clientWidth`. That names the offending element and its classes, which is what turned "the
  page looks cut off" into "the branch chip is `shrink-0`" — and, on project detail, into proof
  that the offenders were `ProjectActions`' buttons in files this task never opened (filed as a
  backlog item rather than fixed here).
- **`captureBeyondViewport: false`** unless you want it. These pages run to ~26 000px tall; a
  full-page capture scaled to fit is unreadable.

Pin the theme with a script that runs **last** (`document.documentElement.className = "dark"`),
not by editing the `<html>` tag: the app's own blocking init script sets that class from
`localStorage`/`matchMedia` and will overwrite markup. Assets: mirror the SSR'd HTML plus the one
`/_next/static/chunks/*.css` file, drop `<script src>` tags but **keep the inline ones** — Next
streams the shell first and its inline scripts are what swap the real content over the loading
skeleton. Strip those and you screenshot the skeleton and think the page is broken.

### Killing the throwaway `next start` will kill your dev server if you match loosely
The existing note says match `*next-server*`; the trap is that the container's **dev** server is
also `next-server (v16.2.9)`, so any `| tail -N` over that match is a coin flip. I killed the dev
server twice this way. Kill by **explicit PID**, read off `/proc/*/cmdline` for the wrapper chain
that still carries the port (`sh -c … -p 3099`, `npm exec …`), and if you do lose it,
`docker restart platform` re-runs the entrypoint and brings web + runner back cleanly — note
`concurrently` survives with a dead child, so the port stays down until the container restarts.

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
