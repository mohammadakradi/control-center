# Design System Inventory Template

Onboarding writes `.fe/design-system.md` using this structure. It is the **canonical
reference** for the project's visual language and reusable components — every task consults it
before building, and the `design-reviewer` and `/fe:audit` check changes against it.

Fill every field from the **actual values** in the repo's token/theme source and component
directories (exact hex/tokens, real file paths). Omit a section only if it genuinely doesn't
apply. Keep it accurate and current — a stale inventory causes drift.

---

```markdown
# Design System — <Project Name>

_Maintained by the fe-agent · source of truth for tokens & reusable components · updated <date>_

## Styling system
- Approach: <Tailwind / CSS Modules / styled-components / SCSS / …>
- Token/theme source: <file(s), e.g. `tailwind.config.ts` theme, `app/globals.css` :root vars>
- Dark mode: <mechanism, e.g. `class="dark"` on <html> / `data-theme` / media query / none>
- Component library: <shadcn / Radix / MUI / bespoke `src/components/ui` / …>

## Colors
> Use these tokens — never hardcode raw values that a token already expresses.
| Token | Light | Dark | Use |
|-------|-------|------|-----|
| primary | `<value>` | `<value>` | <primary actions> |
| secondary | `<value>` | `<value>` | <…> |
| accent | `<value>` | `<value>` | <…> |
| background / surface | `<value>` | `<value>` | <…> |
| foreground / text | `<value>` | `<value>` | <…> |
| muted | `<value>` | `<value>` | <…> |
| border | `<value>` | `<value>` | <…> |
| success / warning / destructive | `<value>` | `<value>` | <semantic states> |

## Typography
- Font families: <body>, <heading>, <mono>
- Type scale: <e.g. xs 12 / sm 14 / base 16 / lg 18 / xl 20 / 2xl 24 …>, weights, line-heights
- Heading styles: <h1…h6 mapping>

## Spacing & layout
- Spacing scale: <e.g. Tailwind default 0–96, or custom>
- Container widths / max-widths: <…>
- Breakpoints: <sm / md / lg / xl / 2xl → px>
- Grid/layout conventions: <…>

## Radii, shadows, borders, motion
- Radius scale: <sm / md / lg / full → values>
- Shadows: <named elevations>
- Borders: <widths/colors>
- Motion: <durations/easings; respect `prefers-reduced-motion`>

## Icons & assets
- Icon set: <lucide / heroicons / …> — usage: <import pattern>
- Fonts: <how loaded>

## Reusable components (reuse catalog)
> Before building anything new, check here first and reuse/extend.
| Component | Location | Variants / key props | Notes |
|-----------|----------|----------------------|-------|
| Button | `<path>` | <variant: primary/secondary/ghost; size: sm/md/lg> | <…> |
| Input | `<path>` | <…> | <…> |
| Card | `<path>` | <…> | <…> |
| Modal/Dialog | `<path>` | <…> | <…> |
| … | | | |

## Accessibility baseline
- Target: <WCAG AA>
- Lint: <jsx-a11y / eslint-plugin-vuejs-accessibility / none>
- Conventions: <focus-visible styles, label patterns, reduced-motion handling>

## Known inconsistencies / debt
<!-- running list of drift to fix via /fe:audit — hardcoded values, duplicate components, etc. -->
```

---

Notes:
- Capture **exact** token names and values — approximations defeat the purpose.
- This file is committed with the work and updated whenever a token or shared component
  changes (frontend rule 7).
