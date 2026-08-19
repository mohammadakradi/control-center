---
title: Fix the update banner's confirmation and failure UX
stack: frontend
assignee: fe
priority: P1
depends_on: [01-backend-update-pipeline-observability.md]
---

# Fix the update banner's confirmation and failure UX

## Issue
`components/UpdateBanner.tsx` has two UX gaps that make a working feature look broken. First,
when `POST /api/updates/apply` 409s because a task is in an active status (which includes a
task simply waiting at a gate — `awaiting_proposal`/`awaiting_report`, very common on this
platform), the banner responds by silently relabeling its own button from "Update now" to
"Update anyway" and printing the reason as small inline text next to other copy — easy to miss
entirely, so a user's first click reads as "nothing happened." Second, when an update genuinely
fails, the banner has no way to know — it just polls until a fixed 6-minute timeout
(`GIVE_UP_MS`) and shows a generic "quit Agent Control Center and open it again" message that
neither explains what went wrong nor reliably resolves it.

## Goal
A user who clicks "Update now" either sees the update happen, or immediately understands why it
didn't (blocked by running tasks vs. an actual failure) and what to do about it — with a real
failure reason shown as soon as it's known, not after a fixed timeout.

## Suggested solution
Make the active-task block an unmissable, distinct state — not just a same-button relabel —
so the need for a deliberate second "Update anyway" click is obvious. Once task `01` exposes a
real update-attempt status (log tail / success-or-failure) from the backend, have the banner's
polling consume it and show the actual failure reason as soon as it's known, reserving the
generic stalled/timeout message for the case where the server truly never comes back.

## Affected areas
- `components/UpdateBanner.tsx` — the `applyUpdate`/`waitForRestart` flow, the 409/`activeTasks`
  handling, and the `stalled` state's messaging.
- Consumes the status surface added to `/api/updates` (or a new endpoint) by
  `01-backend-update-pipeline-observability.md`.
