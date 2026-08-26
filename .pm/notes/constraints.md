# constraints

Stacks present, who owns what, and the non-obvious rules to respect when planning.

<!-- Split out of a single 12 KB `.pm/notes.md` on 2026-08-24, which exceeded the 8 KB index budget (pm rule 9). Entries are verbatim; only this header is new. -->

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
