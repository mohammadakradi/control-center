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
