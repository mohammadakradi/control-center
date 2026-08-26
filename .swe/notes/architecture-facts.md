# architecture facts

Load-bearing architecture facts — the short list worth knowing before changing anything.

<!-- Split out of a single 232 KB `.swe/notes.md` on 2026-08-24, which was read in full at the start of every request (engineering rule 10). Entries are verbatim and in date order; only this header is new. -->

## Architecture facts (load-bearing)
- The app is **host-coupled by design**. The runner (`runner/session-manager.ts`) drives the
  Claude Agent SDK with `cwd: project.path` against **absolute host paths** stored in the DB
  (`projects.path`, e.g. `/Users/moh/Dev/...`). It also reuses the host `~/.claude` login +
  plugins via `settingSources: ["user","project","local"]`. The Claude CLI is **bundled in
  `@anthropic-ai/claude-agent-sdk`** — no separate install needed.
- DB is file-based SQLite (`data/platform.db`, WAL) via better-sqlite3 (a **native** module).
  Web app + runner share the same DB file and run with `cwd = repo root`.
- Runner binds all interfaces via `@hono/node-server` `serve()` (port `RUNNER_PORT`, default
  4319). The browser hits the runner **directly** at `PUBLIC_RUNNER_URL`
  (`NEXT_PUBLIC_RUNNER_URL`, default `http://localhost:4319`).
