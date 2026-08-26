@AGENTS.md

<!-- fe:begin (managed by fe-agent — safe to re-generate) -->

## Project overview
Agent Platform is a control-center web UI for managing AI agents, projects, and tasks. It is
a full-stack Next.js 16 App Router app running in SSR mode (`force-dynamic`), with a
companion Hono runner process for task execution. The UI supports light/dark/system themes
and presents agent activity in real time via SSE.

## Frontend stack
- Framework: Next.js 16.2.9 (App Router) — **non-standard version; read `node_modules/next/dist/docs/` before coding**
- Language: TypeScript 5, strict mode
- Build tool: Next.js built-in (Turbopack/PostCSS)
- Package manager: pnpm
- Styling: Tailwind CSS v4 (CSS-first, no config file — `@theme` in `app/globals.css`)
- Theming: **light / dark / system**, default system. Semantic CSS-variable token layer in
  `app/globals.css` (`:root` = light, `.dark` = dark); blocking init scripts in `<head>` apply
  the theme + sidebar width before first paint
- Component library: Bespoke (`components/`) — no shadcn/Radix/MUI
- Routing & state: App Router; no external state library; `usePathname` for active nav;
  `useSyncExternalStore` for theme/sidebar state read off `<html>`
- Icons: lucide-react `^1.21.0`
- Fonts: Geist Sans + Geist Mono via `next/font/google`

## Design system
**Source of truth: `.fe/design-system.md`** — tokens (colors, typography, spacing, radii),
the light/dark mechanism, and the reusable-component catalog. Reuse tokens & components from
there; never hardcode values a token already expresses. **Components must use the semantic
utilities (`bg-surface`, `text-fg-subtle`, `border-line`, `text-ok`, …), never raw palette
shades like `neutral-800` or `sky-400`, and never `dark:` variants.**

## Build / run / test
Full reference, with the reasoning behind each gotcha: **`.swe/notes/build-and-environment.md`**.

- Install: `pnpm install`
- **Run it like an app: `pnpm app`** — brings the stack up detached and opens the dashboard in a
  Chrome app window. Stop with `pnpm stop`.
- Dev server: `pnpm dev` (Docker; web :3001, runner :4319 — http://localhost:3001) ·
  `pnpm dev:local` native · `pnpm dev:clean` after a dependency change
- Build: `pnpm build` · Lint: `pnpm lint` · Typecheck: `npx tsc --noEmit`
- Test: `pnpm test` — **run it in the container with `RUNNER_HOST` unset**:
  `docker exec platform env -u RUNNER_HOST pnpm test`. Baseline ✅ 692 tests. On the host it dies
  with an esbuild platform error: `node_modules` is the container's Linux build.
- Schema changes: `pnpm db:generate` then `pnpm db:migrate` — **review the generated SQL** and
  commit it with the schema change. `pnpm db:push` is dev-only and is not the migration path.
- Backfills: `pnpm db:backfill-titles` · `pnpm db:backfill-usage`
- Refresh the vendored agents: `pnpm agents:sync` (edit `../{swe,fe,pm}-agent`, never `agents/`)
- Release tarball: `pnpm release:pack` → `dist/` · Regenerate icons: `pnpm icons` (macOS only)

Three traps worth knowing before you touch the dev loop, all detailed in the note:
- **Nothing GUI-bound works inside the container** — no `osascript`, Finder or `open`.
- **A new route directory is not hot-reloaded** — adding `app/api/<new>/route.ts` 404s until the
  dev server restarts. Same for compose env changes (`pnpm stop && pnpm dev`).
- **Claude auth is per user**, saved in the UI under Settings and encrypted under
  `SECRETS_MASTER_KEY`. There is no "Sign in with Anthropic" button and there can't be.

## Sign-in, workspaces, and who owns what
Signing in is **optional**. Opening the app with no session makes you the *local workspace*
(`user_local`, seeded by `drizzle/0001_local_workspace.sql` with a password hash that can never
match). Creating an account starts a private workspace instead of unlocking the app.
- **`lib/task-access.ts` is the only thing separating owners.** `proxy.ts` no longer gates
  anything, so every task read goes through `ownedBy` (lists) or `findOwnedTask` (one row).
  Both treat "not yours" and "doesn't exist" identically so callers can only 404 — probing ids
  must not reveal that someone else's task exists. If you add a task query, scope it here.
- **Projects, agents and backlogs are deliberately shared**: a project is a folder on the device,
  an agent is an installed plugin, and a backlog is a description of that folder's planned work.
  Tasks, transcripts and Anthropic tokens are the private part.
- `getCurrentUser()` never returns null now (it falls back to the local workspace);
  `getSignedInUser()` is the one that can, for UI that must tell the two apart.
- **This is app-level separation, not OS-level.** Anyone with filesystem access can read
  `~/.control-center/.env` and the vault. Separate macOS accounts get separate installs and are
  genuinely isolated; two people sharing one login are not.

## Where the detail lives (`.swe/notes/`)
This file is an **orientation map under a 20 KB budget** (engineering rule 7): it is auto-loaded
into every session, so every kilobyte is re-sent on every model call. The long-form reasoning —
why a thing is built the way it is, what was tried and rejected, which holes are knowingly open —
lives in the journal. Read the topic you need, not the whole directory.

| Topic | What is in it |
|---|---|
| [`features.md`](.swe/notes/features.md) | The `features` entity, branch naming, the merge-back lifecycle in the runner, managing groups, the grouped UI |
| [`backlog.md`](.swe/notes/backlog.md) | The `.pm/tasks/` spec sync, status precedence, the caps, agent-filed items and their nonce fence, parallel runs |
| [`file-reads-and-git.md`](.swe/notes/file-reads-and-git.md) | `lib/safe-read.ts` containment, every `lib/git.ts` hardening decision, and **two CRITICAL holes reproduced and knowingly left open** |
| [`releases-and-data.md`](.swe/notes/releases-and-data.md) | The release workflow, `install.sh`, the update lock, export/import, Settings → Data |
| [`task-runs.md`](.swe/notes/task-runs.md) | A task's Changes card, turn-end classification, the report card's fix-task offer, skills + attachments |
| [`architecture-map.md`](.swe/notes/architecture-map.md) | The full annotated directory map |
| [`build-and-environment.md`](.swe/notes/build-and-environment.md) | Every command, the Docker dev notes, the container hop, per-user Claude auth |
| [`mac-app-and-pwa.md`](.swe/notes/mac-app-and-pwa.md) | The native bundle, the Swift/launcher split, the rename, the PWA |
| [`search.md`](.swe/notes/search.md) | `lib/search.ts` — owner-scoping asymmetry, `LIKE` escaping, bounds |
| [`agents-bundling.md`](.swe/notes/agents-bundling.md) | Why the plugins are vendored and how discovery prefers a CLI copy |
| [`cost-and-context.md`](.swe/notes/cost-and-context.md) | Why these budgets exist: the measured token spend, and the per-task run caps |

Older dated entries (decisions, gotchas) are in `.swe/notes/decisions.md` and
`.swe/notes/gotchas.md`. `grep -ril '<term>' .swe/notes/` finds a note by keyword.

## UI architecture map
Full annotated map, with the reasoning attached to each entry:
**`.swe/notes/architecture-map.md`**.

- `agents/` — the vendored swe/fe/pm plugins, shipped in the release tarball. Read by
  `lib/discovery/agents.ts`, never imported as code. **Edit the source checkouts, then
  `pnpm agents:sync`.**
- `app/` — Next.js App Router pages and API routes (dashboard, agents, projects,
  `tasks/[id]`, settings, usage, and everything under `app/api/`)
- `components/` — all reusable UI, bespoke. `ui-cards.tsx` holds the core primitives
  (`card`, `CardSection`, `PageHeader`, `EmptyState`, `Chip`, `Tile`, `Fact`); `ui/` holds
  `button`/`modal`/`select`
- `lib/` — shared logic with the rules in it. The load-bearing modules:
  `task-access.ts` (the only thing separating owners), `dispatch.ts` (creating + starting a
  task, and `parallelOffer`), `features.ts`, `backlog.ts`, `safe-read.ts`, `git.ts`,
  `task-root.ts`, `search.ts`, `secrets.ts`, `config.ts` (incl. the per-task run caps),
  `ui.ts` + `update-ui.ts` (DOM-free UI logic, kept out of `components/` so `pnpm test` can
  reach it), `db/` (Drizzle + SQLite, `db/migrate.ts`)
- `runner/` — the Hono task-execution server, separate from Next.js and loopback-only.
  `session-manager.ts` drives a run, `model-router.ts` picks the model, `platform-mcp.ts` is
  the in-process MCP server every session gets, `worktree.ts` + `merge-sweep.ts` own the git
  mechanics, `usage.ts` the accounting
- `drizzle/` — versioned migration SQL + journal. **Ships in the release tarball.**
- `infra/` — `docker/`, `release/` (pack.sh, control-center.sh, make-app-bundle.sh),
  `native/` (the Swift app), `icons/`, `agents/`, `dev/`, `launch/`
- `public/` — agent avatars · Theme tokens and global styles: `app/globals.css`
- Tests live next to the code: `runner/*.test.ts`, `lib/*.test.ts`,
  `lib/discovery/*.test.ts`, `infra/release/*.test.ts`. **A spec in a directory the `test`
  script doesn't list silently never runs.**

## Code graph (graphify)
A queryable code knowledge graph lives at `graphify-out/graph.json`. To understand the
component tree or relationships (imports, where a token/style is used, how pages compose),
query it instead of brute-force reading/grepping (far fewer tokens):
- `graphify query "<question>"` · `graphify explain "<node>"` · `graphify path "<A>" "<B>"` ·
  `graphify affected "<component>"` (blast radius). Overview: `graphify-out/GRAPH_REPORT.md`.
- Refresh after structural changes: `graphify update .` (no LLM). Rebuild if missing:
  `graphify extract . --no-cluster`.
- **Caveat (found 2026-08-04):** a no-LLM `graphify update .` re-extracts structure but strips
  `community_name` from every node — the human-readable cluster names `query`/`explain` lean on.
  It backs the curated graph up to `graphify-out/<date>/` first. Either set `GEMINI_API_KEY`
  before refreshing, or accept a slightly stale graph rather than committing a de-named one.

## Conventions
- Component style: function components + hooks; `"use client"` only when needed; server components by default
- File naming: PascalCase for components (`TaskLiveView.tsx`), kebab for routes (`[id]/page.tsx`)
- Styling: Tailwind utility classes only — no inline hex, no CSS modules, no styled-components
- Token use: Tailwind semantic palette (neutral/emerald/red/amber/sky/violet); no custom tokens beyond `@theme` font vars
- Accessibility: WCAG AA aspiration; no formal a11y lint plugin configured; keyboard nav not verified
- Commit messages: conventional style (observed from git log)

## Agent operating rules
This project is worked on by the fe-agent (frontend specialist). For each request it follows
a workflow with two approval gates:
**investigate → plan & decompose 🚦(you approve) → build task-by-task (reuse + tokens + a11y, verify visually) → independent review (design + frontend audit) → report + test scenario 🚦(you approve) → commit**.
Pushing/opening a PR is separate (`/fe:ship`). Project-wide consistency sweeps: `/fe:audit`.

Core rules: 1. Onboard before acting. 2. Match the project's design language. 3. Reuse before
you build (no duplicate components; extract a shared base component when a raw pattern
repeats). 4. Use design tokens, never magic values. 4b. Prefer Tailwind + Lucide for new
styling, but match the project's existing system if it has one. 5. Standard, accessible
(WCAG AA), responsive by default. 6. Git is gated — commit only after you approve; never the
default branch. 7. Keep CLAUDE.md + `.fe/design-system.md` current. 8. Ask only when
genuinely blocked. 9. Be honest about scope/uncertainty. 10. Read/update `.fe/notes.md`.
11. Plan & decompose every request. 12. Verify — build, lint, and look. 13. Two review
lenses (`design-reviewer` + `frontend-auditor`). 14. Nutshell + `.fe/test-scenarios/` doc.
15. Project-wide consistency via `/fe:audit`. 16. Long-horizon work runs on a `.fe/epics/`
plan. 17. Use the `graphify` code graph (`graphify-out/`) to understand structure/
relationships instead of brute-force search; refresh with `graphify update .` after structural
changes.

<!-- fe:end -->
