# Request: fix "upload didn't arrive intact" when attaching a photo

## Request assessment

- **Verdict:** BUILD
- **What was asked:** attaching a photo in the app and then dispatching/sending fails with
  "The upload didn't arrive intact — the request body wasn't valid form data."
- **What the code actually does:** that sentence is `BAD_MULTIPART` in `lib/uploads.ts:45-46`,
  returned by `POST /api/tasks`, `.../[id]/respond` and `.../[id]/continue` whenever
  `readFormData()` (`lib/uploads.ts:30`) catches Undici throwing `Failed to parse body as
  FormData` while reading `request.formData()` — i.e. the multipart body the browser actually
  sent didn't parse (missing/garbled boundary, or a body cut short).
- **Already implemented?** Partially, and not the part that matters. This catch + friendly
  message was added in commit `b9c2c3b` (2026-08-13) *because* this failure was already
  happening — its own commit message notes "this install's log had seven of those." The app
  was made to fail more gracefully; the actual reason a browser sometimes delivers a broken
  multipart body was never diagnosed or fixed.
- **Ruled out:** all three client call sites (`components/NewTaskForm.tsx`,
  `components/TaskLiveView.tsx`'s `respond()`/`continueRun()`) build `FormData` correctly and
  never set an explicit `Content-Type` header (the most common cause of this exact error, since
  it would strip the boundary). No middleware touches these routes (`proxy.ts` only matches
  `/signin`/`/signup`). No body-size limit applies (`serverActions.bodySizeLimit` only affects
  Server Actions, not these Route Handlers). A real multipart upload via curl parses fine. So
  the malformed body arrives before this app's own server code ever sees it.
- **Real need / best-evidenced hypothesis:** this codebase has already hit more than one
  Apple/WebKit-specific file-upload bug in this exact feature (the Mac app's `WKWebView` had a
  dead file picker until a dedicated fix — see `CLAUDE.md`). WebKit (Safari, and the Mac app's
  `WKWebView`) has a long-standing, documented bug where `fetch()` with a `FormData` body
  containing a `File` can send an incomplete/incorrect body, which matches the symptom (works
  from other clients, fails intermittently from the app with a photo attached). This could not
  be force-reproduced in the planning environment (no real WebKit engine available there), so
  it is flagged as the best-evidenced hypothesis, not a confirmed root cause.
- **Risks / conflicts:** none found — hardening the upload path is backward compatible.
- **Recommendation:** proceed — add stronger diagnostics (so a future occurrence pins the exact
  cause even if the first fix isn't complete) and apply the standard mitigation for the WebKit
  `fetch`+`FormData`+`File` bug across the three upload call sites.

## Solution

One fullstack task, assigned to `swe`, covering both the server-side diagnostics and the
client-side upload-mechanism change — see the task file below.

## Tasks

- **[swe] Fix unreliable photo/file uploads (attach-to-task, attach-to-gate, attach-to-follow-up)** —
  `01-fullstack-fix-attachment-upload-reliability.md`
