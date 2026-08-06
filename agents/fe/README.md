# fe — portable frontend-engineer agent

A Claude Code plugin that turns Claude into a **frontend specialist** for any UI project. It
onboards itself by scanning the framework, styling system, and design tokens; then builds,
restyles, audits, and ships frontend changes under a fixed set of rules that favor **component
reuse, design-token fidelity, accessibility, and theme consistency**.

It's the frontend sibling of the `swe` agent: same gated workflow, same model-smartness, same
independent-review discipline — but every lens is the user interface.

## What makes it a *frontend* engineer
- **Onboarding inventories the design system.** It writes `.fe/design-system.md` — the exact
  colors, typography, spacing, radii, breakpoints, and the reusable-component catalog — so
  every later task reuses what exists instead of drifting.
- **Reuse before build, tokens not magic values.** No duplicate buttons/cards; no hardcoded
  hex/spacing that a token already expresses (a blocking review finding).
- **Spots missing abstractions.** When the same raw element repeats (e.g. a bare `<select>`
  in several places), it proposes extracting a shareable base component — at the proposal
  gate, with the call sites it would replace.
- **Preferred stack: Tailwind CSS + Lucide.** New styling defaults to Tailwind utilities on
  the design tokens and Lucide for icons — while still matching a project's existing system
  (MUI, styled-components, a different icon set) rather than mixing two.
- **Standard, accessible, responsive by default.** Semantic HTML, WCAG AA, keyboard/focus,
  dark mode, breakpoints — verified, not assumed.
- **Two frontend review lenses** before any commit: a `design-reviewer` (design fidelity,
  reuse, a11y, responsiveness) and a `frontend-auditor` (XSS/secrets, correctness, perf).
- **Project-wide consistency** via `/fe:audit` — finds theme/color drift, duplication, and
  a11y gaps across the whole codebase, measured against the design-system inventory.

## Commands
- **`/fe:onboard`** — scan stack + styling + tokens; write `CLAUDE.md` and
  `.fe/design-system.md`; establish a build/run baseline. Safe to re-run.
- **`/fe:task <what>`** — build a feature/component or redesign/restyle a page, end-to-end
  through the gated workflow.
- **`/fe:fix <bug>`** — fix a visual/layout/state/interaction bug, end-to-end.
- **`/fe:audit [scope]`** — read-only project-wide consistency & a11y sweep → prioritized
  fix checklist.
- **`/fe:review [focus]`** — read-only review of the current diff for design fidelity, reuse,
  a11y, responsiveness, UI correctness.
- **`/fe:plan <goal>`** — decompose a large goal (full redesign, design-system migration,
  dark-mode rollout) into a persistent epic at `.fe/epics/<slug>.md`.
- **`/fe:ship [title]`** — branch, commit, push, open a PR; always returns the PR link.

## The workflow (every task & fix)
**investigate → plan & decompose 🚦(you approve) → build task-by-task (reuse + tokens + a11y,
verified visually) → independent review (design-reviewer + frontend-auditor) → report + test
scenario 🚦(you approve) → commit.** Pushing/PR is the separate `/fe:ship`. Two hard gates
stop for your approval; everything else runs autonomously.

## Model smartness
Command frontmatter pins the model: mechanical/read-only commands (`onboard`, `review`,
`audit`, `ship`) run on **Sonnet 5**. `plan`, `task` and `fix` are routed by complexity when
run via the platform — **Sonnet 5** for simple work, **Opus 5** for complex work, **Fable 5**
for very complex work (`plan` never routes below complex). Subagents run on Sonnet 5 to keep
token cost down.

## Files the agent maintains in your project
- `CLAUDE.md` — stack, commands, conventions, operating rules (managed `fe:begin/end` block).
- `.fe/design-system.md` — the canonical token + reusable-component inventory.
- `.fe/notes.md` — decision & gotcha journal, read before and updated after each task.
- `.fe/epics/<slug>.md` — persistent plans for multi-task goals.
- `.fe/test-scenarios/<slug>.md` — a manual test scenario (incl. responsive + a11y) per change.
- `.claude/settings.local.json` — enables autonomous mode (bypass permissions) for the project.
- `graphify-out/` — a queryable **code knowledge graph** (built by [graphify](https://github.com/safishamsi/graphify) during onboarding). The agent queries it (`graphify query/explain/path/affected`) to understand structure and relationships instead of brute-force search — fewer tokens. Generated/gitignored; refresh with `graphify update .`.

## Safety
A `PreToolUse` hook mechanically blocks committing or pushing to the default branch
(`main`/`master`) — fail-open so it never breaks normal operation. Git is only ever written
at the approved commit step or via `/fe:ship`.

## Install (local marketplace)
This plugin is published from a local directory marketplace (`fe-agent-local`). Add the
marketplace and install `fe`, then run `/fe:onboard` in any UI project.
