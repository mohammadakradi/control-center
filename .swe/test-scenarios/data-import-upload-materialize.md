# Test scenario: materializeFiles applied to the data-import archive upload

_Task: apply the WebKit `fetch`+`FormData`+live-`File` mitigation to the fourth upload call
site, `components/DataSettings.tsx`'s archive import — a backlog item filed as follow-up to
`.pm/tasks/20260819-150644-fix-attachment-upload-multipart-error/` · 2026-08-19_

## What changed

- `components/DataSettings.tsx`'s `upload(file: File)` now calls `materializeFiles([file])`
  (from `lib/attachments.ts`) to read the archive's bytes into an in-memory `File` before
  appending it to the `FormData` posted to `/api/data/import` — mirroring the fix already
  applied at the three attachment-upload sites (`NewTaskForm.tsx`, `TaskLiveView.tsx`'s
  `respond()`/`continueRun()`).

## Honesty note

Same as the original task: the underlying WebKit bug is intermittent and was never
force-reproduced, so this scenario can confirm the happy path is unaffected but cannot prove
the bug is gone. See `.swe/test-scenarios/attachment-upload-reliability.md` for the fuller
discussion.

## Setup

- The stack running: `pnpm dev` (http://localhost:3001) or the installed app
  (`control-center start`, http://localhost:7373).
- Settings → Data tab, signed in as the only account on the install (import is refused past
  one account — `installWideDataOpAllowed()`).
- A valid export archive on hand: run **Export data** first (same page) to produce one, or use
  any prior `.tar.gz` from `control-center export`.

## Happy path — no regression

1. Go to **Settings → Data → Restore from a backup**.
2. Choose the `.tar.gz` file via the file input.
3. **Expected:** "Checking the archive…" appears briefly, then the info banner shows
   `Ready: <N> rows from <version> (exported <date>)…` and **Quit and reopen the app to apply
   it.** — identical to behavior before this change.
4. Confirm `GET /api/data/import` (reload the page) still reports `queued: true`.
5. Press **Cancel this import** — the banner clears and a fresh upload can be queued again.

## Edge case — a bad file is still rejected the same way

1. Select a non-archive file (e.g. a `.txt` or `.png`).
2. **Expected:** the red error `That file isn't a readable .tar.gz archive.` (or `No
   manifest.json inside…` if it's a valid gzip but not an export), same as before — the
   materialized `File` still round-trips the exact bytes, so validation on the server is
   unaffected.

## What success looks like

Uploading a real export archive from Settings → Data queues it exactly as before, with no
behavior change visible to the user — the fix is invisible when nothing goes wrong, same as
at the other three call sites.
