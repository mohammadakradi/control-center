# Test scenario: SQLite busy_timeout on the shared connection

_Task: `control-center update` / a fresh `install.sh` install could fail mid-`next build`
with `SqliteError: database is locked` because several of Next's parallel build workers race
to create/WAL-convert a brand-new `platform.db` at once with no busy_timeout set ·
`.pm/tasks/20260812-191427-fix-update-build-sqlite-lock/01-backend-sqlite-busy-timeout.md` ·
2026-08-12_

## What changed

`lib/db/index.ts`'s `createConnection()` now sets `sqlite.pragma("busy_timeout = 8000")`
before the existing `journal_mode = WAL` pragma. This is an explicit, intentional value —
`better-sqlite3` already applies an undocumented 5000ms default at connection-open, so the
code no longer depends on that default silently.

## Setup / preconditions

- Dev container available (`pnpm dev` or `docker compose -f infra/docker/docker-compose.yml
  up -d`).
- No live task should be running against this repo's own dev database during the build repro
  below — it uses a throwaway `PLATFORM_DATA_DIR`, so it's isolated from `data/platform.db`,
  but the container should be otherwise idle to keep the timing clean.

## Happy path — reproduce the exact failing scenario from the spec

1. Inside the container, build against a **completely fresh** data directory (mirrors what
   `install.sh` / `apply_update()` do — build runs before `runner/migrate.ts`, so no
   `platform.db` exists yet):
   ```sh
   docker exec platform sh -c '
     rm -rf /tmp/freshbuild && mkdir -p /tmp/freshbuild
     cd /app
     NODE_ENV=production PLATFORM_DATA_DIR=/tmp/freshbuild ./node_modules/.bin/next build
   '
   ```
   - **Expected:** build finishes with `✓ Compiled successfully`, `Finished TypeScript`, and
     "Generating static pages using 7 workers" completing at `(6/6)` — no `SqliteError`, no
     `SQLITE_BUSY`, no `database is locked`. Exit code 0.
   - `/tmp/freshbuild` should contain `platform.db`, `platform.db-shm`, `platform.db-wal`.
   - Clean up: `docker exec platform rm -rf /tmp/freshbuild`.

2. Stress the race directly — many processes opening the same brand-new file at once (what
   the build workers do under the hood):
   ```sh
   docker exec platform sh -c '
     rm -rf /tmp/busytest && mkdir -p /tmp/busytest
     cd /app
     for i in $(seq 1 20); do
       PLATFORM_DB=/tmp/busytest/platform.db NODE_ENV=production \
         ./node_modules/.bin/tsx lib/db/index.ts > /tmp/busytest/out_$i.log 2>&1 &
     done
     wait
     grep -l "SQLITE_BUSY\|database is locked" /tmp/busytest/out_*.log || echo "no failures"
   '
   ```
   - **Expected:** `no failures`.
   - Clean up: `docker exec platform rm -rf /tmp/busytest`.

3. Automated regression test:
   ```sh
   docker exec platform env -u RUNNER_HOST pnpm test
   ```
   - **Expected:** full suite passes, including `the connection sets an explicit busy_timeout
     above better-sqlite3's own default` in `lib/db.test.ts`.

## Note on scope

Both independent reviews flagged the same trade-off: this pragma applies to the one shared
connection every request/task uses, not just the build-time path, so live lock contention
(e.g. the runner writing while a web request reads) now waits up to 8s instead of the
previous implicit ~5s before failing. Accepted as-is — the app is loopback-only, the increase
is modest, and this class of stall already existed. No behavior change expected outside of
contention scenarios.
