# Control Center

A local dashboard to manage your Claude Code agents (plugins), see which projects each is
connected to, and dispatch tasks — watching the agent work live and approving its proposal
and commit from the browser.

Runs entirely on your machine: a Next.js dashboard plus a small runner daemon that drives
the [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk) in each project's folder.

## Run it

```bash
pnpm install
pnpm db:push        # create the SQLite schema (first run only)
pnpm dev            # starts the dashboard (:3000) + runner daemon (:4319)
```

Open http://localhost:3000.

Auth: the runner reuses your existing Claude Code login (`~/.claude`) — nothing to
configure. (Set `ANTHROPIC_API_KEY` only if you'd rather bill an API key.)

## Use it

1. **Agents** are auto-discovered from your installed Claude Code plugins.
2. **Projects** → add a local folder by absolute path.
3. Open a project → **New task** → pick an agent + command (e.g. `/swe:onboard`, then
   `/swe:task <request>`) → **Run task**.
4. On the live task page you watch the transcript stream. At each gate the agent presents a
   **proposal** and a **change report** — approve, approve-with-changes (add feedback), or
   reject. After you approve the report it commits on a branch.

## Architecture

```
Browser ──HTTP──▶ Next.js app (:3000)  ──shared SQLite──▶  Runner daemon (:4319)
   └─────────── SSE stream + approvals ──────────────────────────┘
```

- **Next.js app** — UI, CRUD API routes, plugin/project auto-discovery, SQLite (Drizzle).
- **Runner daemon** (`runner/`) — holds live Agent SDK sessions in memory (streaming-input
  mode), streams output over SSE, and feeds your approvals back into the live session. The
  agent's gates are surfaced through a blocking `request_approval` MCP tool.
- The plugin is loaded with `plugins: [{ type: "local", path }]`, `settingSources` and
  `permissionMode: "bypassPermissions"` so the agent runs autonomously in the project.

| Path | Purpose |
|------|---------|
| `app/` | Dashboard pages + `app/api/*` CRUD routes |
| `components/` | UI + the live `TaskLiveView` (SSE + gate cards) |
| `lib/db/` | Drizzle schema + SQLite client |
| `lib/discovery/` | Agents (from installed plugins) + project scanning |
| `runner/` | Daemon: `server.ts`, `session-manager.ts`, `approval-tool.ts`, `gate-prompt.ts` |

## Known limitations (MVP)

- **Daemon restart ends live tasks.** In-memory sessions don't survive a daemon restart;
  orphaned tasks are marked `failed` on startup. The SDK `session_id` is persisted, so
  resume-by-session-id is a future enhancement.
- **Single user, local only.** No auth; binds to localhost.
- **Gate reliability** depends on the agent calling `request_approval` (a marker-based
  fallback covers prose gates).
