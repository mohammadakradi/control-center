# Decision & Gotcha Journal

Running journal of non-obvious decisions, environment quirks, and traps. Read before acting;
update after every change.

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

## Decisions
- **2026-06-26 — Dockerized dev (`pnpm dev` runs a container).** Because there is no infra
  layer to containerize (unlike Matcher's postgres/redis/minio), we containerize the *app
  itself*: one `platform` service runs `pnpm dev:local` (web :3000 + runner :4319) inside the
  container. `pnpm dev` → `docker compose up --build`; `pnpm dev:local` keeps the native flow
  (mirrors Matcher's `dev`/`dev:local` split). Compose file lives at
  `infra/docker/docker-compose.yml` (Matcher-style layout).
  - To keep the agent functional in-container we bind-mount the host: `~/.claude` (auth +
    plugins) → `/home/node/.claude`, `~/Dev` at the **same absolute path** (so DB-stored
    project paths resolve), `~/.gitconfig`, and the repo source (which carries `./data`).
    `ANTHROPIC_API_KEY` is passed through if set. This gives a **reproducible runtime, not
    isolation** — accepted by the user.
  - **Hardening from review (2026-06-26):** container runs as non-root `node` (UID 1000,
    `HOME=/home/node`); published ports bind to `127.0.0.1` only; the `next dev -H 0.0.0.0`
    bind lives in a container-only `dev:container` script so native `dev:local`/`dev:web`
    stay localhost. `dev:clean` (`compose down --volumes`) re-seeds the `node_modules`/`.next`
    named volumes after a dependency change.

## Gotchas
- **Never bind-mount host `node_modules` into the linux container** — `better-sqlite3` is
  compiled for the host (macOS/arm); the container needs its own linux build. We mask
  `node_modules` (and `.next`) with anonymous volumes so the in-image install wins.
- WAL SQLite over a macOS bind-mount can have locking quirks; acceptable for dev.
- `next dev` must bind `0.0.0.0` (`-H 0.0.0.0`) to be reachable from the host when in a
  container — but only inside the container (`dev:container`), never the native scripts.
- Empty Docker **named volumes inherit the ownership** of the image dir at their mount point,
  so `chown -R node:node /app` in the Dockerfile (before `USER node`) lets the non-root
  process write to the `node_modules`/`.next` volumes. Don't forget the `chown` if adding a
  new volume-masked path.
