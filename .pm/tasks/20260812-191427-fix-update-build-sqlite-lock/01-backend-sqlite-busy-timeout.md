---
title: Add a busy-timeout to the SQLite connection to stop build-time SQLITE_BUSY failures
stack: backend
assignee: swe
priority: P1
depends_on: []
---

# Add a busy-timeout to the SQLite connection

## Issue
`control-center update` (and a fresh `install.sh` install) can fail during `next build` with
`SqliteError: database is locked` / `SQLITE_BUSY`, aborting the whole update and leaving the
user stuck on the old version. It happens in Next's "Collecting page data" phase: many route
modules import `lib/db` (33+ files, directly or transitively), each of Next's parallel build
workers evaluates them and triggers `lib/db/index.ts`'s module-level `createConnection()`, and
several workers race to create/WAL-convert the same brand-new SQLite file at once. There is no
`busy_timeout` set anywhere in the codebase, so SQLite throws immediately on any contention
instead of waiting.

## Goal
Concurrent opens of the same SQLite file (at build time or otherwise) wait briefly for the lock
to clear instead of crashing the build or a request.

## Suggested solution
Set a `busy_timeout` pragma (e.g. a few seconds) on the connection in
`lib/db/index.ts`'s `createConnection()`, alongside the existing `journal_mode = WAL` and
`foreign_keys = ON` pragmas. Verify by reproducing the exact failing conditions: run a
production build (`NODE_ENV=production`) against a completely fresh data directory (no existing
`platform.db`) and confirm it no longer intermittently fails during page-data collection.

## Affected areas
- `lib/db/index.ts` — `createConnection()`, where the `better-sqlite3` connection and its
  pragmas are set up.
- `infra/release/control-center.sh` (`apply_update()`) and `infra/release/install.sh` — both
  run `next build` in a fresh temp directory with no `PLATFORM_DATA_DIR` set; this is the
  exact scenario that triggers the race, useful for writing a repro.
- `components/UpdateBanner.tsx` / `app/api/updates/apply/route.ts` — the in-app "Update now"
  button already shells out to the same `control-center update` command, so this fix also
  makes that existing button reliable.
