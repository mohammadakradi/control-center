# Consistency Audit Procedure

How `/fe:audit` scans a whole project for design drift and frontend debt, measured against
`.fe/design-system.md`. The audit is **read-only**: it produces a prioritized, actionable
report — it does not change code. Fixes flow through the gated workflow (one fix per
`/fe:task`, reviewed and approved).

Before auditing, read `.fe/design-system.md` (the source of truth) and `CLAUDE.md`. If the
inventory is missing, run onboarding first — there's nothing to measure consistency against
otherwise.

For a large codebase, dispatch the read-only `ui-explorer` subagent to gather the inventory
of usages in parallel; for smaller ones, grep directly.

## What to scan for

### 1. Color / theme drift
- **Hardcoded colors** — hex (`#1a2b3c`), `rgb()/rgba()/hsl()` literals, named CSS colors in
  component/style files where a token exists. Grep for `#[0-9a-fA-F]{3,8}`, `rgb(`, `hsl(`.
- **Off-palette values** — colors close to but not equal to a design token (drift), or new
  one-off colors not in the inventory.
- **Dark-mode gaps** — light-only values that don't adapt; missing dark variants.

### 2. Spacing / sizing / typography drift
- Magic pixel/rem spacing where a scale token exists; inconsistent paddings for the same kind
  of element. Off-scale font sizes/weights/line-heights; ad-hoc heading styles instead of the
  type scale.

### 3. Duplicated components & styles, and missing abstractions (DRY)
- Multiple components doing the same job (several bespoke buttons/cards/modals) instead of the
  shared primitive. Copy-pasted style blocks. Components that reimplement something already in
  the reuse catalog.
- **Repeated raw elements that should be a shared base component.** Grep for bare HTML
  elements used repeatedly with the same styling/behavior and no wrapper — e.g. `<select>`,
  `<input>`, `<textarea>`, `<button>`, `<table>`, repeated icon+label combos, repeated
  badge/chip/card markup. When the same raw pattern appears in **3+ places** (note 2), that's
  a **missing abstraction**: report it as a candidate for extracting a shareable base
  component (e.g. a `Select`/`Input`/`Card`), and list the call sites it would replace. This
  is the highest-leverage consistency win — one base component fixes drift everywhere at once.

### 4. Accessibility gaps
- Missing/incorrect labels (`<input>` without label, icon-only buttons without `aria-label`),
  non-semantic clickable `<div>`/`<span>`, missing/insufficient focus styles, images without
  `alt`, color-only signaling, contrast likely below AA, missing `prefers-reduced-motion`
  handling. Run the project's a11y lint (e.g. `eslint` with `jsx-a11y`) if present.

### 5. Inconsistent patterns
- The same interaction implemented differently across the app (different modal patterns, form
  validation styles, loading/empty/error states), inconsistent iconography, mixed styling
  approaches (inline styles where the system is Tailwind).

## Method
- Prefer the project's own tooling first: run `lint` / a11y lint / stylelint and collect
  findings. Then grep for the hardcoded-value and duplication patterns above. Read
  representative offenders to confirm (don't report a token *definition* as a violation).
- Distinguish **confirmed** issues (a real off-token literal) from **suspected** (needs a
  human eye, e.g. subjective inconsistency).

## Output — a prioritized report
Group by category, ordered by impact × reach (how many places, how user-visible):

```
DESIGN CONSISTENCY AUDIT — <project> · <date>
SUMMARY: <n> issues across <categories>; top themes: <…>
TOOLS RUN: <eslint/jsx-a11y: N findings; stylelint: …; greps: …>

P1 (high impact / widespread)
  - [category] <file:line> — <issue> — <the token/component it should use> — <fix sketch>
P2 (should fix)
  - ...
P3 (nits / subjective)
  - ...

SUGGESTED EPIC: <if the cleanup is large, propose grouping P1/P2 into a /fe:plan epic>
COVERAGE GAPS: <what couldn't be checked automatically (e.g. visual contrast) and why>
```

End by telling the user how to act: fix individual items with `/fe:task "<item>"`, or
`/fe:plan` an epic to clean up systematically. Optionally append the confirmed items to the
"Known inconsistencies / debt" section of `.fe/design-system.md` so they're tracked.
