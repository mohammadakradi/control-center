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
`canvas`. `fg-ghost` does not — never use it for text a user must read. `fg-ghost` is for
icons and markers.

This is the single most-repeated regression in the project, now caught **three** times — task
rows (the `v0.4.0` version label and the "no description" fallback), and then a 2026-08-13
audit that found ten more: the task-detail project path, a workspace member path, the
attachment hint + file sizes, `AgentContributors`' "no runs yet", `NewTaskForm`'s agent
version, `TaskLiveView`'s continue-session helper, the sidebar's "Navigate" eyebrow and
`v{version}` footer, and `DiffModal`'s diff-header lines. All now `fg-faint`.

**The rule of thumb that would have prevented every one of them:** if it is rendered as a
character a sighted user could want to read — a path, a size, a version, a label, a fallback
sentence — it is text, however deliberately de-emphasised, and `fg-ghost` is wrong. `fg-ghost`
is legitimate only where the element carries no information on its own: an `aria-hidden` icon,
a list marker, a status dot (`bg-fg-ghost`). A grep for `text-fg-ghost` should return icons
and nothing else.

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
`statusTone()` in `lib/ui.ts` is the single choke point mapping task status → tone; both
treatments are lookups on it — `statusColor()` (soft background, for a badge sitting *on* a
card) and `statusBorderColor()` (border only, for anything **floating**, which needs an opaque
surface because the soft tones are translucent in dark mode). The border *width* ships inside
each `statusBorderColor` value: two same-specificity border-colour utilities on one element
race in the emitted CSS, which is the trap `GettingStarted` documents.

**`text-{t}/80` is the established "secondary line inside a toned block"** — a tone-tinted
equivalent of dropping from `fg` to `fg-subtle`. Used by `TokenNudge` and `GettingStarted`'s
blocking step for the explanatory sentence under a warn-toned heading. Only ever on top of the
matching `bg-{t}-soft`, and only for a supporting line; a *primary* string in a toned block
stays at full `text-{t}`.

### Syntax highlighting (`--syn-*`)
The one place in the app where colour is applied by **class name** rather than a Tailwind
utility. `lib/highlight.ts` returns highlight.js' own scope names (`hljs-keyword`,
`hljs-string`, …) and a block at the bottom of `globals.css` maps them onto seven roles. That
mapping is also *why* highlight.js was chosen over Shiki — Shiki emits inline `style`
attributes from a bundled editor theme and can't follow these variables.

| Variable | Scopes | Value |
|---|---|---|
| `--syn-keyword` | `keyword`, `selector-tag`, `doctag` | `var(--violet)` |
| `--syn-string` | `string`, `regexp`, `char`, `symbol`, `addition` | `var(--ok)` |
| `--syn-number` | `number`, `literal`, `bullet` | `var(--warn)` |
| `--syn-function` | `title`, `section`, `name`, `selector-id`, `selector-class` | `var(--info)` |
| `--syn-type` | `type`, `built_in`, `class`, `tag`, `attr`, `property`, `variable`, `params`, … | `#0f766e` / `#5eead4` |
| `--syn-comment` | `comment`, `quote` (also *italic*) | `var(--fg-faint)` |
| `--syn-punct` | `meta`, `operator`, `punctuation`, `formula`, `link`, `code` | `var(--fg-subtle)` |

Six of the seven **reference** an existing tone or text token rather than restating its hex, so
highlighted code reads as part of this app *and* can't silently drift from it — the first
version of this copied the values, which is the project's own "hardcoded value a token already
expresses" anti-pattern one level down, inside the token layer (caught in design review). Only
`--syn-type` is a hue this palette didn't already have, so it stays a literal in both blocks.
`hljs-deletion` uses `--danger` directly, because in a `.diff` file it means exactly what the
diff viewer's red rows mean.

**Every value was contrast-checked against four backgrounds in both themes** — `sunken`,
`surface-2`, and the two diff row washes `ok-soft` / `danger-soft` (which are *translucent* in
dark mode, so they composite over `sunken`). Lowest ratio is 4.57:1; all clear AA. Re-run that
check if you change one — a syntax colour sits on a tinted row, not just on the card.

An unlisted scope inherits the surrounding `text-fg`, which is a legitimate answer rather than
a gap. The variables are deliberately **not** in `@theme inline`: nothing applies them as a
Tailwind utility, so exposing them would generate utilities nothing uses.

### Sidebar collapse variant
`@custom-variant rail` (keyed off `data-sidebar="collapsed"` on `<html>`) styles the
collapsed rail in pure CSS — `w-60 rail:w-16`, `rail:hidden`, `rail:justify-center`. This
keeps the width correct on first paint instead of flashing after hydration.

## Typography
- Font families: `--font-sans: var(--font-geist-sans)` · `--font-mono: var(--font-geist-mono)` (both loaded via `next/font/google` in `app/layout.tsx`)
- Type scale: Tailwind v4 defaults (`text-xs`→`text-2xl`+); no custom scale
- Common patterns: `text-sm text-fg-subtle` (metadata), `text-xs text-fg-faint` (labels), `text-2xl font-bold tracking-tight text-fg-strong` (stat values)
- **Headings always carry `text-fg-strong`.** `PageHeader` and `CardSection` do it for you;
  a hand-rolled `<h1>`/`<h2>` must say it, or it inherits body `fg` and sits a step light of
  every other heading. Sizes: `text-2xl font-bold tracking-tight` for a page `<h1>`,
  `text-base font-semibold` for a card `<h2>` — the same values the two primitives use, so a
  bespoke heading beside a `CardSection` doesn't read as a different level.
- **Micro scale — `text-[11px]` and `text-[10px]`.** Two arbitrary values below `text-xs`
  (12px), used deliberately and sparingly: the sidebar's "Navigate" eyebrow and `v{version}`
  footer, `Fact`'s mono tag, `WorkspaceSourceControl`, `FolderPicker`. Kept as arbitrary
  values rather than promoted to tokens *or* folded into `text-xs`: folding would visibly
  loosen the collapsed rail and the fact tags, and a small scale used in a handful of places
  doesn't earn `@theme` entries. Don't reach for them for anything a user reads at length —
  they exist for eyebrows, tags and version stamps.
  **Call sites** (keep this list current — it is what tells the next audit these are deliberate
  rather than drift): the sidebar's "Navigate" eyebrow and `v{version}` footer, `Fact`'s mono
  tag, `WorkspaceSourceControl`, `FolderPicker`, and — added 2026-08-20 with the diff viewer —
  `CodeView`'s `GUTTER` line-number column plus `DiffView`'s diff-header block and `@@` hunk
  bar. The three viewer cases are load-bearing: the gutter has to fit five digits inside a
  fixed 44px column, and the two metadata rows must sit *below* the code they introduce.
  `CommandPalette` adds three more (2026-08-20): its **section headings**, which reuse the
  sidebar eyebrow's exact treatment so the two read as the same level of label; its **footer
  hint row** (`↑↓ navigate · ↵ open · esc close`), which is chrome explaining the widget rather
  than content; and the `text-[10px]` **`<kbd>` keycaps** inside both of those and in the
  sidebar trigger — a keycap has to read as smaller than the word beside it or it stops looking
  like a key.
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
- **Two custom keyframes**, both `@theme inline` + a top-level `@keyframes` in `globals.css`.
  Reach for a keyframe only where the motion carries meaning like these two do.
  - **`--animate-toast-in`** — a 160ms fade-and-rise for a toast arriving, so a card appearing
    in the corner registers as *new* rather than as something that was always there. The global
    reduced-motion block collapses it, which is the right degradation: the card still appears,
    just instantly.
  - **`--animate-skeleton`** — a 1.6s opacity breath for loading placeholders (`Skeleton`).
    **Opacity only, deliberately:** a gradient sweep would need its own
    `background-size`/`background-position` animation on *every* bar, and a page skeleton has
    47–59 of them (measured), while opacity stays on the compositor. The dip bottoms out at `.45` rather
    than fading toward nothing, so the layout being stood in for never looks like it flickered
    away.
  - **The reduced-motion degradation is a property of how the keyframe is written**, so copy
    the shape if you add another. `skeleton-pulse` declares *only* its `50%` stop, so when the
    global block forces `animation-duration: 0.01ms` + `iteration-count: 1` the bar settles
    back at its own `opacity: 1` — a static, fully visible placeholder rather than a
    half-faded one. Measured under emulated `prefers-reduced-motion: reduce`:
    `duration=1e-05s iterations=1 opacity=1`. A keyframe with `from`/`to` stops would instead
    freeze wherever those left it.

## Skeletons & route loading states
Every `app/(app)/**` route has a `loading.tsx`. In this Next build that is **not** cosmetic —
a `force-dynamic` route is not prefetched *at all* without a loading boundary, so these files
are what make `<Link>` prefetch do anything. See `.fe/notes.md` for the measurements.
- **`Skeleton`** (`ui-cards.tsx`) is the one bar primitive: size it with `className`, never
  restyle it. `bg-surface-3` because skeletons sit inside `bg-surface` cards and `surface-2` is
  nearly invisible against white in light mode.
- **`SkeletonPage`** (`ui-cards.tsx`) is the wrapper every `loading.tsx` uses, so a loading
  state's accessibility is decided once: `role="status"` + one `sr-only` sentence ("Loading
  projects…"), with the bars `aria-hidden`. **No `aria-busy`** — on a live region that tells AT
  to withhold the contents, suppressing the very sentence it exists to announce.
- **`components/Skeletons.tsx`** holds the composite page shapes (`SkeletonHeader`,
  `SkeletonCardSection`, `SkeletonRows`, `SkeletonTiles`, `SkeletonFacts`, `SkeletonTileRows`,
  `SkeletonDetailHeader`). Every className in it is **copied from the real component it stands
  in for**, because a skeleton whose padding or grid disagrees with the content replacing it
  turns the swap into a visible jump — which reads as the page breaking, not as the page
  arriving. Change one of those shells and change it here too.
- **Bar widths cycle a fixed list, never `Math.random()`** — a random width differs between the
  server and client render, which is a hydration mismatch.
- **Don't stand in for something that usually renders nothing.** `TokenNudge` and `PlanLimits`
  are deliberately absent from their skeletons: promising a block that never arrives is the
  same jump in the other direction.

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
| `Button` / `buttonClasses()` | `components/ui/button.tsx` | `variant: primary\|success\|secondary\|ghost\|danger\|warn\|accent`, `size: sm\|md\|icon`, `loading?`, `icon?` | **The** button. Replaced 11 drifted treatments, then 6 more in 2026-08-13 (`GitControls`' local `syncBtn` string ×4, `AttachmentPicker`'s attach button, `NewTaskForm`'s onboard nudge). `warn` is caution rather than failure — the action that clears a warning you're being shown; it exists for the not-onboarded-yet notice. `loading` renders the spinner, disables, and sets `aria-busy`. Built-in focus ring + `disabled:opacity-50`. Use `buttonClasses()` for `<Link>`s. Gradients are dark-stopped so white text clears AA — don't lighten them. Takes a **`ref`** to the underlying `<button>` (React 19 passes it as an ordinary prop, so it rides in `...rest` — no `forwardRef`, just the type); added for a caller that has to *move* focus onto it. **`loading` disables the button**, so if it currently has focus the browser drops focus to `<body>` — a caller that sets `loading` on a button the user just pressed owns putting focus back (see `UpdateBanner`). |
| `Modal` | `components/ui/modal.tsx` | `label`, `header?`, `actions?`, `onClose`, `align?: center\|top`, `className?` | Dialog shell: `role="dialog"` + `aria-modal` + accessible name, Escape-to-close, focus trap, focus restore, body-scroll lock. `DiffModal`/`FileModal`/`FolderPicker`/`CommandPalette` build on it — never hand-roll an overlay. **`align="top"`** (`items-start sm:pt-[10vh]`) is for a dialog whose content grows and shrinks *while it is open*: centring one of those moves the whole panel on every keystroke. Added for the command palette; everything else stays centred. The offset is `10vh` rather than a fixed value because on a short viewport a fixed one either wastes the height or leaves none, and `items-start` alone pins the panel to the 1rem gutter. |
| `PageHeader` | `components/ui-cards.tsx` | `title`, `description?`, `actions?` | Standard page title block. Carries **no** outer margin — place it inside the page's own `space-y-6`. |
| `EmptyState` | `components/ui-cards.tsx` | `icon?`, `title`, `hint?`, `action?` | Dashed-border placeholder for empty lists/sections. |
| `Skeleton` | `components/ui-cards.tsx` | `className?` | **The** loading placeholder bar — size it with `className` (`h-4 w-32`); surface, radius and the `animate-skeleton` breath are fixed so the 47–59 bars on a page can't drift apart. A `span` with `block`, so a bar standing in for a line of text is valid inside a `<p>`; `aria-hidden` on every instance. |
| `SkeletonPage` | `components/ui-cards.tsx` | `label`, `className?` (default `space-y-6`), `children` | The wrapper every `loading.tsx` uses: `role="status"` + one `sr-only` sentence, bars `aria-hidden`. Pass `className=""` on detail pages that space blocks manually. **Never add `aria-busy`** — see the Skeletons section. |
| Skeleton shapes | `components/Skeletons.tsx` | `SkeletonHeader`, `SkeletonCard`, `SkeletonCardSection`, `SkeletonRows`, `SkeletonTileRows`, `SkeletonTiles`, `SkeletonFacts`, `SkeletonDetailHeader` | Composite page shapes for the route `loading.tsx` files. Each mirrors a real component's shell classNames verbatim; keep them in sync or the skeleton→content swap becomes a jump. |
| `Select` | `components/ui/select.tsx` | `value`, `onChange`, `options: {value,label,description?,icon?}[]`, `searchable?`, `mono?`, `placeholder?`, `disabled?`, `className?`, `ariaLabel?` | **Searchable** bespoke combobox (popover + filter + keyboard nav). Use instead of native `<select>` or per-file wrappers. Search auto-enables past 7 options (force with `searchable`). `className` is for width/layout (e.g. `w-full`, `min-w-48`). Full combobox/listbox ARIA + keyboard. |
| `CardSection` | `components/ui-cards.tsx` | `title`, `right?`, `id?`, `className?` | `card` + header row (title + optional right slot); has built-in `min-w-0` so it shrinks inside grid/flex parents. `id` is an anchor target for a card something else deep-links to — the project page's `id="new-task"`, which the command palette's "New task in …" row points at. Use instead of hand-rolling `<section className={card}><h2>…</h2>` |
| `ViewAll` | `components/ui-cards.tsx` | `href`, `children?` (default "View all") | The "there is more of this elsewhere" link for a `CardSection` `right` slot — accent text + `ArrowRight`. Used by the dashboard's Agents / Projects / Recent-activity cards and by each `/tasks` project group ("Open project"). Was page-local in `app/(app)/page.tsx`; shared the moment a second page capped a list. |
| `Input` / `fieldClasses()` | `components/ui/input.tsx` | `size: sm\|md\|lg`, `tone: default\|danger`, + native `<input>` props | **The** form field, and the only one — five hand-rolled inputs were folded into it (2026-08-13), each of which had drifted its own focus ring (`ring-ring/40` vs the canonical `ring-accent/30`). `size`: `sm` = dense inline (`FolderPicker`'s go-to-path bar), `md` = default, `lg` = heading-sized so `ProjectName`'s rename-in-place doesn't resize the title. `tone="danger"` turns the focus border/ring danger-toned for a destructive confirmation (`DataSettings`' type-UNINSTALL field). `fieldClasses(size, tone, className)` is the same treatment as a string — shaped exactly like `buttonClasses()` — so a `<textarea>` matches an `<input>` instead of a second copy drifting (`AddBacklogItem`). **The field is `w-full`**, so a caller wanting a fixed width must use `max-w-*`, not `w-*`: two same-specificity width utilities race in the output CSS. Not for the composer textareas in `NewTaskForm`/`TaskLiveView` — those are deliberately `bg-transparent` inside a bordered drop zone. |
| `GettingStarted` | `components/GettingStarted.tsx` | `hasProject`, `hasTask`, `firstProjectId?` | First-run checklist on the dashboard: **token → project → first task**, rendering `null` once all three hold, so it costs an established user nothing. Defines the app's three nouns in one place (agent = installed plugin, project = folder on this device, task = one agent command run against a project) — the audit's finding was that a new user had to reverse-engineer all three. **Subsumes `TokenNudge` on the dashboard**: the token is step 1, and two banners saying it on one screen is the duplication this was meant to fix. Exactly **one CTA at a time**, on the first incomplete step — a checklist whose point is the obvious next thing shouldn't offer three competing buttons. State is spoken (`sr-only` "Done/Next/To do"), never colour-or-icon alone. The token step is marked `blocking`, which warn-tones **that row** — the tone sits on the row rather than on the card because `card` already sets `border-line` and a conditional `border-warn-line` on the same element is two same-specificity border colours racing in the emitted CSS. Rows are `flex-wrap` with the text column on `min-w-40` (not `min-w-0`): with `flex-1` and no floor the text collapses to a sliver beside the CTA instead of letting the CTA wrap, which at 390px wrapped the explainer one word per line. Server component; reads the vault directly like `TokenNudge` and takes the counts from the caller, which already queried them. |
| `BacklogItemRow` | `components/BacklogItemRow.tsx` | `projectId`, `item: BacklogRowItem`, `canOpenLinkedTask` | One row of `/backlog`: status dot + title + provenance (priority `Chip`, `/assignee`, spec path, "agent-filed" warn chip) + `ExpandableRequest` preview, with a `Select` for status and a Run button that dispatches and navigates to `/tasks/<id>`. The Run button reports the item's state rather than always offering the same action: **Run** → **Re-run** once it has a linked task → **Running** (disabled) while that task is live → **Done** (green `success`, disabled) once `item.status` is `done`. `item.status`, not the linked task's, so a run that finished and an item a person ticked off read identically. Re-running a done item is deliberately one step away — set the status control back to *To do* — because a disabled button gets `pointer-events-none`, so a `title` explaining how would never show on hover; the control that does it is the one sitting next to it. Renders `item.status` straight from the server rather than holding an optimistic copy — the sync and the linked-task reflection can both move a row, and reconciling that would need `setState` in an effect, which this build forbids. `canOpenLinkedTask` is decided server-side: the backlog is shared but tasks are private, so a link to someone else's run would be a guaranteed 404. The "Last run" line carries a `MergeStateChip` **beside** the run's `StatusBadge` rather than replacing it, because the two are independent — a task can be `done` with `mergeState: "conflict"`. An item never merges; the task dispatched from it does, so an item that has never run shows nothing. |
| `AddBacklogItem` | `components/AddBacklogItem.tsx` | `projectId`, `projectName`, `features?` | "Add item" button + `Modal` form (title / description / **feature** / agent). Fields are cleared only after the row exists, so a failed submit doesn't lose what was typed. The feature `Select` comes from `featureOptions()` and renders only when there is more than one option — see `NewTaskForm` for why the list is a prop rather than a fetch. |
| `AtAGlance` | `components/AtAGlance.tsx` | `total`, `successRate`, `inProgress`, `changedFiles`, `isWorkspace`, `memberCount`, `branchInfo`, `aheadBehind` | Project summary card (stats + git/workspace facts) |
| `SourceControl` | `components/SourceControl.tsx` | `projectId`, `isWorkspace`, `members`, `branchInfo`, `changes` | Project source-control card; delegates to `WorkspaceSourceControl` or `GitControls`+`ChangesList` |
| `TaskList` | `components/TaskList.tsx` | `history: TaskRow[]`, `namespaceById`, `projectNameById?`, `emptyMessage?` | **The** task-*history* row: project detail (via `TaskHistory`), dashboard recent activity, agent detail recent runs. (`UsageSummaryCard`'s "Most expensive runs" stays separate on purpose — it's a cost ranking over a narrow `TaskSpend` projection with no status or agent, so it has no badge and leads with cost. It shares the *naming* rule via `taskDisplayTitle()`, not the markup.) **Title-first** — `taskDisplayTitle()` from `lib/ui.ts` prefers `tasks.title` and falls back to `requestText`, then "no description". Row: `/ns:cmd` + version · name (`flex-1 truncate`, visible at every width) · project cell (only when `projectNameById` is passed) · cost + time-ago (`sm+`) · `StatusBadge`. Renders its own empty state; **no card shell** — the hosts head their cards differently, so wrap it in `CardSection`. Slicing is the caller's job. **`showMergeState`** adds a `MergeStateChip` to rows that have one — opt-in on width grounds (it is a sixth cell), so it is on inside `GroupedTaskList` where the feature branch is the subject and off everywhere else; below `sm` it is `sr-only sm:not-sr-only`, measured at `position:absolute` 1×1px, so a mobile row is byte-identical to before it existed. |
| `TaskHistory` | `components/TaskHistory.tsx` | `history`, `namespaceById`, `featureById?`, `className?` | Project detail's "Task history" card: `CardSection` + run count around `TaskList`, with the project cell omitted (every row belongs to the project on screen). Pass **`featureById`** to group by feature (switches the body to `GroupedTaskList`); omit it for the flat list. Opt-in even though the page always has them, because the map must be *complete* — a task whose feature is missing reads as ungrouped, which is a quietly wrong grouping rather than a visible error. The header count stays the card total either way. |
| `FeatureGroup` | `components/FeatureGroup.tsx` | `feature: FeatureLite \| null`, `count`, `unit`, `mergeStates?`, `children` | **The** feature heading, shared by all three grouped surfaces (`/backlog`, project detail, `/tasks`) so a feature can't look like a different kind of thing on each page: name + `feature/<slug>` branch chip + merge-summary chips + row count. `feature={null}` renders the ungrouped bucket ("No feature", `Layers` icon). It is an **`<h3>`**, which is what makes it composable — every host puts it inside a `CardSection` (`<h2>`), so the outline stays correct at project → feature and "Open" → feature alike. Deliberately **not** `<section aria-labelledby>`: a named `section` is an ARIA landmark, and a card of five features would add five regions for no navigational gain. **The branch chip is `min-w-0` + `break-all`, never `shrink-0`** — a branch is `feature/` plus up to 60 slug characters, and a rigid mono chip at that length forced **95px of horizontal page overflow at 390px** (measured on a real project's derived features; 164px at 320px). It wraps rather than truncating, because the branch is the string you came to copy and a `truncate`+`title` tooltip is unreachable by keyboard. Takes `mergeStates` rather than a pre-computed summary so `featureMergeSummary` stays the one definition — notably that it **never counts `pending`**. |
| `MergeStateChip` | `components/FeatureGroup.tsx` | `state: TaskMergeState` | One row's merge state as a `Chip`. Label and tone come from `MERGE_STATE_LABEL`/`mergeStateTone` in `lib/ui.ts` and are **never restated here** — a chip is tempted toward a shorter word ("Conflict"), which is how a second vocabulary for one state starts. `conflict` is **`warn`, not `danger`**: the merge failing is not the *run* failing (a task can be `done` with `mergeState: "conflict"`), and reserving `danger` for a failed run keeps the two tellable apart in a list holding both. `pending` is `muted` because for a checkout run it is the *terminal* answer, not a step toward one. Only the tooltip prose is local, since nothing else renders it. |
| `GroupedTaskList` | `components/TaskList.tsx` | `history`, `namespaceById`, `featureById`, `emptyMessage?` | `TaskList` under one `FeatureGroup` heading per feature — a thin wrapper, **not** a second row implementation (forking the row is how the three drifted copies `TaskList` replaced got started). Falls back to a plain `TaskList` when `groupByFeature` answers null, so a project or install with no features renders exactly as it did before: a single "No feature" heading over everything would be a level of hierarchy conveying nothing. |
| `Chip` | `components/ui-cards.tsx` | `tone: muted\|ok\|violet\|info\|warn`, `icon?`, `title?` | Pill badge for metadata/tags; tones map to the semantic tone tokens. **Tone names match the tokens they render** — they used to be `neutral` and `sky` while quietly emitting `bg-muted-soft` and `text-info`, so reading a call site told you the wrong colour; renamed 2026-08-13. There is deliberately **no `danger` tone**: nothing needs one, and an unused variant is its own debt — add it with its first call site. `warn` means *caution*, not failure — it exists for the backlog's "agent-filed" marker, where the point is that no person has read the text yet. `title` is for a chip whose one word needs a sentence behind it. |
| `Tile` | `components/ui-cards.tsx` | `value`, `label`, `tone?: ok` | Stat tile (number + label) |
| `Fact` | `components/ui-cards.tsx` | `icon`, `tag?`, `tagTone?: neutral\|ok\|warn` | Row in a facts list (bordered top) |
| `StatusBadge` | `components/StatusBadge.tsx` | `status: TaskStatus` | Icon + label badge; spinner on active |
| `Sidebar` | `components/Sidebar.tsx` | — | Desktop primary nav (`md+`): sticky full-height column, brand, links with an accent active indicator, footer with the theme control + collapse toggle. Collapses to a 64px icon rail via the `rail:` CSS variant (persisted in `localStorage`). Never duplicate. |
| `MobileTopBar` / `MobileTabBar` | `components/MobileNav.tsx` | — | Below `md`: a slim sticky top bar (brand + theme icon) and a fixed bottom tab bar. Layout `<main>` carries `pb-24` to clear the tab bar. Tabs are `flex-1 min-w-0`. **Now at 7 tabs** (Backlog landed 2026-08-12), which is past what the bar can label: seven tracks at 320px are ~45px, narrower than any of these words. So the label is `sr-only sm:not-sr-only` — **icons only below 640px**, labels back from `sm` up, and the word is the link's accessible name at every width either way. `py-3 sm:py-2.5` keeps the icon-only tap target at 44px. The alternative considered and rejected was an iOS-style "More" tab: it would bury two destinations behind a second tap and a new interaction pattern. The top bar's right cluster ends with `ActivityBadge` — **last on purpose**, since its popover is anchored to its own right edge and any icon after it steals that much width from a 320px screen. |
| `ThemeToggle` / `ThemeToggleIcon` | `components/ThemeToggle.tsx` | — | Light/dark/system control. `ThemeToggle` is now a thin wrapper over `SegmentedControl` (expanded sidebar); `ThemeToggleIcon` is a single cycling button (rail + mobile). Reads state via `useSyncExternalStore` off `<html>`. |
| `SegmentedControl` | `components/ui/segmented.tsx` | `value`, `onChange`, `options: {value,label,icon?}[]`, `ariaLabel`, `iconOnly?`, `className?` | **The** segmented control, for a small fixed set of **client-side** choices — the theme (`ThemeToggle`) and the diff viewer's unified/split. Extracted from `ThemeToggle` when the second call site appeared; it gained two things the hand-rolled copy never had: **roving tabindex + ←/→/↑/↓/Home/End** (a radio group is one tab stop, and focus follows selection), and the accessible name as an **`sr-only` span rather than an `aria-label`**, so an icon-only segment and a labelled one are named the same way. Deliberately **not** what `SpendRangeNav`/`ProjectFilterNav` use: those *navigate* (URL state driving a server component), so they're links with `aria-current`. Reach for `role="radiogroup"` only when the state genuinely can't leave the client. An unmatched `value` still leaves the first segment tabbable, or the group would drop out of the tab order entirely. |
| `CodeView` / `useHighlightedLines` / `CodeTokens` | `components/CodeView.tsx` | `code`, `path` | Read-only file view: line numbers + syntax highlighting + wrapping. Used by `FileModal` for anything that isn't markdown. `useHighlightedLines(code, language)` is the shared hook — it **lazily `import()`s `lib/highlight.ts`** (~120 KB of grammars, code-split out of every page's bundle) and stores the result *with the inputs that produced it*, so the previous file's colours can never be painted onto the new file's lines for a frame. It renders plain text first and swaps in colour when the chunk lands, so a slow or failed load costs colour and nothing else. Two disclosed caps: no highlighting past **200 KB** (`HIGHLIGHT_MAX_BYTES`), and past **5 000 lines** it drops to a single `<pre>` — the gutter and per-line rows are what make a huge file expensive. Both say so on screen; neither truncates content. `GUTTER` is the shared gutter class (`fg-faint`, not `fg-ghost` — a sighted user reads line numbers — but `aria-hidden`, because announcing a number before every line is noise). |
| `DiffView` | `components/DiffView.tsx` | `diff`, `path`, `view: "unified" \| "split"` | Renders a unified diff as rows, in either layout. **Both views are built from the same parsed rows** (`lib/diff-parse.ts`), so the split view re-groups what git already computed rather than diffing anything itself and the two can't disagree. Highlighting is per *side of a hunk*, not per line — a line inside a block comment would otherwise be re-lexed as code. Add/delete is carried by a rendered `+`/`−` character as well as the `ok-soft`/`danger-soft` wash, so it is never colour-alone; the sign is `select-none` so copying gives you the code. Falls back to the **original prefix-colouring `<pre>`** whenever `parseUnifiedDiff` returns null, which is the whole reason that path is kept: the diff endpoint can return text no version of git ever wrote (`untrackedDiff` synthesizes its own). Split panes get `min-w-176` and scroll sideways *inside the modal* below ~700px rather than crushing to two unreadable columns. **Two caps, both disclosed, neither truncating**: no highlighting past 3 000 rows, and past **5 000** rows (`ROWS_MAX`, the same number as `CodeView`'s) the whole diff renders as one `<pre>`. That second one was a blocking audit finding — `DIFF_CAP` bounds a diff to 200 000 *characters, not lines*, so a file of many short lines fits under it while producing tens of thousands of five-element rows, doubled again in split view. Measured on a real 60 000-line diff: 3 DOM nodes instead of ~300 000. **Give any new view here the same guard.** |
| `nav-links` | `components/nav-links.tsx` | `NAV_LINKS`, `isActive()` | Single source of truth for the primary nav items (Dashboard · Agents · Projects · **Backlog** · Tasks · Usage · Settings), shared by the sidebar, the mobile nav **and the command palette's Pages section**. Add a route here and all three pick it up. Each entry may carry `keywords` — extra palette search terms for a page whose label doesn't contain the word you'd type (nothing in "Settings" says "token"). They match by **prefix**, not substring, so a keyword can't hijack a query aimed at a project or task that merely contains it. `isActive` matches by prefix, so `/tasks/<id>` keeps Tasks lit. Backlog sits before Tasks because that's the order work moves through them. The mobile bar stopped labelling tabs at seven — check the `MobileTabBar` row before adding an eighth. |
| `Avatar` | `components/AgentAvatar.tsx` | `namespace: string`, `size?: number` (default 48) | Per-agent photo/initials avatar; fallback to monogram disc on 404 |
| `AgentContributors` | `components/AgentContributors.tsx` | `namespaces: string[]`, `size?: number` (default 28), `ringClass?: string` (default `ring-surface-2`) | Overlapping avatar ring with a group `aria-label`; shows "no runs yet" when empty |
| `AddProjectForm` | `components/AddProjectForm.tsx` | — | Client form; project registration by absolute path, with **Browse…** opening `FolderPicker` |
| `FolderPicker` | `components/FolderPicker.tsx` | `initialPath?`, `onSelect(path)`, `onClose()` | In-app folder browser modal (built on `Modal`). Rows **navigate into** a folder; the footer selects the folder you're in. Home/Up icon buttons (Up climbs between roots), a **Go** field that jumps to a pasted absolute path (Finder's ⌘⇧G), extra roots as footer chips, `FolderGit2` + `text-accent` for git repos, an "Added" tag for registered folders. Reads `/api/fs/list`, jailed to `PROJECT_ROOTS`. Rendered **outside** `AddProjectForm`'s `<form>` so its input's Enter can't submit that form. Replaced the native macOS Finder dialog — that could never work in the Docker dev container. |
| `NewTaskForm` | `components/NewTaskForm.tsx` | `projectId: string`, `agents: AgentLite[]`, `onboardedByAgent?`, `parallelOffer?`, `features?` | Dispatch task; agent + command selector; amber warning when agent not onboarded. The optional **feature picker** (`featureOptions()` in `lib/ui.ts`) gets **its own row** rather than a third control in the drop-zone footer beside Model — a feature name runs to 200 characters and that row already wraps awkwardly at 390px with two items in it. `features` is a **prop, not a fetch**: both hosts are server components already holding the rows, so fetching would buy a loading state and a round trip for data on screen. `featureId` is gated on the control being offered before it is sent, the same stale-flag guard `parallel` uses. |
| `ProjectActions` | `components/ProjectActions.tsx` | `projectId: string` | Rescan + remove. Remove uses an **inline two-step confirm** (not native `confirm()`) and surfaces fetch errors. |
| `GitControls` | `components/GitControls.tsx` | `projectId: string`, `info: BranchInfo`, `member?: string` | Branch switcher + pull/push with ahead/behind badges |
| `ChangesList` | `components/ChangesList.tsx` | `projectId: string`, `member?: string`, `changes: GitChanges` | Uncommitted file list with diff trigger |
| `DiffModal` | `components/DiffModal.tsx` | `projectId: string`, `path: string`, `member?: string`, `onClose: () => void` | Unified diff viewer; built on the shared `Modal` |
| `FileModal` | `components/FileModal.tsx` | `projectId: string`, `path: string`, `member?: string`, `onClose: () => void` | In-repo file viewer (md/plain); built on the shared `Modal`. For a pm task spec it also offers **Create task**, which dispatches **through that spec's backlog item** (`GET …/backlog` to resolve it by `sourcePath`, then `POST …/backlog/<itemId>/run`) so the item links to the run and follows it; a direct `POST /api/tasks` is only the fallback for a spec the backlog can't hold (a workspace-member repo, or one the scan refused). A lookup that *fails* is not that fallback — it refuses and says so, because dispatching blind would skip the run route's already-running check and can start a second billed session on the same spec. |
| `ErrorAlert` | `components/ui/error-alert.tsx` | `message: string \| null`, `action?: {href,label} \| null`, `className?` | **The** failure message, and the only one that may carry a link. The link renders **inside** the `role="alert"` paragraph — an alert is a live region, so a sibling link is announced as a second separate event; sharing the element makes the problem and the way out one sentence. It inherits `text-danger` and is marked by weight + underline, never colour, so it stays legible on `bg-danger-soft` in both themes. `className` is the caller's layout/density (`mt-2 text-xs` in `BacklogItemRow`, `mt-3 text-sm` in `NewTaskForm`, `border-b bg-danger-soft px-4 py-2 text-xs` for `FileModal`'s full-width bar), shaped like `buttonClasses()`/`fieldClasses()`. Renders `null` with no message. Pair it with `dispatchErrorAction()` (`lib/ui.ts`), which maps a refused dispatch to its link — 409 → the run already going, 412 → Settings — so the two dispatch endpoints can't drift in how they're explained. **Debt:** the message-only `<p role="alert">` paragraphs elsewhere (`AddProjectForm`, `AddBacklogItem`, `ProjectActions`, `ProjectName`, `DataSettings`, `DiffModal`, `FolderPicker`, `TaskLiveView`, and `AttachmentPicker`'s warn-toned one) predate this and should be folded in by the next `/fe:audit`. |
| `WorkspaceSourceControl` | `components/WorkspaceSourceControl.tsx` | `projectId: string`, `members: ResolvedMember[]` | Git + changes per workspace repo. Proper ARIA **tablist** with roving ←/→/Home/End focus; the changes list is height-capped to match the single-repo path |
| `TaskLiveView` | `components/TaskLiveView.tsx` | `taskId: string`, `runnerUrl: string`, `initialStatus: string`, `projectId: string`, `agentId: string` | SSE-based live task transcript |
| `ExpandableRequest` | `components/ExpandableRequest.tsx` | `text: string` | Collapsible markdown task request (160-char preview); disclosure button wired with `aria-expanded`/`aria-controls` |
| `RunDuration` | `components/RunDuration.tsx` | `createdAt: number`, `endedAt: number \| null`, `active: boolean` | Live-ticking elapsed time chip; ticks every second while active |
| `UsageBreakdown` / `UsageCost` | `components/UsageDisplay.tsx` | `usage: TaskUsage`, `className?` | Token/cost display at two densities: a labelled `<dl>` (task detail, user totals) and a bare mono cost for dense list rows. Each renders `null` rather than a misleading zero — `UsageBreakdown` when nothing at all was recorded (`hasUsage()`), `UsageCost` when there's no cost to show (a run can bank tokens without a billable turn). Feed them via `taskUsage(row)` from `lib/usage-format.ts`. |
| `UsageSummaryCard` | `components/UsageSummaryCard.tsx` | `spend: SpendSummary` | The signed-in user's spend, titled **"Your spend"** (not "Usage" — it sits under the `/usage` page's own `<h1>Usage</h1>`): four `Tile`s, a token `UsageBreakdown`, top-5 costliest runs (each labelled with its project), and the `unattributed` footnote. Every figure is scoped to `spend.range`, so the tile label and empty-state copy change with the window. Server component (`spendForUser()` is a direct query). |
| `ProjectFilterNav` | `components/ProjectFilterNav.tsx` | `projects: {id,name,count?}[]`, `selected: string \| null`, `basePath?`, `showAll?`, `unit?`, `ariaLabel?` | Pick a project — the filter on `/tasks` **and** the project switcher on `/backlog`. **Links, not buttons**, for `SpendRangeNav`'s reasons (URL state → server component, bookmarkable, `aria-current="page"` is the honest ARIA for navigation). **Wrapping pills** rather than a fixed segmented control, because the project count is unbounded. Per-pill count is `aria-hidden` with an `sr-only` "…, N tasks" beside it — a bare number reads as part of the name; omit `count` where there's no number worth showing. **Self-guards**: returns `null` below two projects. The two callers differ only in data: `/tasks` filters (so it offers "All projects" and lists only projects with tasks — a filter to a guaranteed-empty list is a dead end), `/backlog` shows one project at a time (no "all", and **every** project is listed, since a project with nothing recorded is exactly where you'd go to import the first item). |
| `SpendRangeNav` | `components/SpendRangeNav.tsx` | `value: SpendRange` | Time-window filter for `/usage` (7 days · 30 days · All time). **Links, not buttons** — the range is URL state (`?range=`), so it needs no client JS and stays bookmarkable; the default range carries no param. Visually identical to `ThemeToggle`'s segmented control, but `<nav>` + `aria-current="page"` rather than `role="radiogroup"`, because it navigates. Labels come from `SPEND_RANGES` in `lib/usage-format.ts`. |
| `ProjectSpendCard` | `components/ProjectSpendCard.tsx` | `spend: SpendSummary` | Per-project spend for the selected range: cost, a decorative share bar, tokens and run count. Caps at 8 rows and **discloses** the remainder ("A further $X across N smaller projects") rather than truncating silently. Server component; reads the same `SpendSummary` as `UsageSummaryCard` so the two can't disagree. |
| `UpdateBanner` | `components/UpdateBanner.tsx` | — | Bar above `<main>` in the app layout for a long-running **installed** app: a newer release exists, applying it, and what happened (fed by `/api/updates`, including the last attempt's `run` record). Renders `null` in every other case — no update, still checking, offline, or a git checkout. Dismissal is per-version in `localStorage`. **Six states in one discriminated union** (`idle` · `applying` · `blocked` · `failed` · `stalled` · `uptodate`), which replaced four independent booleans — the combinations were what let a *refused* update render as the same bar with a relabelled button, indistinguishable from a button that did nothing. Tone carries the state (`info` → `warn` for refused/stalled → `danger` for failed) as **one class string per state**, never two same-specificity colour utilities on an element. Copy and state classification live in `lib/update-ui.ts` so `pnpm test` covers them: sentences are built as whole template strings (1-vs-N agreement, and the `{expr}`-eats-the-space trap), and no builder puts a filesystem path mid-sentence — a path renders as a path, mono and wrapping, beside the log disclosure. Three rules worth keeping: **the primary action is the same element in the same slot in all six states**, because every transition is reached by pressing it and swapping the element drops keyboard focus to the document; **one `aria-live="polite"` region** on the always-present message paragraph, with the resolving link *inside* the sentence (`ErrorAlert`'s principle) but deliberately **not** `ErrorAlert` itself — it hardcodes `text-danger`, which can't sit on a warn wash, and nesting its `role="alert"` inside this live region is two announcements; and `variant="danger"` for **Update anyway**, because the `warn` variant *is* `bg-warn-soft` and would vanish into the warn bar. Layout is one `flex flex-wrap` row with icon+message nested as a single item on `min-w-40 flex-1` (`min-w-0` collapsed it to one word per line beside the `shrink-0` buttons — `GettingStarted`'s trap), plus `basis-full sm:basis-auto` on the notice states so the actions wrap underneath below `sm`. Same element is necessary but **not sufficient**: `loading` disables that button, and disabling the focused element drops focus to `<body>` — so entering `applying` records whether it held focus and an effect takes it back after the commit, but only if nothing else claimed it meanwhile. Both focus paths (press → refusal, and *Not now* removing itself) were measured in a browser, not reasoned about. The log panel is `bg-sunken` like every other transcript/code surface, the log path wraps (`break-all`) rather than `truncate`, which ellipsises the *filename* and leaves only a `title` no keyboard can reach, and `uptodate` is `ok`-toned so the check mark and the wash agree. Note the one new composition: a `danger` button's `bg-danger-soft` sits on the bar's `bg-warn-soft` — checked at ~7:1 in both themes, but soft-on-soft is otherwise not a pattern here. |
| `ActivityBadge` | `components/ActivityBadge.tsx` | `className?` | The global "N in progress" pill + quick-jump popover, mounted twice in the app chrome (the sticky desktop strip in `app/(app)/layout.tsx`, the mobile top bar in `MobileNav`) and rendering **nothing** when nothing is running. Both mounts share one poll via `lib/active-tasks.ts` (module store + `useSyncExternalStore`, same shape as `lib/sidebar.ts`), fed by `GET /api/tasks/active`. Popover is a **disclosure** (`aria-expanded`/`aria-controls` over real `<Link>`s), not a `role="menu"`; hover opens it as a convenience only, and it closes on navigation via a render-time state reset (not a derived value — that let a pinned popover reopen itself on Back). Wording is "in progress", matching the dashboard stat tile, because the set includes queued and gate-blocked runs. **No `aria-label`** — the accessible name is the pill's own text, with the word `sr-only sm:not-sr-only` so it survives at every width. Rows reuse `StatusBadge`; the header reuses `ViewAll`. Pill is `bg-surface` + `border-warn-line` + `text-warn`, **not** `bg-warn-soft` — it floats over scrolling content and the warn tone's dark value is a 15% wash. `className` is for layout only (the desktop mount passes `my-2`). |
| `PlanLimits` | `components/PlanLimits.tsx` | — | Claude plan rate-limit windows as utilization bars. Client component; fetches `/api/usage` and **renders nothing at all** (no card, no skeleton, no error) unless the SDK reports limits as available — which on this app it normally doesn't. |
| `AttachmentPicker` | `components/AttachmentPicker.tsx` | `files: File[]`, `onAdd: (files: File[]) => void`, `onRemove: (idx: number) => void` | File attach bar (Paperclip + chips); shared by `NewTaskForm` and `TaskLiveView` change-request box |
| `Markdown` | `components/Markdown.tsx` | `children: string`, `onFileClick?: (path: string) => void` | `react-markdown` with GFM + remark-breaks; normalizes agent bullet glyphs; clickable `.fe/.swe` test-scenario / `.pm/tasks` file paths |
| `Toaster` + `toast()` | `components/Toaster.tsx`, `lib/toast.ts` | `toast({status, title, project, taskId?, key?})`, `dismissToast(id)`, `dismissToastByKey(key)`, `dismissAllToasts()` | **The** notification layer, mounted **once and last** in `app/(app)/layout.tsx` — last because toasts and `Modal` are both `z-50`, so DOM order is what keeps a gate notice off the wrong side of a modal scrim. Cards are `bg-surface` + a tone-tinted border from `statusBorderColor()`, never `bg-{tone}-soft`: this floats over scrolling content and the soft tones are translucent in dark mode (`ActivityBadge`'s pill learned it first). The status **is** the headline — a reused `StatusBadge` spells out which gate is waiting or how the run ended, so no second vocabulary can drift from `STATUS_LABEL` and nothing is carried by colour alone; a nameless run says "no description" in `fg-faint`, the same phrase `TaskList` uses. **Nothing auto-dismisses and there is deliberately no `duration` option**: WCAG 2.2.1 wants timed content pausable, and these are events you may not have been at the screen for — so sticky + dismissible instead, kept from becoming clutter by `key` (a newer toast for the same subject *replaces* the older one in place, rather than moving the card out from under a pointer heading for its Dismiss button), `TOAST_LIMIT` = 4 oldest-dropped, and the watcher retracting a gate notice once that run moves on. The container is **always in the DOM** so its `aria-live="polite"` region pre-exists the first toast (a region mounted *with* its content announces nothing), which forces `pointer-events-none` on it with `pointer-events-auto` per card — a permanently-mounted fixed corner element would otherwise swallow clicks for the life of the page. **One polite region for every tone, no `role="alert"` on failures**: nesting an assertive alert inside a polite region is two announcements for one event (`UpdateBanner`'s trap). Layout is `inset-x-4 bottom-24` (clearing the mobile tab bar, the same 6rem `<main>` reserves) → `sm:right-4 sm:w-96 md:bottom-6`. Uses the app's one custom keyframe, `--animate-toast-in`. The stack is bottom-anchored so it grows *upward*, which puts the newest card nearest the corner and makes the **oldest** what the cap and the `max-h`/`overflow-y-auto` scroll container give up — the right way round, since oldest is the longest-pending gate. That scroll container carries `-m-2 p-2` (or `overflow` shears the flat sides off every card's `shadow-2xl`) and both it and `pointer-events-auto` apply **only while there are toasts**, because padding on the always-mounted empty region would put a click-swallowing strip over the corner for the life of the page. **Known limitation:** while a `Modal` is open its focus trap makes a toast's link keyboard-unreachable — the card is still visible and Escape closes the modal. This is the correct trade, not a shortcut: the WAI-ARIA APG requires a modal dialog to contain focus, so making the link Tab-reachable would itself be the violation. |

| `CommandPalette` + `PaletteTrigger` | `components/CommandPalette.tsx`, `lib/command-palette.ts` | — (trigger: `iconOnly?`, `className?`) | **⌘K / Ctrl+K from anywhere**: jump to any project, task, agent, backlog item or nav page, plus quick actions (switch theme, "New task in *project*"). Mounted **once** in `app/(app)/layout.tsx`, above `Toaster` so a gate notice still floats over its scrim. Built on `Modal` with the new `align="top"`; static rows come from `NAV_LINKS`, dynamic ones from `GET /api/search` (150ms debounce, `limit=5` per type). **Every branchy decision lives in `lib/command-palette.ts` with specs** — what a query matches, which section a hit lands in, where a row navigates, how the highlight wraps — because `pnpm test` can't reach `components/` and each of those is wrong *silently*. Six things worth knowing before touching it: the dialog body is an **inner component mounted only while open**, which is what makes a reopened palette empty with no reset code (resetting on open would be `setState` in an effect); the shortcut is **ignored while another `[role="dialog"]` is up**, because two `Modal`s means one Escape closing both; the highlight **wraps** (`SegmentedControl`'s convention) and is clamped on read (`Select`'s); **Home/End are deliberately not hijacked** — this is an editable combobox, so they move the caret; a capped group discloses itself **in its heading**, which keeps it part of the group's accessible name instead of stray text inside a `listbox` (which may only contain options and groups — the empty-state sentence sits outside it for the same reason); and a task row's `StatusBadge` is `sr-only sm:not-sr-only`, not `hidden sm:flex`, so "Awaiting change approval" stops eating a 320px row without dropping the status out of the row's name (`MobileTabBar`'s trick). Icons come from **one flat record keyed by string** — a `Map` or a ternary chain is rejected outright by this build's `react-hooks/static-components` rule as "creating a component during render"; `StatusBadge` has the shape to copy. The trigger is mounted three times (expanded sidebar, collapsed rail, mobile top bar) and carries `aria-keyshortcuts`; **the mobile one is not optional** — a phone has no ⌘K, so without it the feature doesn't exist below `md`. |

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
- **Two class strings are now duplicated twice each, deliberately left at two** (design review,
  2026-08-20). Both are recorded here so the next audit reads them as known rather than as drift,
  and **the third call site is the trigger to extract**:
  - the *chrome icon button* (`grid size-9 shrink-0 place-items-center rounded-lg text-fg-subtle
    transition-colors hover:bg-hover hover:text-fg-strong`) in `ThemeToggleIcon` and
    `PaletteTrigger`'s `iconOnly` branch. It is **not** `Button variant="ghost" size="icon"`:
    that is `size-8`, and overriding it to `size-9` puts two same-specificity size utilities on
    one element (the emitted-CSS-order trap `GettingStarted` documents) *and* shrinks a tap
    target that the mobile bar needs at 36px.
  - the *field-shaped button* in `PaletteTrigger`'s default branch, which restates
    `border-line-strong bg-surface-2` rather than calling `fieldClasses("md")` — that helper
    forces `w-full` and an input-tuned focus ring onto what is a `<button>`.
- `AgentAvatar`'s initials fallback uses one colour for every namespace, so agents without a
  photo are visually indistinguishable in a contributor stack.
- Keyboard navigation is reasoned about but not formally tested end-to-end (no a11y test
  tooling in the project).
