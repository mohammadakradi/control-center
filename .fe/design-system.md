# Design System — Agent Platform

_Maintained by the fe-agent · source of truth for tokens & reusable components · updated 2026-07-29 (sidebar + light/dark)_

## Styling system
- Approach: **Tailwind CSS v4** — CSS-first config, no `tailwind.config.*` file
- Token source: `app/globals.css` — a **semantic CSS-variable layer** (`:root` = light,
  `.dark` = dark) surfaced as Tailwind utilities through `@theme inline`
- Theming: **light / dark / system**, default `system`. Blocking init scripts (`lib/theme.ts`,
  `lib/sidebar.ts`) set `class` + `data-*` on `<html>` before first paint
- Component library: **Bespoke only** — no shadcn, Radix, MUI, or Headless UI

## Colors — use semantic tokens, never raw palette shades
> **Rule: never write `neutral-800`, `sky-400`, `bg-white/5`, or a `dark:` variant in a
> component.** Every colour goes through a token below, so both themes stay in sync.

### Surfaces & borders
| Utility | Role | Light | Dark |
|---|---|---|---|
| `bg-canvas` | Page background | `#f7f7f8` | `#0a0a0b` |
| `bg-surface` | Card / sidebar | `#ffffff` | `#121214` |
| `bg-surface-2` | Inset rows, inputs, popovers | `#f4f4f5` | `#17171a` |
| `bg-surface-3` | Hover / active fill | `#e7e7ea` | `#232327` |
| `bg-sunken` | Transcript, code, modal body | `#fafafa` | `#08080a` |
| `bg-hover` | Faint row-hover wash | `rgb(0 0 0 /.04)` | `rgb(255 255 255 /.04)` |
| `bg-overlay` | Modal scrim | `rgb(24 24 27 /.4)` | `rgb(0 0 0 /.6)` |
| `border-line` | Default border | `#e4e4e7` | `#262629` |
| `border-line-strong` | Emphasised border, inputs | `#d1d1d6` | `#3a3a3f` |

### Text ramp (strong → faint)
| Utility | Use | Light | Dark |
|---|---|---|---|
| `text-fg-strong` | Headings, key values | `#09090b` | `#ffffff` |
| `text-fg` | Body | `#18181b` | `#e7e7ea` |
| `text-fg-muted` | Secondary body | `#3f3f46` | `#d4d4d4` |
| `text-fg-subtle` | Metadata | `#5f5f6a` | `#a3a3a3` |
| `text-fg-faint` | Small labels, **placeholders** | `#67676f` | `#8a8a92` |
| `text-fg-ghost` | **Decorative only** (icons, markers) — below AA | `#8e8e98` | `#6e6e76` |

Everything down to `fg-faint` clears **WCAG AA (4.5:1)** on `surface`, `surface-2`, and
`canvas`. `fg-ghost` does not — never use it for text a user must read.

### Accent & focus
| Utility | Role | Light | Dark |
|---|---|---|---|
| `text-accent` | Links, selected labels | `#0369a1` | `#38bdf8` |
| `text-accent-hover` | Link hover | `#075985` | `#7dd3fc` |
| `bg-accent` + `text-accent-contrast` | Selected pill | `#0369a1` / `#fff` | `#38bdf8` / `#04141f` |
| `ring-ring` | Focus ring | `#0ea5e9` | `#0ea5e9` |

A global `:focus-visible { outline: 2px solid var(--ring) }` in `globals.css` gives every
interactive element a keyboard affordance by default.

### Semantic tones
Each tone `t` ∈ `ok · danger · warn · info · violet · muted` exposes three utilities:
`bg-{t}-soft` (background), `text-{t}` (text/icon), `border-{t}-line` (border). A solid
`bg-{t}` fill is also generated from the same `--color-{t}` token — use it only for small
non-text fills (status dots in `TaskLiveView`, the utilization bars in `PlanLimits`), never
as a surface behind text, since the tone colours are tuned for text-on-soft contrast.

| Tone | Used for | Light text/bg | Dark text/bg |
|---|---|---|---|
| `ok` | done, additions, success | `#047857` on `#ecfdf5` | `#6ee7b7` on `emerald-500/15` |
| `danger` | failed, deletions, destructive | `#b91c1c` on `#fef2f2` | `#fca5a5` on `red-500/15` |
| `warn` | running, gates, ahead | `#b45309` on `#fffbeb` | `#fcd34d` on `amber-500/15` |
| `info` | queued, accent actions, behind | `#0369a1` on `#f0f9ff` | `#7dd3fc` on `sky-500/15` |
| `violet` | workspace badges, doc icons | `#6d28d9` on `#f5f3ff` | `#c4b5fd` on `violet-500/15` |
| `muted` | cancelled, neutral chips | `#3f3f46` on `#f4f4f5` | `#d4d4d4` on `neutral-500/15` |

All tone text/background pairs were contrast-checked: **AA or better in both themes.**
`statusColor()` in `lib/ui.ts` is the single choke point mapping task status → tone.

### Sidebar collapse variant
`@custom-variant rail` (keyed off `data-sidebar="collapsed"` on `<html>`) styles the
collapsed rail in pure CSS — `w-60 rail:w-16`, `rail:hidden`, `rail:justify-center`. This
keeps the width correct on first paint instead of flashing after hydration.

## Typography
- Font families: `--font-sans: var(--font-geist-sans)` · `--font-mono: var(--font-geist-mono)` (both loaded via `next/font/google` in `app/layout.tsx`)
- Type scale: Tailwind v4 defaults (`text-xs`→`text-2xl`+); no custom scale
- Common patterns: `text-sm text-fg-subtle` (metadata), `text-xs text-fg-faint` (labels), `text-2xl font-bold tracking-tight text-fg-strong` (stat values)
- Mono font used for: file paths, git hashes, code content, tag labels in `Fact`

## Spacing & layout
- Spacing scale: Tailwind v4 defaults (0–96 + fractional)
- App shell (`app/layout.tsx`): a flex row of `Sidebar` (sticky, `h-dvh`, `md+` only) and a
  content column holding `MobileTopBar` + `<main>`; `MobileTabBar` is fixed to the bottom below `md`
- Page container: `mx-auto w-full max-w-6xl px-4 pt-6 pb-24 sm:px-6 sm:py-8 md:pb-14` (`pb-24` clears the mobile bottom tab bar)
- Sidebar widths: `w-60` expanded, `w-16` collapsed (via the `rail:` variant)
- Card padding: `p-6` (via `card` const)
- Section gaps: `gap-4` to `gap-8`
- Breakpoints: Tailwind v4 defaults (`sm: 640px`, `md: 768px`, `lg: 1024px`, `xl: 1280px`, `2xl: 1536px`)
- Grid: `grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3` pattern for tiles. **Always include the `grid-cols-1` base** — a bare `grid` with only a `lg:`/`md:` column class has no column template below that breakpoint, so it falls back to a single implicit `auto` column sized to max-content and overflows the viewport horizontally. `grid-cols-N` resolves to `minmax(0,1fr)`, which clamps the track and lets children shrink/truncate.
- Page padding: `<main>` uses `px-4 pt-6 pb-24 sm:px-6 sm:py-8` — tighter gutters + bottom-nav clearance on mobile, full padding from `sm`
- Mobile patterns: long paths/commands use `break-all` (identifiers) or `break-words` (headings); dense metadata/list rows use `flex-wrap` + `min-w-0`/`truncate` so they stack rather than overflow at ~375px; primary nav is the sidebar from `md` up and a fixed bottom tab bar below `md` (see `Sidebar` / `MobileNav`)

## Radii, shadows, borders, motion
- Radius: `rounded-2xl` (cards), `rounded-xl` (tiles), `rounded-full` (chips/badges/avatars), `rounded-md` (fact tags), `rounded-lg` (misc)
- Shadows: `shadow-2xl` on modals (via the shared `Modal`); `shadow-sm` on primary/success buttons; no custom shadow tokens
- Borders: `border border-line` (cards/tiles); `border border-line-strong` (inputs, secondary buttons); tone borders use `border-{tone}-line`
- Cards are a flat `bg-surface` — the old `from-white/[0.015]` sheen was removed (it inverted badly in light mode)
- Motion: `animate-spin` (Loader2 spinner for active states) and `transition-colors`; no custom easing. **`prefers-reduced-motion: reduce` is honoured globally** in `globals.css` (animations/transitions collapse to ~0s)

## Icons & assets
- Icon set: **lucide-react `^1.21.0`** — import as named exports: `import { IconName } from "lucide-react"`
- Default icon size: `size-4` (16px) inline; `size-5` (20px) for nav/prominent
- Fonts: Geist Sans + Geist Mono — loaded in `app/layout.tsx` via `next/font/google`, injected as CSS vars
- Agent avatars: `public/fe-agent.png` (fe namespace); falls back to initials initial via `AgentAvatar`

## Reusable components (reuse catalog)
> Before building anything new, check here first and reuse/extend.

| Component | Location | Variants / key props | Notes |
|-----------|----------|----------------------|-------|
| `card` (string const) | `components/ui-cards.tsx` | — | Apply with `className={card}` for the standard card surface (`rounded-2xl border-line bg-surface p-6`) |
| `Button` / `buttonClasses()` | `components/ui/button.tsx` | `variant: primary\|success\|secondary\|ghost\|danger\|accent`, `size: sm\|md\|icon`, `loading?`, `icon?` | **The** button. Replaced 11 drifted treatments. `loading` renders the spinner, disables, and sets `aria-busy`. Built-in focus ring + `disabled:opacity-50`. Use `buttonClasses()` for `<Link>`s. Gradients are dark-stopped so white text clears AA — don't lighten them. |
| `Modal` | `components/ui/modal.tsx` | `label`, `header?`, `actions?`, `onClose`, `className?` | Dialog shell: `role="dialog"` + `aria-modal` + accessible name, Escape-to-close, focus trap, focus restore, body-scroll lock. `DiffModal`/`FileModal` build on it — never hand-roll an overlay. |
| `PageHeader` | `components/ui-cards.tsx` | `title`, `description?`, `actions?` | Standard page title block. Carries **no** outer margin — place it inside the page's own `space-y-6`. |
| `EmptyState` | `components/ui-cards.tsx` | `icon?`, `title`, `hint?`, `action?` | Dashed-border placeholder for empty lists/sections. |
| `Select` | `components/ui/select.tsx` | `value`, `onChange`, `options: {value,label,description?,icon?}[]`, `searchable?`, `mono?`, `placeholder?`, `disabled?`, `className?`, `ariaLabel?` | **Searchable** bespoke combobox (popover + filter + keyboard nav). Use instead of native `<select>` or per-file wrappers. Search auto-enables past 7 options (force with `searchable`). `className` is for width/layout (e.g. `w-full`, `min-w-48`). Full combobox/listbox ARIA + keyboard. |
| `CardSection` | `components/ui-cards.tsx` | `title`, `right?`, `className?` | `card` + header row (title + optional right slot); has built-in `min-w-0` so it shrinks inside grid/flex parents. Use instead of hand-rolling `<section className={card}><h2>…</h2>` |
| `AtAGlance` | `components/AtAGlance.tsx` | `total`, `successRate`, `inProgress`, `changedFiles`, `isWorkspace`, `memberCount`, `branchInfo`, `aheadBehind` | Project summary card (stats + git/workspace facts) |
| `SourceControl` | `components/SourceControl.tsx` | `projectId`, `isWorkspace`, `members`, `branchInfo`, `changes` | Project source-control card; delegates to `WorkspaceSourceControl` or `GitControls`+`ChangesList` |
| `TaskHistory` | `components/TaskHistory.tsx` | `history`, `namespaceById`, `className?` | Reverse-chron task list; rows wrap, request text truncates |
| `Chip` | `components/ui-cards.tsx` | `tone: neutral\|ok\|violet\|sky`, `icon?` | Pill badge for metadata/tags; tones map to the semantic tone tokens |
| `Tile` | `components/ui-cards.tsx` | `value`, `label`, `tone?: ok` | Stat tile (number + label) |
| `Fact` | `components/ui-cards.tsx` | `icon`, `tag?`, `tagTone?: neutral\|ok\|warn` | Row in a facts list (bordered top) |
| `StatusBadge` | `components/StatusBadge.tsx` | `status: TaskStatus` | Icon + label badge; spinner on active |
| `Sidebar` | `components/Sidebar.tsx` | — | Desktop primary nav (`md+`): sticky full-height column, brand, links with an accent active indicator, footer with the theme control + collapse toggle. Collapses to a 64px icon rail via the `rail:` CSS variant (persisted in `localStorage`). Never duplicate. |
| `MobileTopBar` / `MobileTabBar` | `components/MobileNav.tsx` | — | Below `md`: a slim sticky top bar (brand + theme icon) and a fixed bottom tab bar. Layout `<main>` carries `pb-24` to clear the tab bar. Tabs are `flex-1 min-w-0` with a `truncate` label — at 5 tabs / 320px each track is ~64px, about the width of "Dashboard", so a 6th tab or a longer label will start ellipsizing. |
| `ThemeToggle` / `ThemeToggleIcon` | `components/ThemeToggle.tsx` | — | Light/dark/system control. `ThemeToggle` is a 3-way `radiogroup` (expanded sidebar); `ThemeToggleIcon` is a single cycling button (rail + mobile). Reads state via `useSyncExternalStore` off `<html>`. |
| `nav-links` | `components/nav-links.tsx` | `NAV_LINKS`, `isActive()` | Single source of truth for the primary nav items (Dashboard · Agents · Projects · Usage · Settings), shared by sidebar and mobile nav. Add a route here and both navs pick it up; check the mobile tab-bar note below before adding a sixth. |
| `Avatar` | `components/AgentAvatar.tsx` | `namespace: string`, `size?: number` (default 48) | Per-agent photo/initials avatar; fallback to monogram disc on 404 |
| `AgentContributors` | `components/AgentContributors.tsx` | `namespaces: string[]`, `size?: number` (default 28), `ringClass?: string` (default `ring-surface-2`) | Overlapping avatar ring with a group `aria-label`; shows "no runs yet" when empty |
| `AddProjectForm` | `components/AddProjectForm.tsx` | — | Client form; project registration with macOS Finder picker |
| `NewTaskForm` | `components/NewTaskForm.tsx` | `projectId: string`, `agents: AgentLite[]`, `onboardedByAgent?: Record<string, boolean>` | Dispatch task; agent + command selector; amber warning when agent not onboarded |
| `ProjectActions` | `components/ProjectActions.tsx` | `projectId: string` | Rescan + remove. Remove uses an **inline two-step confirm** (not native `confirm()`) and surfaces fetch errors. |
| `GitControls` | `components/GitControls.tsx` | `projectId: string`, `info: BranchInfo`, `member?: string` | Branch switcher + pull/push with ahead/behind badges |
| `ChangesList` | `components/ChangesList.tsx` | `projectId: string`, `member?: string`, `changes: GitChanges` | Uncommitted file list with diff trigger |
| `DiffModal` | `components/DiffModal.tsx` | `projectId: string`, `path: string`, `member?: string`, `onClose: () => void` | Unified diff viewer; built on the shared `Modal` |
| `FileModal` | `components/FileModal.tsx` | `projectId: string`, `path: string`, `member?: string`, `onClose: () => void` | In-repo file viewer (md/plain); built on the shared `Modal` |
| `WorkspaceSourceControl` | `components/WorkspaceSourceControl.tsx` | `projectId: string`, `members: ResolvedMember[]` | Git + changes per workspace repo. Proper ARIA **tablist** with roving ←/→/Home/End focus; the changes list is height-capped to match the single-repo path |
| `TaskLiveView` | `components/TaskLiveView.tsx` | `taskId: string`, `runnerUrl: string`, `initialStatus: string`, `projectId: string`, `agentId: string` | SSE-based live task transcript |
| `ExpandableRequest` | `components/ExpandableRequest.tsx` | `text: string` | Collapsible markdown task request (160-char preview); disclosure button wired with `aria-expanded`/`aria-controls` |
| `RunDuration` | `components/RunDuration.tsx` | `createdAt: number`, `endedAt: number \| null`, `active: boolean` | Live-ticking elapsed time chip; ticks every second while active |
| `UsageBreakdown` / `UsageCost` | `components/UsageDisplay.tsx` | `usage: TaskUsage`, `className?` | Token/cost display at two densities: a labelled `<dl>` (task detail, user totals) and a bare mono cost for dense list rows. Each renders `null` rather than a misleading zero — `UsageBreakdown` when nothing at all was recorded (`hasUsage()`), `UsageCost` when there's no cost to show (a run can bank tokens without a billable turn). Feed them via `taskUsage(row)` from `lib/usage-format.ts`. |
| `UsageSummaryCard` | `components/UsageSummaryCard.tsx` | `spend: SpendSummary` | The signed-in user's spend, titled **"Your spend"** (not "Usage" — it sits under the `/usage` page's own `<h1>Usage</h1>`): four `Tile`s, a token `UsageBreakdown`, top-5 costliest runs (each labelled with its project), and the `unattributed` footnote. Every figure is scoped to `spend.range`, so the tile label and empty-state copy change with the window. Server component (`spendForUser()` is a direct query). |
| `SpendRangeNav` | `components/SpendRangeNav.tsx` | `value: SpendRange` | Time-window filter for `/usage` (7 days · 30 days · All time). **Links, not buttons** — the range is URL state (`?range=`), so it needs no client JS and stays bookmarkable; the default range carries no param. Visually identical to `ThemeToggle`'s segmented control, but `<nav>` + `aria-current="page"` rather than `role="radiogroup"`, because it navigates. Labels come from `SPEND_RANGES` in `lib/usage-format.ts`. |
| `ProjectSpendCard` | `components/ProjectSpendCard.tsx` | `spend: SpendSummary` | Per-project spend for the selected range: cost, a decorative share bar, tokens and run count. Caps at 8 rows and **discloses** the remainder ("A further $X across N smaller projects") rather than truncating silently. Server component; reads the same `SpendSummary` as `UsageSummaryCard` so the two can't disagree. |
| `PlanLimits` | `components/PlanLimits.tsx` | — | Claude plan rate-limit windows as utilization bars. Client component; fetches `/api/usage` and **renders nothing at all** (no card, no skeleton, no error) unless the SDK reports limits as available — which on this app it normally doesn't. |
| `AttachmentPicker` | `components/AttachmentPicker.tsx` | `files: File[]`, `onAdd: (files: File[]) => void`, `onRemove: (idx: number) => void` | File attach bar (Paperclip + chips); shared by `NewTaskForm` and `TaskLiveView` change-request box |
| `Markdown` | `components/Markdown.tsx` | `children: string`, `onFileClick?: (path: string) => void` | `react-markdown` with GFM + remark-breaks; normalizes agent bullet glyphs; clickable `.fe/.swe` test-scenario / `.pm/tasks` file paths |

## Accessibility baseline
- Target: **WCAG AA**. Every text/background token pair in both themes was contrast-checked
  (the only sub-AA token is `fg-ghost`, which is decorative-only by contract).
- Lint: ESLint `eslint-config-next/core-web-vitals` — no explicit `jsx-a11y` plugin override
- **Focus:** a global `:focus-visible` outline in `globals.css` covers every interactive
  element; `Button` and the nav items add their own treatments on top.
- **Motion:** `prefers-reduced-motion: reduce` collapses animations/transitions globally.
- **Dialogs:** `Modal` supplies `role="dialog"`, `aria-modal`, an accessible name, a focus
  trap, focus restore, and scroll lock.
- **Conventions:** icon-only buttons carry `aria-label`; decorative icons carry
  `aria-hidden`; async errors render in `role="alert"`; git command output is a live region.

## Known inconsistencies / debt
- **There is now a test suite** (`pnpm test` → `node:test` via `tsx`, specs in `runner/*.test.ts`
  and `lib/*.test.ts`) — pure UI logic can and should be tested there, e.g.
  `lib/usage-format.test.ts`. Nothing renders components yet (no DOM test tooling), so
  markup and interaction are still verified by hand. The theme/sidebar logic in `lib/theme.ts`
  and `lib/sidebar.ts` remains untested — deferred by the user when it landed (2026-07-29).
- `AgentAvatar`'s initials fallback uses one colour for every namespace, so agents without a
  photo are visually indistinguishable in a contributor stack.
- Keyboard navigation is reasoned about but not formally tested end-to-end (no a11y test
  tooling in the project).
