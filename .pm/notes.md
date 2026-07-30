# Project Planning Notes

Durable planning context kept by the pm-agent: product decisions and rationale,
constraints, and recurring stack conventions. Read before planning; update after each
planning decision. Keep entries short and accurate.

## Decisions
<!-- YYYY-MM-DD — what was decided — why -->
- 2026-07-29 — onboarded pm-agent for planning; graphify code graph unavailable in this
  environment (no uv/pipx/pip to install it) — planning will rely on CLAUDE.md's UI
  architecture map plus direct file search until graphify can be installed.
- 2026-07-29 — graphify is now installed (`~/.local/bin`, `PATH` prefix per call) and
  `graphify-out/graph.json` exists — the fallback above no longer applies.
- 2026-07-29 — planned auth + per-user Anthropic tokens
  (`.pm/tasks/20260729-155024-auth-and-per-user-tokens/`, 6 tasks). Approved decisions:
  self-hosted credentials auth (users + session cookie, no external auth service);
  per-user token in an encrypted store OUTSIDE the DB (`data/secrets/`, AES-256-GCM,
  master key from env), write-only API, injected per task via SDK `Options.env` (replaces
  `process.env` — must spread); runner (:4319) locked behind session-checked Next proxy
  routes (browser currently hits it directly with open CORS); projects/agents stay
  shared, `tasks.userId` scopes billing/attribution only; per-task usage extracted from
  SDK `result` messages already persisted in `taskEvents`; subscription limits via the
  SDK's experimental `get_usage` API — best-effort, hidden when unavailable (API keys).

## Constraints & conventions
<!-- stacks present, who owns what, non-obvious rules to respect when planning -->
- Single stack: full-stack Next.js 16 App Router (App Router pages/API in `app/`) + a
  companion Hono runner process (`runner/`) for task execution. No separate backend repo.
- Frontend work here is owned by the fe-agent, which runs its own gated workflow
  (investigate → plan → build → review → report → commit) and keeps `.fe/design-system.md`,
  `.fe/notes.md`, `.fe/epics/`, `.fe/test-scenarios/` current. Plans that touch UI should
  hand off tasks compatible with that workflow.
- Non-standard Next.js version (16.2.9) — implementation must read
  `node_modules/next/dist/docs/` before coding; don't assume mainline Next.js APIs/conventions.
- Styling is Tailwind v4 CSS-first (no tailwind.config), semantic tokens only
  (`bg-surface`, `text-fg-subtle`, etc.) — never raw palette shades or `dark:` variants.
  Source of truth: `.fe/design-system.md`.
- Package manager: pnpm. Dev runs via Docker Compose (`infra/docker/docker-compose.yml`,
  web :3001 + runner :4319) or natively via `pnpm dev:local`.
- DB: Drizzle ORM + better-sqlite3 (`lib/db/`, migrations via `pnpm db:push`).
- No test suite exists in the repo — plans should account for verification via
  build/lint/manual check rather than assuming automated test coverage.
- Code graph (`graphify-out/`) is installed and built — query it with the
  `PATH="$PATH:$HOME/.local/bin"` prefix per call (see CLAUDE.md). Note: broad queries
  truncate at ~2000 tokens; narrow the query or raise `--budget`.
