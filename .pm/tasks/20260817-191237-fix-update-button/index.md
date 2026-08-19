---
title: Fix the in-app "Update now" button so it reliably updates the app
request: "Clicking the update button in the app doesn't update it; the user has to manually run `control-center stop` then `control-center start` in a terminal to get the update."
---

# Fix the update button

## Request assessment
- **Verdict:** PARTIAL
- **What was asked:** Clicking "Update now" in the app should update it; today it doesn't, and
  the user has to close the app and run `control-center stop` + `control-center start` by hand.
- **What the code actually does:** The update-from-banner feature (`b2eb7e8`) is real and works —
  this machine's own install went 0.5.0 → 0.6.0. `POST /api/updates/apply`
  (`app/api/updates/apply/route.ts`) hands the work to a detached `control-center update`
  (`infra/release/control-center.sh`), which downloads, verifies, builds, swaps `app/`, and
  restarts — the same `apply_update()` the manual `control-center start` path calls via
  `check_and_update()`. Two real gaps in the *button* path explain the reported failure:
  1. `POST /api/updates/apply` 409s whenever any task is in an active status
     (`ACTIVE_STATUSES` in `lib/ui.ts`, which includes `awaiting_proposal`/`awaiting_report` —
     any task simply sitting at a gate). `UpdateBanner.tsx` responds to a 409 by silently
     relabeling the same button "Update anyway" and printing the reason as small inline text —
     easy to read as "the button did nothing." The manual stop/start path has no such check at
     all, so it always proceeds.
  2. The detached `control-center update` process is spawned with `stdio: "ignore"`
     (`app/api/updates/apply/route.ts`), discarding every line `apply_update()` prints —
     download progress, checksum failures, `npx pnpm install` failures, `next build` failures —
     unlike the `web`/`runner` spawns in `control-center.sh`, which redirect into `logs/`. A real
     failure anywhere in that pipeline leaves no trace; the banner just times out to "stalled"
     after 6 minutes and suggests quitting and reopening, which neither diagnoses nor reliably
     fixes anything.
- **Already implemented?** The update mechanism itself: yes, fully, and it works. The button's
  reliability/observability around it: no.
- **Risks / conflicts:** None found that block this — both fixes are additive (logging, status
  reporting, UI clarity) and don't change `apply_update()`'s actual update logic.
- **Real need:** Clicking "Update now" should either update the app, or clearly say why it
  didn't and what to do — not silently degrade into "go use the terminal."
- **Recommendation:** Proceed with both fixes below.

## Solution
1. Instrument the update pipeline so its output and outcome are captured, not discarded.
2. Fix the banner's UX so a blocked-by-active-tasks state is unmissable, and surface the real
   failure reason once it's available, instead of a generic timeout message.

## Tasks
- **[swe] Instrument the update pipeline with logging + a real status signal** —
  `01-backend-update-pipeline-observability.md`
- **[fe] Fix the update banner's confirmation and failure UX** —
  `02-frontend-update-banner-ux.md` (depends on 01)
