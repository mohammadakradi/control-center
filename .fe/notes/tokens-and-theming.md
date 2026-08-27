# tokens and theming

Tokens, the light/dark mechanism, and the theming mistakes this project keeps repeating.

<!-- Split out of a single 79 KB `.fe/notes.md` on 2026-08-24, which was read in full at the start of every request (frontend rule 10). Entries are verbatim; only this header is new. -->

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

## Grid needs an explicit `grid-cols-1` base
A bare `grid` with only a `lg:`/`md:` column class (e.g. `grid gap-5 lg:grid-cols-2`) has NO column template below that breakpoint, so it falls back to a single implicit `auto` column sized to max-content → horizontal page overflow on mobile. Always write `grid grid-cols-1 … lg:grid-cols-2`. `grid-cols-N` resolves to `minmax(0,1fr)` which clamps the track. (This was the project-detail horizontal-scroll bug.)
