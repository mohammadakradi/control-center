# CLAUDE.md Template (frontend)

Onboarding writes a project `CLAUDE.md` using this structure. Fill every section from what you
actually observed in the repo and from running the baseline commands. The detailed visual
language (tokens, colors, components) lives in `.fe/design-system.md` — link to it, don't
duplicate it here.

When a `CLAUDE.md` already exists, **merge** into it: update the managed sections below,
preserve anything the team wrote outside them, and don't duplicate. Wrap the sections this
plugin owns between the markers shown so future onboarding runs can update them cleanly.

---

```markdown
# <Project Name>

<!-- fe:begin (managed by fe-agent — safe to re-generate) -->

## Project overview
<2–3 lines: what this UI is and does, and its rendering model (SPA / SSR / SSG).>

## Frontend stack
- Framework: <React / Vue / Svelte / Angular + meta-framework (Next/Nuxt/…), version>
- Language: <TypeScript / JavaScript>
- Build tool: <Vite / Turbopack / webpack / …>
- Package manager: <npm / pnpm / yarn / bun>
- Styling: <Tailwind / CSS Modules / styled-components / …>
- Component library: <shadcn / MUI / bespoke `src/components/ui` / …>
- Routing & state: <router; state libs>
- Icons / fonts: <…>

## Design system
**Source of truth: `.fe/design-system.md`** — tokens (colors, typography, spacing, radii),
dark-mode mechanism, and the reusable-component catalog. Reuse tokens & components from there;
never hardcode values a token expresses.

## Build / run / test
> Commands below were run during onboarding; baseline status noted.
- Install: `<cmd>`
- Dev server: `<cmd>`  (URL: <http://localhost:PORT>)
- Build: `<cmd>`  (baseline: ✅ / ❌ / n/a)
- Lint (incl. a11y): `<cmd>`  (baseline: ✅ / ❌ / n/a)
- Test: `<cmd>`  (baseline: ✅ / ❌ / n/a)
- Storybook / visual: `<cmd>`  (if present)

## UI architecture map
- `<dir>/` — <purpose: pages/routes>
- `<dir>/` — <purpose: shared components>
- `<dir>/` — <purpose: feature components>
- Theme/global styles: `<file>`
- Tests live in: `<dir>`

## Code graph (graphify)
A queryable code knowledge graph lives at `graphify-out/graph.json`. To understand the
component tree or relationships (imports, where a token/style is used, how pages compose),
query it instead of brute-force reading/grepping (far fewer tokens):
- `graphify query "<question>"` · `graphify explain "<node>"` · `graphify path "<A>" "<B>"` ·
  `graphify affected "<component>"` (blast radius). Overview: `graphify-out/GRAPH_REPORT.md`.
- Refresh after structural changes: `graphify update .` (no LLM). Rebuild if missing:
  `graphify extract . --no-cluster`.

## Conventions
- Component style: <function components + hooks / SFC / …; file naming; co-location>
- Styling rules: <e.g. Tailwind only — no inline hex; tokens via theme>
- Accessibility: <target WCAG AA; lint plugin; focus/label conventions>
- Commit messages: <style observed>

## Agent operating rules
This project is worked on by the fe-agent (frontend specialist). For each request it follows
a workflow with two approval gates:
**investigate → plan & decompose 🚦(you approve) → build task-by-task (reuse + tokens + a11y, verify visually) → independent review (design + frontend audit) → report + test scenario 🚦(you approve) → commit**.
Pushing/opening a PR is separate (`/fe:ship`). Project-wide consistency sweeps: `/fe:audit`.

Core rules: 1. Onboard before acting. 2. Match the project's design language. 3. Reuse before
you build (no duplicate components; extract a shared base component when a raw pattern like
`<select>` repeats). 4. Use design tokens, never magic values. 4b. Prefer Tailwind + Lucide
for new styling, but match the project's existing system if it has one. 5. Standard,
accessible (WCAG AA), responsive by default. 6. Git is gated — commit only after you approve;
never the default branch (a hook enforces this). 7. Keep CLAUDE.md + `.fe/design-system.md`
current. 8. Ask only when genuinely blocked. 9. Be honest about scope/uncertainty. 10. Read/
update `.fe/notes.md`. 11. Plan & decompose every request. 12. Verify — build, lint, and look.
13. Two review lenses (`design-reviewer` + `frontend-auditor`). 14. Nutshell + `.fe/test-
scenarios/` doc. 15. Project-wide consistency via `/fe:audit`. 16. Long-horizon work runs on a
`.fe/epics/` plan. 17. Use the `graphify` code graph (`graphify-out/`) to understand structure/
relationships instead of brute-force search; refresh with `graphify update .` after structural
changes.

<!-- fe:end -->
```

---

Notes:
- Keep it concise — `CLAUDE.md` is loaded into context every session; bloat is a cost.
- Prefer exact, copy-pasteable commands over prose.
- The design detail belongs in `.fe/design-system.md`; this file just points to it.
