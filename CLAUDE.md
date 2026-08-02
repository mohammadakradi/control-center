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
> Commands run during onboarding; baseline status noted.
- Install: `pnpm install`
- Dev server: `pnpm dev`  (Docker: builds the image + runs web :3001 + runner :4319 in one
  container via `infra/docker/docker-compose.yml`; URL: http://localhost:3001)
- Stop the container: `pnpm stop`  ·  reset volumes after a dep change: `pnpm dev:clean`
- Native dev (no Docker): `pnpm dev:local`  (Next.js + runner directly on the host)
- Next.js only: `pnpm dev:web`  ·  Runner only: `pnpm dev:runner`
- Container-only entrypoint: `pnpm dev:container`  (= `dev:local` but binds Next to `0.0.0.0`)
- Build: `pnpm build`  (baseline: ❌ **pre-existing failure**, unrelated to app code —
  compiles and typechecks fine, then dies prerendering Next's own `/_global-error` page with
  `TypeError: Cannot read properties of null (reading 'useContext')`. Confirmed 2026-07-31 to
  reproduce on a clean tree with no uncommitted work, so don't treat it as a regression from
  your change. The honest gate is `pnpm test` + `pnpm lint` + `npx tsc --noEmit`.)
- Lint: `pnpm lint`  (baseline: ✅ — no warnings)
- Test: `pnpm test`  (baseline: ✅ 29 tests — Node's built-in runner via `tsx`, no extra
  deps; specs live next to the code as `runner/*.test.ts`, fixtures in
  `runner/__fixtures__/`. The DB spec builds a throwaway SQLite file from the real schema
  via `drizzle-kit push` and the `PLATFORM_DB` override — never `data/platform.db`.)
- Typecheck: `npx tsc --noEmit`
- DB migration: `pnpm db:push`  — **check what it plans first:** it has rebuilt the `tasks`
  table (`__new_tasks` + copy + drop) rather than adding columns, which historically dropped
  the `user_id` foreign key. Back up the DB (`VACUUM INTO`) before running it.
- Backfills (idempotent, safe to re-run): `pnpm db:backfill-titles` ·
  `pnpm db:backfill-usage` (`--dry-run` / `--all`; recomputes token+cost totals from the
  `result` messages already stored in `task_events` — no model calls, nothing billed)

### Docker dev notes
- The app is host-coupled (drives Claude against absolute host project paths, reuses
  `~/.claude`), so the container bind-mounts `~/.claude` → `/home/node/.claude`, `~/Dev` (at
  the same absolute path — managed projects must live under it), `~/.gitconfig`, and the repo
  source. `node_modules` and `.next` are masked by named volumes so the Linux-built
  `better-sqlite3` isn't shadowed by the host's macOS build — **never** bind-mount host
  `node_modules` into the container. After a dependency change, `pnpm dev:clean` drops those
  volumes so they re-seed from the rebuilt image.
- **Claude auth is per user:** each signed-in user saves their own Anthropic token
  (subscription token from `claude setup-token`, or an API key) under **Settings** in the
  UI; it's encrypted (AES-256-GCM) into `data/secrets/<userId>.json` under the required
  `SECRETS_MASTER_KEY` from the repo-root `.env` (see `.env.example`). Tokens are verified
  against Anthropic before being stored, so a bad paste fails in the form. The runner
  injects the task owner's token into every SDK session via `Options.env`; a user with no
  token is told up front (banner + a 412 on dispatch) rather than getting a failed task.
  The legacy shared `CLAUDE_CODE_OAUTH_TOKEN` / `ANTHROPIC_API_KEY` in `.env` are honored
  only with `ALLOW_SHARED_TOKEN_FALLBACK=1` (dev-only). Note: the bind-mounted `~/.claude`
  doesn't carry a usable login on macOS anyway (host login lives in the Keychain).
  - **There is no "Sign in with Anthropic" button and there can't be** — Anthropic does
    not allow third-party apps to offer claude.ai login (Agent SDK docs), and
    `claude setup-token` requires a real TTY so it can't be driven server-side. Only the
    API-key route links out to Anthropic. See `.swe/notes.md` before revisiting this.
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
- `app/tasks/[id]/` — Task live view (SSE + gate actions via the authenticated
  `/api/tasks/[id]/{stream,respond,reply,stop}` proxy routes — the browser never talks
  to the runner directly)
- `app/settings/` — Per-user settings (Anthropic token vault card)
- `app/usage/` — Per-user usage page: spend summary + Claude plan-limit bars. A top-level
  nav entry, not a Settings sub-section (moved out of Settings 2026-08-02)
- `app/api/` — API routes (projects, tasks, agents, git, fs, diff, file, settings/token)
- `components/` — All reusable UI components (bespoke)
- `components/ui-cards.tsx` — Core primitives: `card`, `CardSection`, `PageHeader`,
  `EmptyState`, `Chip`, `Tile`, `Fact`
- `components/ui/` — Base primitives: `button.tsx`, `modal.tsx`, `select.tsx`
- `components/Sidebar.tsx` — Desktop primary nav (collapsible rail, `md+`)
- `components/MobileNav.tsx` — Mobile top bar + bottom tab bar (`< md`)
- `components/ThemeToggle.tsx` — Light/dark/system control (segmented + icon variants)
- `lib/` — Shared logic: db (Drizzle + SQLite), discovery, git, ui utils
- `lib/theme.ts` / `lib/sidebar.ts` — Pre-paint init scripts + external stores for the
  theme and sidebar state (both persisted in `localStorage`, applied to `<html>`)
- `lib/secrets.ts` — Encrypted per-user Anthropic token vault (`data/secrets/`, master
  key from `SECRETS_MASTER_KEY`; write-only API, tokens never leave the server)
- `runner/` — Hono task-execution server (separate from Next.js; loopback-only, no CORS —
  reached exclusively through the Next.js proxy routes; `runner/user-env.ts` builds each
  task's subprocess env with the owner's token)
- `app/api/usage/` — Per-user usage: real spend from `lib/usage-summary.ts` plus a
  best-effort Claude plan-limits block. **Plan limits are normally `available: false`** —
  the SDK only reports them for a logged-in profile, and this app injects tokens via
  `Options.env`; see `runner/usage-snapshot.ts`
- `lib/usage-summary.ts` — Per-user spend aggregated from `tasks.usage*`, scoped to the
  caller (transcripts are shared; spend isn't), plus an `unattributed` bucket for tasks
  predating `tasks.userId`
- `runner/usage-snapshot.ts` — Best-effort plan-limit probe under the user's token. Spawns a
  short-lived session (~1.7s, no model call, nothing billed), caches per user, and degrades
  to `available: false` on any surprise — the SDK method behind it is experimental and will
  be renamed
- `runner/usage.ts` — Token/cost accounting from SDK `result` messages. Those counters are
  cumulative **per subprocess** and restart on a continue/resume, so usage is accumulated
  as deltas onto `tasks.usage*`; shared by the live runner and `runner/backfill-usage.ts`
- `public/` — Agent avatar images (`<namespace>-agent.png`)
- Theme tokens/global styles: `app/globals.css`
- Tests: `runner/*.test.ts` (`pnpm test`)

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
