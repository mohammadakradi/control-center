# Test scenario: Dockerized `pnpm dev`

_Task: `pnpm dev` now builds and runs the whole app (dashboard :3000 + runner :4319) inside a Docker container · 2026-06-26_

## Setup / preconditions
- Docker Desktop running (`docker --version` and `docker compose version` both work).
- Your managed projects live under `~/Dev` (the DB already references e.g.
  `/Users/moh/Dev/Matcher`). This directory is mounted into the container at the same path.
- You are logged into Claude Code on the host (`~/.claude` exists). No `ANTHROPIC_API_KEY`
  needed unless you want to bill an API key.
- From the repo root:
  ```bash
  pnpm install      # host tooling only; the container builds its own Linux deps
  pnpm db:push      # first run only — creates data/platform.db
  ```

## Happy path
1. Start the app in Docker:
   ```bash
   pnpm dev
   ```
   - **Expected:** Docker builds the image (first run: a few minutes; later runs: cached),
     then a `platform` container starts. Logs show `web ... ✓ Ready` and
     `[runner] listening on http://localhost:4319`. The terminal stays attached.
2. In another terminal, confirm both services answer (loopback only):
   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000      # → 200
   curl -s http://127.0.0.1:4319/health                                # → {"ok":true}
   ```
   - **Expected:** `200` and `{"ok":true}`.
3. Open http://localhost:3000 in a browser.
   - **Expected:** The dashboard loads with your existing agents, projects (Matcher,
     portal, platform), and recent tasks — i.e. it's reading the same `data/platform.db`
     as before (the DB is shared via a bind mount, not duplicated).
4. Confirm the container runs as a non-root user:
   ```bash
   docker exec platform id
   ```
   - **Expected:** `uid=1000(node) gid=1000(node) ...` (not root).
5. Open a project, start a task with an agent (e.g. `/swe:onboard` on a project under
   `~/Dev`), and watch the live transcript.
   - **Expected:** The agent runs against the real project folder on your host and streams
     output — confirming `~/Dev` and `~/.claude` are correctly mounted into the container.
6. Stop the app:
   ```bash
   pnpm stop          # or Ctrl+C in the attached terminal
   ```
   - **Expected:** The `platform` container stops and is removed; `docker ps` no longer
     lists it. Your `data/` (DB + uploads) on the host is untouched.

## Edge / failure cases
1. **Dependency change requires a volume reset.** Add a dependency on the host, then start
   without cleaning:
   ```bash
   pnpm add some-small-pkg      # updates package.json + pnpm-lock.yaml
   pnpm dev
   ```
   - **Expected:** The container may still use the *previous* dependency set (the
     `node_modules` is a named volume seeded once from the image and is **not** re-seeded by
     `--build` alone). The fix is documented:
     ```bash
     pnpm dev:clean             # docker compose down --volumes
     pnpm dev                   # rebuilds the image and re-seeds node_modules
     ```
   - **Expected after clean:** the new package resolves inside the container.
2. **No LAN exposure.** From another machine on your network, try to reach
   `http://<your-host-LAN-ip>:3000` or `:4319`.
   - **Expected:** Connection refused / no response — ports are bound to `127.0.0.1` only.
3. **Native fallback still works (no Docker).** Stop the container, then:
   ```bash
   pnpm dev:local
   ```
   - **Expected:** The app runs directly on the host exactly as before (Next on
     `localhost:3000`, runner on `:4319`), with no `0.0.0.0` LAN binding.

## What success looks like
`pnpm dev` brings the entire app up inside one Docker container — dashboard and runner both
reachable on loopback, reading your existing SQLite DB and driving agents against your real
`~/Dev` projects using your `~/.claude` login — and `pnpm stop` / `pnpm dev:clean` cleanly
manage it. The native `pnpm dev:local` path remains available and unchanged.
