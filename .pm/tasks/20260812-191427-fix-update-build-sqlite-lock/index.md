---
title: Fix control-center update/install build failure (SQLITE_BUSY) + two related hardening fixes
request_date: 2026-08-12
---

# control-center update fails with "database is locked"; in-app update button expectation

## Original report
Running `control-center update` (0.4.0) failed during the build step:
```
Collecting page data using 7 workers  ...SqliteError: database is locked
...
Build error occurred
Error: Failed to collect page data for /api/auth/signout
error: build failed — the existing install is untouched.
```
The reporter also expected an in-app "update" button so they wouldn't need the terminal.

A second developer reviewed the report and added two more observations (see below) — both were
investigated and confirmed as real, separate issues worth fixing alongside the primary bug.

## Request assessment

- **Verdict:** PARTIAL — one confirmed bug to fix (BUILD), one already-shipped feature
  (ALREADY-DONE), and two additional confirmed hardening gaps raised by a second developer
  (BUILD).

### 1. Build fails with `SqliteError: database is locked` — BUILD (confirmed root cause)
- `infra/release/control-center.sh`'s `apply_update()` runs `next build` in a **fresh temp
  directory** (`$tmp/app`, no existing `data/`) with no `PLATFORM_DATA_DIR` set — same pattern
  in `infra/release/install.sh` for a first install.
- `lib/db/index.ts`'s `createConnection()` opens a `better-sqlite3` connection **as a
  module-level side effect** and sets `journal_mode = WAL`, but sets **no `busy_timeout`**
  anywhere in the codebase (confirmed by grep). Default SQLite behavior with no busy timeout
  throws `SQLITE_BUSY` immediately on any lock contention instead of waiting.
- `lib/db` is imported by 33+ files, including nearly every `app/api/**/route.ts` and
  `app/(app)/**/page.tsx`. Next's build-time "Collecting page data" phase evaluates these
  across multiple parallel worker processes (7, per the log). With no database file yet
  existing, several workers race to create/WAL-convert the same brand-new SQLite file at
  nearly the same instant; the loser gets `SQLITE_BUSY`, crashing the whole build.
- **Recommendation:** add a busy-timeout pragma so concurrent opens wait instead of failing.

### 2. "I expected an in-app update button" — ALREADY-DONE
- `components/UpdateBanner.tsx` (rendered from `app/(app)/layout.tsx`), backed by
  `GET /api/updates` and `POST /api/updates/apply`, has shipped since the very first release
  (commits `b99f08f`/`b2eb7e8`) — not missing from 0.4.0.
- The button calls the exact same `control-center update` command, so it would have failed
  identically. No new work needed here; fixing #1 makes the existing button reliable.

### 3. (2nd developer) Stray lockfile above the build dir can silently mis-trace the build — BUILD (confirmed real, currently undefended)
- Next/Turbopack auto-infers the project root by walking up from the build directory looking
  for `pnpm-lock.yaml` / `package-lock.json` / `yarn.lock` / `bun.lock(b)` (confirmed in
  `node_modules/next/dist/docs/.../turbopack.md`, "Root directory" section — this repo's pinned
  Next 16.2.9 supports the `turbopack.root` config option to pin it explicitly).
  `install.sh`/`control-center.sh` build deep under `$HOME` (`~/.control-center/.update.<pid>/app`),
  so any unrelated lockfile in a user's home directory (common) could make Turbopack infer the
  wrong root — which the docs identify as exactly the class of misconfiguration that produces
  "unexpected file in NFT list" / "whole project traced unintentionally" warnings, the same
  warning visible (harmlessly, so far) in the reported build log.
  `next.config.ts` does not currently set `turbopack.root`.
- Didn't reproduce on this machine (no stray JS lockfile found above `~/.control-center`), so
  it isn't the cause of the reported crash — but it's a real, easy-to-hit latent risk on other
  machines, worth closing proactively in the same build pipeline.

### 4. (2nd developer) `control-center status`/`running()` can misreport a live runner as stopped — BUILD (confirmed real bug)
- `infra/release/control-center.sh`: `running() { pid_of web >/dev/null 2>&1; }` only checks
  the **web** process's pid file — never the **runner**'s. `status` calls `running()` directly,
  so it can print "Stopped" while the runner process (which also holds `lib/db`'s connection
  to the production database) is still alive.
- This also gates `cmd_start()`'s "already running" check, so a web process that died while its
  runner kept running would let `cmd_start` spawn a second web+runner pair alongside the
  orphaned runner.
- **Not** the cause of the reported build failure (`apply_update()`'s own `stop_all` targets
  both `web` and `runner` pid files directly, independent of `running()`, and the build's own
  SQLite file lives in a distinct temp path from the production database) — but it's a genuine
  correctness gap in the liveness check worth fixing on its own merits. We did **not** adopt the
  literal suggestion to make the installer "stop a running instance before building": that
  would trade away `apply_update()`'s deliberate build-before-swap ordering (a failed build must
  leave the running install untouched) for no benefit against this specific bug, since the
  build never touches the production database file. Fixing `running()` to check both processes
  gets the same safety property (accurate liveness, no double-spawned runner) without that
  trade-off.

## Solution
Three small, independent fixes, each isolated to its own file/concern:
1. Add a `busy_timeout` pragma to the SQLite connection (`lib/db/index.ts`).
2. Pin `turbopack.root` in `next.config.ts` to the app directory.
3. Make `running()`/`status` in `infra/release/control-center.sh` check both the `web` and
   `runner` processes.

## Tasks
- **[swe] Add a busy-timeout to the SQLite connection to stop build-time SQLITE_BUSY failures** —
  `01-backend-sqlite-busy-timeout.md`
- **[swe] Pin Turbopack's project root so a stray lockfile can't silently mis-trace the build** —
  `02-devops-turbopack-root.md`
- **[swe] Make control-center status/running() check the runner process, not just web** —
  `03-devops-status-liveness-check.md`

All three are independent (no `depends_on`) and can be built in any order.
