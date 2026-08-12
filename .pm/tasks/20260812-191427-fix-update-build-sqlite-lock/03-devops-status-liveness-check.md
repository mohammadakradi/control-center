---
title: Make control-center status/running() check the runner process, not just web
stack: devops
assignee: swe
priority: P2
depends_on: []
---

# Fix the liveness check to cover both processes

## Issue
In `infra/release/control-center.sh`, `running() { pid_of web >/dev/null 2>&1; }` only checks
the `web` process's pid file — it never checks `runner`. `status` calls `running()` directly, so
it can report "Stopped" while the runner process (which holds its own connection to the
production `lib/db` database) is still alive. The same check gates `cmd_start()`'s "already
running" guard, so if `web` dies while `runner` keeps running, `cmd_start` would spawn a second
`web`+`runner` pair alongside the orphaned runner instead of recognizing the install as still
partially running.

## Goal
`control-center status` (and `cmd_start`'s already-running guard) accurately reflects whether
either process is still alive, so a live runner is never reported as "Stopped" and a dead web
process next to a live runner doesn't cause a duplicate spawn.

## Suggested solution
Change `running()` (or add a sibling check) to consider both `pid_of web` and `pid_of runner`,
and have `status` report which of the two is actually up rather than a single combined
running/stopped line. Note: this is a diagnostic/correctness fix, not a fix for the build-time
`SQLITE_BUSY` failure — `apply_update()`'s `stop_all` already targets both pid files directly
regardless of `running()`, and the build itself writes to a temp-directory database distinct
from the production one.

## Affected areas
- `infra/release/control-center.sh` — `running()`, the `status)` case, and `cmd_start()`'s
  already-running guard, all of which currently rely on the web-only check.
