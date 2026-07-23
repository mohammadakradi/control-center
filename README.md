# Control Center

A local dashboard to manage your Claude Code agents (plugins), see which projects each is
connected to, and dispatch tasks — watching the agent work live and approving its proposal
and commit from the browser.

Runs entirely on your machine: a Next.js dashboard plus a small runner daemon that drives
the [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk) in each project's folder.

## Run it

`pnpm dev` runs the whole app inside a Docker container (dashboard :3001 + runner
daemon :4319):

```bash
pnpm install        # installs host tooling; the container builds its own deps
pnpm db:push        # create the SQLite schema (first run only)
pnpm dev            # builds the image and starts the container
pnpm stop           # stop the container
pnpm dev:clean      # stop + drop the node_modules/.next volumes (run after changing deps)
```

Open http://localhost:3001. The container runs as a non-root user and the ports bind to
`127.0.0.1` only. **After changing dependencies** (`pnpm add/remove`), run `pnpm dev:clean`
once before `pnpm dev` so the container's `node_modules` volume is rebuilt — otherwise the
container keeps the previous dependency set.

Because the agent operates on your real projects and login, the container bind-mounts
your host:

- `~/.claude` — the runner reuses your existing Claude Code login + plugins (nothing to
  configure). Set `ANTHROPIC_API_KEY` in your shell to bill an API key instead.
- `~/Dev` — mounted at the **same absolute path** so project paths stored in the DB
  resolve inside the container. **Managed projects must live under `~/Dev`.**
- `~/.gitconfig` — so commits the agent makes carry your identity.

This gives a reproducible runtime, not isolation. To run natively (no Docker) instead:

```bash
pnpm dev:local      # next dev + runner daemon directly on the host
```

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
Browser ──HTTP──▶ Next.js app (:3001)  ──shared SQLite──▶  Runner daemon (:4319)
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
