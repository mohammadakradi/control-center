---
title: Instrument the update pipeline with logging and a real status signal
stack: backend
assignee: swe
priority: P1
depends_on: []
---

# Instrument the update pipeline with logging and a real status signal

## Issue
`POST /api/updates/apply` (`app/api/updates/apply/route.ts`) hands the actual update off to a
**detached** `control-center update`, spawned with `stdio: "ignore"`. Every line
`apply_update()` in `infra/release/control-center.sh` prints — download progress, checksum
verification, `npx pnpm install` output, `next build` output, and any `die` failure message —
is discarded. Unlike the `web`/`runner` process spawns in the same script, which redirect into
`$LOG_DIR/*.log`, nothing about the update attempt itself is ever recorded. When it fails
partway, the frontend (`components/UpdateBanner.tsx`) has no way to know that — it just polls
`/api/updates` until a fixed 6-minute timeout and gives up, with no diagnostic trail for the
user or for future debugging.

## Goal
Every update attempt triggered from the app leaves a record of what happened and how it ended
(succeeded, or failed and why), and that outcome is queryable over HTTP — so the frontend can
distinguish "still working" from "actually failed," and a failure is diagnosable without
dropping to a terminal.

## Suggested solution
Have `control-center update`'s invocation write its full output to a dedicated log
(e.g. `$LOG_DIR/update.log`, truncated per attempt) instead of `/dev/null`, and record an
explicit outcome the moment the run ends (e.g. a small status file in `$RUN_DIR` or `$CC_HOME`
capturing state — running/succeeded/failed — plus the target version and, on failure, the
tail of the log). `app/api/updates/apply/route.ts` should capture the child's output into that
log rather than `stdio: "ignore"`. Expose the outcome through the existing `/api/updates`
response (or a small addition to it) so a poller can read real state instead of inferring it
from a version-number diff and a timeout.

## Affected areas
- `infra/release/control-center.sh` — the `update` case and `apply_update()`: output capture
  and an explicit success/failure marker.
- `app/api/updates/apply/route.ts` — the detached spawn's `stdio` handling.
- `app/api/updates/route.ts` / `lib/updates.ts` — surfacing the update-attempt status alongside
  the existing "is a new release available" check.
- Feeds `components/UpdateBanner.tsx`'s polling loop (frontend task `02`, which consumes this).
