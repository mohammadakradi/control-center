---
title: Fix unreliable photo/file uploads across all three attachment points
stack: fullstack
assignee: swe
priority: P1
depends_on: []
---

# Fix unreliable photo/file uploads across all three attachment points

## Issue
Attaching a photo and dispatching/sending sometimes fails with `BAD_MULTIPART`
("The upload didn't arrive intact — the request body wasn't valid form data.") from
`lib/uploads.ts:45-46`. That message fires whenever `readFormData()` (`lib/uploads.ts:30`)
catches Undici throwing `Failed to parse body as FormData` on `request.formData()` — the
multipart body the browser sent didn't parse. This isn't new: the try/catch around it was
added in commit `b9c2c3b` specifically because the raw crash had already happened seven times
in this install's logs before anyone made it a readable error — the underlying cause of the
broken body was never diagnosed. The three client call sites
(`components/NewTaskForm.tsx`, and `components/TaskLiveView.tsx`'s `respond()` and
`continueRun()`) all build `FormData` correctly with no explicit `Content-Type` override, and
no middleware or body-size limit touches these routes, so the corruption is happening in how
the browser delivers the request, not in this app's own server code.

## Goal
Attaching a photo or document and dispatching a task, answering a gate, or sending a follow-up
reliably delivers the file — the current friendly-but-unresolved failure stops recurring. If it
still can't be fully eliminated, the next occurrence must be diagnosable from the logs alone.

## Suggested solution
This codebase has already hit more than one Apple/WebKit-specific file-upload bug in this exact
feature (see `CLAUDE.md`'s WKWebView file-chooser fix), and WebKit has a long-standing bug where
`fetch()` with a `FormData` body holding a live `File` handle can send an incomplete body — the
leading hypothesis here, but not confirmed by a live repro. Two parts:
1. Strengthen `readFormData()`'s error log (`lib/uploads.ts`) to capture the expected
   `Content-Length` alongside what Undici reports, plus the request's `User-Agent` — the
   current log (content-type + message only) doesn't distinguish "no boundary" from "body cut
   short," which is needed to confirm or rule out the hypothesis above.
2. Apply the standard mitigation for the WebKit `fetch`+`FormData`+`File` streaming bug to the
   three upload sites — don't hand `fetch()` a lazily-streamed live `File`; either
   pre-materialize each file into an in-memory `Blob`/`ArrayBuffer` before appending to
   `FormData`, or move the upload leg to `XMLHttpRequest`. Verify against current WebKit
   behavior before committing to one approach, and use the new diagnostics to confirm the fix
   actually addresses what's happening if it recurs.

## Affected areas
- `lib/uploads.ts` — `readFormData()` (upload-failure diagnostics), `BAD_MULTIPART`
- `components/NewTaskForm.tsx` — `submit()`, the new-task dispatch upload
- `components/TaskLiveView.tsx` — `respond()` (gate-answer upload), `continueRun()`
  (follow-up upload)
- Feature: attaching photos/documents when dispatching a task, answering a gate, or sending a
  follow-up — all three multipart upload paths in the app
