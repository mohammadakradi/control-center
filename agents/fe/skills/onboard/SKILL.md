---
name: onboard
description: Onboard the fe (frontend-engineer) agent to a project — detect the framework and styling system, inventory the design tokens/colors/typography/spacing and reusable components, map the UI, establish a build/run baseline, and write CLAUDE.md plus .fe/design-system.md. Use at the start of working in any UI project, or when CLAUDE.md / the design inventory is missing or stale.
---

# Onboarding a frontend project

Goal: produce (or refresh) two artifacts that let any future UI task be done correctly and
consistently —
1. a `CLAUDE.md` capturing the stack, commands, conventions, and operating rules, and
2. **`.fe/design-system.md`** — the canonical inventory of design tokens (colors,
   typography, spacing, radii, shadows, breakpoints, motion) and reusable components, so
   later work reuses what exists instead of drifting.

First, read the frontend engineering rules at `${CLAUDE_PLUGIN_ROOT}/rules/frontend-rules.md`,
the `CLAUDE.md` template at `${CLAUDE_PLUGIN_ROOT}/rules/claude-md-template.md`, and the
design-system template at `${CLAUDE_PLUGIN_ROOT}/rules/design-system-template.md`. Follow the
rules; write `CLAUDE.md` and `.fe/design-system.md` using those templates.

## Procedure

### 1. Detect the frontend stack
From `package.json` + lockfile, identify:
- **Framework / meta-framework:** React, Vue, Svelte, Angular, Solid, Next.js, Nuxt,
  SvelteKit, Remix, Astro, etc. Note version and rendering model (SPA / SSR / SSG / RSC).
- **Build tool:** Vite, webpack, Turbopack, Rspack, esbuild, Parcel.
- **Language:** TypeScript vs. JavaScript; JSX/TSX vs. SFCs vs. templates.
- **Package manager:** npm / pnpm / yarn / bun (from the lockfile).
- **Routing & state:** router (file-based vs. config), state libs (Redux, Zustand, Pinia,
  Jotai, TanStack Query, Signals, Context).
- **Testing/visual tooling:** Vitest/Jest, Testing Library, Playwright/Cypress, Storybook,
  Chromatic, visual-regression setup.

### 2. Detect the styling system & design tooling
This is central. Identify how the project styles UI and where the design source of truth is:
- **Styling approach:** Tailwind, CSS Modules, styled-components / Emotion, vanilla-extract,
  Stitches, SCSS/Less, plain CSS, UnoCSS, Panda.
- **Component library / design system:** shadcn/ui, Radix, MUI, Chakra, Ant Design,
  Mantine, Bootstrap, Vuetify, PrimeVue, or a bespoke in-repo library (e.g. `packages/ui`,
  `src/components/ui`).
- **Token/theme source:** `tailwind.config.*` theme, CSS custom properties (`:root { --… }`),
  a `theme.ts`/`tokens.*` file, design-token JSON, SCSS variables. Note dark-mode mechanism
  (class `dark`, `data-theme`, media query).
- **Icons & assets:** icon set (lucide, heroicons, react-icons, Material Icons), font setup
  (next/font, @fontsource, CDN), image pipeline.

### 3. Inventory the design system → write `.fe/design-system.md`
Extract the **actual values** from the token/theme source and component directories:
- **Colors:** the palette with names → values (e.g. `primary`, `secondary`, `accent`,
  `muted`, semantic `success`/`warning`/`destructive`, surfaces/borders), plus dark-mode
  variants. Capture the exact tokens, not approximations.
- **Typography:** font families, the type scale (sizes/weights/line-heights), heading styles.
- **Spacing & layout:** the spacing scale, container widths, breakpoints, grid.
- **Radii, shadows, borders, z-index, motion/transitions.**
- **Reusable components:** list the shared/primitive components (Button, Input, Card, Modal,
  Dropdown, …) with their location and the variants/props they expose — this is the reuse
  catalog future tasks consult before building anything new.
Write all of this to `.fe/design-system.md` from the template. For a large component library,
dispatch the read-only `ui-explorer` subagent to fan out and return the inventory.

### 4. Map the UI
Identify the top-level UI directories and their purpose, the route/page structure, the entry
point(s), where shared components vs. feature components live, and where global styles/theme
config live. For a large/unfamiliar repo, use the `ui-explorer` subagent rather than reading
everything in the main thread.

### 5. Learn the conventions
Inspect lint/format config (`.eslintrc` incl. `jsx-a11y`/`vue a11y`, `stylelint`, Prettier,
`tsconfig.json`), component file/naming conventions (PascalCase files, co-located styles/
tests, barrel files), import-alias setup, and recent commit messages (`git log --oneline -20`)
for commit style.

### 6. Establish a baseline
Run the documented install/build/lint/test commands **once** to confirm they work and record
pass/fail. Note how to run the app locally (and Storybook if present) — that's how later UI
changes get visually verified. If a command is slow or needs credentials you don't have, note
that instead of forcing it.

### 6b. Build the code graph (graphify)
Set up the project's **code knowledge graph** so future tasks can understand the component
tree and relationships (which components import which, where a token/style is used, how pages
compose) by querying a graph instead of brute-force reading/grepping — far fewer tokens. Run
the idempotent installer/builder:

```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/ensure-graphify.sh" .
```

This installs the `graphify` CLI if missing — via `ensure-tool.sh`, which bootstraps `uv` when
the machine has no `pip`/`pipx`/`uv` at all — then builds `graphify-out/graph.json` (code-only
AST extraction, no API key needed; understands TS/JS/Vue/Svelte and more), refreshes it on
re-runs (no LLM), and adds `graphify-out/` to `.gitignore`. It is **fail-soft**: if it can't
install or build, it prints the reason and you fall back to normal search. Note in your report
whether the graph is available.

Afterwards, **query it with a PATH prefix** (`$HOME/.local/bin` isn't on PATH and an `export`
doesn't survive between Bash calls — see rule 18):

```bash
PATH="$PATH:$HOME/.local/bin" graphify query "…"
```

(Optional: a backend key like `GEMINI_API_KEY` + `graphify extract .` — without
`--code-only --no-cluster` — yields richer cross-file semantic edges plus doc/image nodes.)

### 7. Write or update CLAUDE.md
- If none exists: create `CLAUDE.md` at the repo root from the template.
- If one exists: merge — update the `fe:begin/end` managed block, preserve everything the
  team wrote outside it. Don't clobber, don't duplicate.
Keep it concise and command-first; point to `.fe/design-system.md` for the visual language.

### 8. Enable autonomous mode
So the agent runs without permission prompts in this project (only the workflow's
proposal/report *questions* should stop it), write `.claude/settings.local.json` at the repo
root with bypass-permissions. Merge into the file if it already exists; don't discard other
keys:

```json
{
  "permissions": { "defaultMode": "bypassPermissions" }
}
```

This file is personal and git-ignored by Claude Code. The permission mode is read at session
start, so it takes effect in the **next** session in this project.

### 9. Initialize the decision & gotcha journal
If `.fe/notes.md` doesn't exist, create it as an empty journal the agent reads before each
task and updates after each decision/change (frontend rule 10):

```markdown
# Frontend Notes & Decisions

A running journal kept by the fe-agent: reusable frontend lessons not obvious from the code —
design decisions and rationale, framework/build gotchas, conventions discovered the hard way.
Read before acting; updated after each decision or change. Keep entries short and accurate.

## Decisions
<!-- YYYY-MM-DD — what was decided — why -->

## Gotchas
<!-- non-obvious facts: build setup, styling traps, framework quirks to avoid -->
```

Seed it with anything notable learned during onboarding (e.g. "dark mode toggles via the
`dark` class on `<html>`", "Tailwind is the only styling system — no inline hex allowed").

### 10. Report
Summarize for the user: detected framework + styling system + component library, where the
design tokens live, the build/run/test commands, baseline status (pass/fail per command), and
anything surprising. Confirm `.fe/design-system.md` was written and that autonomous mode is
enabled for next session. End by confirming the project is ready for `/fe:task`, `/fe:fix`,
and `/fe:audit`.

## Idempotency
Re-running onboarding must be safe: it refreshes the managed sections of `CLAUDE.md` and the
inventory in `.fe/design-system.md` to match the current state of the repo and never discards
human-authored content.
