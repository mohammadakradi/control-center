# Design System — Agent Platform

_Maintained by the fe-agent · source of truth for tokens & reusable components · updated 2026-07-29 (sidebar + light/dark)_

## Styling system
- Approach: **Tailwind CSS v4** — CSS-first config, no `tailwind.config.*` file
- Token source: `app/globals.css` — a **semantic CSS-variable layer** (`:root` = light,
  `.dark` = dark) surfaced as Tailwind utilities through `@theme inline`
- Theming: **light / dark / system**, default `system`. Blocking init scripts (`lib/theme.ts`,
  `lib/sidebar.ts`) set `class` + `data-*` on `<html>` before first paint
- Component library: **Bespoke only** — no shadcn, Radix, MUI, or Headless UI

## Reusable components (reuse catalog)
> Before building anything new, check here first and reuse/extend.

The catalog itself lives in `.fe/notes/` so this file stays inside its 25 KB budget: it is read
at the start of most tasks, while the full inventory is only needed when you are actually
building a component — [part 1](notes/component-catalog-1.md) · [part 2](notes/component-catalog-2.md).

**Rule 3 is unchanged: check the catalog before building anything new.**

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
