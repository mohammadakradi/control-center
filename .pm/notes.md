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
- 2026-08-02 — planned moving Usage out of Settings into its own "Usage" nav item
  (`.pm/tasks/20260802-083437-usage-own-menu/`, 1 frontend task). Verdict: PARTIAL — the
  nav/page move is a real gap (BUILD); the requested percent-used plot (like Claude's own
  usage-limits screenshot) already exists as `components/PlanLimits.tsx`'s `WindowBar()` and
  just needs to move with the page, not be rebuilt — it usually renders nothing because plan
  limits report unavailable for this app's env-injected tokens, a known prior limitation, not
  a gap to fix.
- 2026-08-11 — planned title-first task lists, Tasks menu, per-project Backlog, and a
  running-tasks activity badge (`.pm/tasks/20260811-113836-tasks-backlog-activity/`,
  6 tasks). Verdict PARTIAL: `tasks.title` + project-detail display already existed; only
  Dashboard/agent-detail lists showed raw request text. User-approved direction: extract ONE
  shared task-list component (modeled on `components/TaskHistory.tsx`) instead of patching
  each list. Backlog decisions: DB table `backlog_items` (shared per project, like projects
  themselves), fed by (1) idempotent sync of `.pm/tasks/` spec files keyed by `sourcePath` —
  deliberately NO pm-agent changes, (2) an `add_backlog_item` MCP tool on the runner's
  existing in-process `swe-platform` server, (3) manual UI add; run-from-backlog reuses the
  `FileModal.createTask` dispatch shape and stores `linkedTaskId`.
- 2026-08-12 — planned a fix for `control-center update`/`install.sh` failing mid-build with
  `SqliteError: database is locked` (`.pm/tasks/20260812-191427-fix-update-build-sqlite-lock/`,
  3 tasks). Root cause: `lib/db/index.ts` opens SQLite at module load with no `busy_timeout`;
  ~33 files import `lib/db`, and Next's "Collecting page data" build phase evaluates them
  across parallel workers that race to create/WAL-convert the same brand-new file in the temp
  build dir both `install.sh` and `apply_update()` (`control-center.sh`) use. Fix: add a
  busy_timeout pragma. Also confirmed two developer-reported hardening gaps in the same
  pipeline: (1) Turbopack auto-infers its project root from the nearest ancestor lockfile, and
  these builds run deep under `$HOME` — a stray lockfile there could silently mis-trace the
  build; fix is pinning `turbopack.root` in `next.config.ts`. (2) `running()`/`status` in
  `control-center.sh` only checks the `web` pid, never `runner` — can misreport a live runner
  as stopped and let `cmd_start` double-spawn. Explicitly did **not** adopt the suggestion to
  have the installer stop a running instance before building: `apply_update()`'s build writes
  to a temp-dir database distinct from the production one, so stopping first wouldn't fix this
  bug and would regress the deliberate build-before-swap (fail-safe, zero-downtime) ordering —
  flagged this reasoning back to the user rather than applying it as-is.

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
- A test suite now exists: `pnpm test` (Node's built-in runner via `tsx`, 29 tests as of
  2026-08-02), specs live next to code as `runner/*.test.ts`. Backend/runner tasks should
  account for it; there's still no frontend test runner.
- Code graph (`graphify-out/`) is installed and built — query it with the
  `PATH="$PATH:$HOME/.local/bin"` prefix per call (see CLAUDE.md). Note: broad queries
  truncate at ~2000 tokens; narrow the query or raise `--budget`.
