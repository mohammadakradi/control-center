@AGENTS.md

<!-- fe:begin (managed by fe-agent — safe to re-generate) -->

## Project overview
Agent Platform is a control-center web UI for managing AI agents, projects, and tasks. It is
a full-stack Next.js 16 App Router app running in SSR mode (`force-dynamic`), with a
companion Hono runner process for task execution. The UI is dark-only and presents agent
activity in real time via SSE.

## Frontend stack
- Framework: Next.js 16.2.9 (App Router) — **non-standard version; read `node_modules/next/dist/docs/` before coding**
- Language: TypeScript 5, strict mode
- Build tool: Next.js built-in (Turbopack/PostCSS)
- Package manager: pnpm
- Styling: Tailwind CSS v4 (CSS-first, no config file — `@theme` in `app/globals.css`)
- Component library: Bespoke (`components/`) — no shadcn/Radix/MUI
- Routing & state: App Router; no external state library; `usePathname` for active nav
- Icons: lucide-react `^1.21.0`
- Fonts: Geist Sans + Geist Mono via `next/font/google`

## Design system
**Source of truth: `.fe/design-system.md`** — tokens (colors, typography, spacing, radii),
dark-mode mechanism, and the reusable-component catalog. Reuse tokens & components from
there; never hardcode values a token already expresses.

## Build / run / test
> Commands run during onboarding; baseline status noted.
- Install: `pnpm install`
- Dev server: `pnpm dev`  (Docker: builds the image + runs web :3000 + runner :4319 in one
  container via `infra/docker/docker-compose.yml`; URL: http://localhost:3000)
- Stop the container: `pnpm stop`  ·  reset volumes after a dep change: `pnpm dev:clean`
- Native dev (no Docker): `pnpm dev:local`  (Next.js + runner directly on the host)
- Next.js only: `pnpm dev:web`  ·  Runner only: `pnpm dev:runner`
- Container-only entrypoint: `pnpm dev:container`  (= `dev:local` but binds Next to `0.0.0.0`)
- Build: `pnpm build`  (baseline: ✅)
- Lint: `pnpm lint`  (baseline: ✅ — no warnings)
- Test: n/a — no test suite exists
- DB migration: `pnpm db:push`

### Docker dev notes
- The app is host-coupled (drives Claude against absolute host project paths, reuses
  `~/.claude`), so the container bind-mounts `~/.claude` → `/home/node/.claude`, `~/Dev` (at
  the same absolute path — managed projects must live under it), `~/.gitconfig`, and the repo
  source. `node_modules` and `.next` are masked by named volumes so the Linux-built
  `better-sqlite3` isn't shadowed by the host's macOS build — **never** bind-mount host
  `node_modules` into the container. After a dependency change, `pnpm dev:clean` drops those
  volumes so they re-seed from the rebuilt image.
- **Auth:** the bind-mounted `~/.claude` does *not* carry a usable login on macOS — the
  host login lives in the Keychain, not in `~/.claude/.credentials.json`, so the runner's
  spawned Claude reports "Not logged in" inside the container. Provide credentials via a
  repo-root `.env` (see `.env.example`): preferred is `CLAUDE_CODE_OAUTH_TOKEN` from
  `claude setup-token` (subscription, long-lived); or `ANTHROPIC_API_KEY` for API billing.
- **Git/GitHub:** the image installs `gh` so agents can open PRs (`/swe:ship`, `/fe:ship`)
  and the UI's push/pull work. macOS keychain/SSH creds don't cross into Linux, so set
  `GH_TOKEN` in `.env` (see `.env.example`): `gh` uses it for PRs, and `git` push/pull over
  HTTPS to github.com authenticate through gh's credential helper, wired via `GIT_CONFIG_*`
  env in compose (so nothing writes to the read-only bind-mounted `~/.gitconfig`, and the
  host's macOS `osxkeychain` helper is cleared). SSH remotes need the optional `~/.ssh` mount
  (commented in compose) — or switch the remote to HTTPS and use `GH_TOKEN`.
- The container runs as the non-root `node` user (UID 1000, `HOME=/home/node`); published
  ports bind to `127.0.0.1` only.
- Files: `Dockerfile` (multi-stage dev image), `infra/docker/docker-compose.yml`,
  `.dockerignore`.

## UI architecture map
- `app/` — Next.js App Router pages and API routes
- `app/page.tsx` — Dashboard (agent list, project list, recent tasks)
- `app/agents/` — Agent list + detail pages
- `app/projects/` — Project list + detail pages
- `app/tasks/[id]/` — Task live view
- `app/api/` — API routes (projects, tasks, agents, git, fs, diff, file)
- `components/` — All reusable UI components (bespoke)
- `components/ui-cards.tsx` — Core primitives: `card`, `Chip`, `Tile`, `Fact`
- `lib/` — Shared logic: db (Drizzle + SQLite), discovery, git, ui utils
- `runner/` — Hono task-execution server (separate from Next.js)
- `public/` — Agent avatar images (`<namespace>-agent.png`)
- Theme/global styles: `app/globals.css`
- Tests: none

## Code graph (graphify)
A queryable code knowledge graph lives at `graphify-out/graph.json`. To understand the
component tree or relationships (imports, where a token/style is used, how pages compose),
query it instead of brute-force reading/grepping (far fewer tokens):
- `graphify query "<question>"` · `graphify explain "<node>"` · `graphify path "<A>" "<B>"` ·
  `graphify affected "<component>"` (blast radius). Overview: `graphify-out/GRAPH_REPORT.md`.
- Refresh after structural changes: `graphify update .` (no LLM). Rebuild if missing:
  `graphify extract . --no-cluster`.

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
