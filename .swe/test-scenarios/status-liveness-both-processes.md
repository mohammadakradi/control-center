# Test scenario: `control-center status`/`running()` checks both processes

_Task: `running() { pid_of web >/dev/null 2>&1; }` only checked the `web` pid file, so
`status` could report "Stopped" while `runner` (which holds its own connection to the
production database) was still alive, and `cmd_start`'s already-running guard could spawn a
duplicate `web`+`runner` pair alongside an orphaned live `runner` ·
`.pm/tasks/20260812-191427-fix-update-build-sqlite-lock/03-devops-status-liveness-check.md` ·
2026-08-12_

## What changed

`infra/release/control-center.sh`:
- `running()` now returns true if *either* `pid_of web` or `pid_of runner` succeeds (was
  `web`-only).
- `wait_for_http()` (which waits for the just-spawned `web` process to answer HTTP) now checks
  `pid_of web` directly instead of the broadened `running()`, so it still fails fast if `web`
  dies rather than being masked by a live orphaned `runner`.
- `status)` now reports `web`/`runner` independently: `Running` (both alive, with both pids),
  `Partially running — <which one>` (one alive, names which and its pid), or `Stopped`
  (neither).
- `cmd_start()`'s already-running guard only treats "already running" (skip spawn, open
  window) as *both* alive; if only one is alive, it `die`s with an actionable message
  (`web pid: X, runner pid: none` or vice versa) instead of spawning a duplicate pair.

No automated test harness covers this script (`pnpm test`'s globs don't include
`infra/release/*.sh`), so verification is manual, using fake pid files against real
backgrounded processes — same approach used for `sqlite-busy-timeout.md`.

## Setup / preconditions

- A shell with `sh`, `kill`, and the ability to background processes (`sleep &`). No Docker
  container or real install needed — this exercises the script directly against a throwaway
  `CC_HOME`.
- `CC_NO_OPEN=1` to skip actually opening a browser window during `start` tests.

## Happy path — all four liveness states via `status`

```sh
TMP=$(mktemp -d)
export CC_HOME="$TMP/home"
mkdir -p "$CC_HOME/app" "$CC_HOME/run"
echo '{"version":"0.0.0-test"}' > "$CC_HOME/app/package.json"

sleep 60 & ALIVE1=$!
sleep 60 & ALIVE2=$!
DEAD=99999   # a pid unlikely to exist

# both stopped
sh infra/release/control-center.sh status
# Expected: "Stopped — v0.0.0-test installed at .../app"

# web up, runner down
echo "$ALIVE1" > "$CC_HOME/run/web.pid"
echo "$DEAD" > "$CC_HOME/run/runner.pid"
sh infra/release/control-center.sh status
# Expected: "Partially running — web is up (pid $ALIVE1) but the runner is not. ..."

# runner up, web down
echo "$DEAD" > "$CC_HOME/run/web.pid"
echo "$ALIVE2" > "$CC_HOME/run/runner.pid"
sh infra/release/control-center.sh status
# Expected: "Partially running — the runner is up (pid $ALIVE2) but web is not. ..."

# both up
echo "$ALIVE1" > "$CC_HOME/run/web.pid"
echo "$ALIVE2" > "$CC_HOME/run/runner.pid"
sh infra/release/control-center.sh status
# Expected: "Running — v0.0.0-test on http://localhost:7373 (web pid $ALIVE1, runner pid $ALIVE2)"

kill "$ALIVE1" "$ALIVE2" 2>/dev/null || :
rm -rf "$TMP"
```

## `cmd_start`'s already-running guard

Using the same `CC_HOME`/pid setup:

1. **Both alive** — `CC_NO_OPEN=1 sh infra/release/control-center.sh start --no-update`
   - **Expected:** `Already running on http://localhost:7373`, exit code `0`. No new
     `web`/`runner` process spawned (pid files unchanged).
2. **Only `web` alive** (runner pid file dead/missing) —
   `CC_NO_OPEN=1 sh infra/release/control-center.sh start --no-update`
   - **Expected:** `error: partially running (web pid: <N>, runner pid: none) — not starting
     a second pair. Run 'control-center stop' then 'start' to recover cleanly.`, exit code `1`.
     No duplicate pair spawned.
3. **Only `runner` alive** — symmetric to (2), message names `runner pid: <N>, web pid: none`.
4. **Recovery path** — from either partial state, run `sh infra/release/control-center.sh
   stop`, then `status`. **Expected:** the live orphan is actually killed and a subsequent
   `status` reports `Stopped`.

## Regression check

```sh
sh -n infra/release/control-center.sh && echo "syntax OK"
docker exec platform env -u RUNNER_HOST pnpm test   # full suite, unaffected by this change
docker exec platform pnpm lint
```

## Note on scope

This is a diagnostic/correctness fix only — it does not address the build-time
`SQLITE_BUSY` issue (`01-backend-sqlite-busy-timeout.md`, already fixed separately):
`apply_update()`'s `stop_all` already targets both pid files directly regardless of
`running()`, and the build itself writes to a temp-directory database distinct from the
production one. `import` and `update`'s existing calls to `running()` also benefit from the
broadened check as a side effect (e.g. `import` now correctly stops an orphaned live `runner`
before importing, instead of running the import while it still holds the database open).
