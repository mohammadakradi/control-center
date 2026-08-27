# log uploads

Dated log of the attachment-upload work, including the WebKit mitigation applied blind.

<!-- Split out of a single 232 KB `.swe/notes.md` on 2026-08-24, which was read in full at the start of every request (engineering rule 10). Entries are verbatim and in date order; only this header is new. -->

## 2026-08-19 — attachment uploads: WebKit `fetch`+`FormData`+`File` mitigation, applied blind
Picked up `BAD_MULTIPART` recurring in the logs (the friendly error added in `b9c2c3b` never
diagnosed the actual cause). Web research turned up multiple documented, still-open WebKit bugs
matching the shape (fetch() given a FormData holding a live File can stream it lazily and
truncate mid-request) — but, same as the pm agent's own planning note, **this could not be
force-reproduced without a real WebKit engine**, so the fix went in on the strength of the
pattern matching known bugs, not a live repro.
- **The mitigation: pre-materialize every file before it reaches `fetch()`.** New
  `lib/attachments.ts` (`materializeFiles`) reads each `File`'s bytes via `arrayBuffer()` and
  rebuilds it as a plain in-memory `File` before it's appended to a `FormData`. Applied at all
  three upload call sites (`NewTaskForm.tsx` dispatch, `TaskLiveView.tsx`'s `respond()` and
  `continueRun()`). It's a **new file, not added to `lib/uploads.ts`**, on purpose: that module
  imports `node:fs`/`node:path` and is read by these `"use client"` components — same rule as
  why `lib/pm-spec.ts` doesn't import `lib/util.ts` (2026-08-11 entry above). `File`/`Blob` are
  Node globals since Node 20, so `materializeFiles` itself is unit-tested with plain
  `node:test`, even though what it defends against only happens in a browser.
- **Don't claim a test proves the bug is fixed when it can't.** The first draft of
  `lib/attachments.test.ts`'s docstring said the WebKit behavior was "covered by the manual test
  scenario" — true of the *regression* check, false of the actual bug, which the scenario
  explicitly can't force either. The reviewer caught this as the one blocking finding: a comment
  overclaiming coverage is worse than no comment, because the next person trusts it. Fixed by
  making both the docstring and `.swe/test-scenarios/attachment-upload-reliability.md` state the
  same limitation in their own words, rather than one promising what the other can't deliver.
- **Diagnostics, not just a fix**: `readFormData`'s failure log (`lib/uploads.ts`) now also
  captures `Content-Length` and `User-Agent`, so if this recurs, the log alone can tell "no
  boundary" apart from "body cut short in transit" and which engine sent it — something the
  original catch-and-log-nicely fix from `b9c2c3b` never captured, which is why the root cause
  sat undiagnosed through seven prior occurrences.
- **Error-message precision was flagged non-blocking and fixed with wording, not branching.**
  The three call sites already had a `try`/`catch` around `fetch()` (to stop a rejected fetch
  from leaving a button spinning forever — a fix from an earlier task); `materializeFiles` now
  runs inside that same `catch`, so a file that fails to read hits the same recovery path. The
  reviewer noted the shown message ("couldn't reach the server") is misleading for a local
  read failure. Rather than add nested try/catch to distinguish the two causes across three call
  sites for a cosmetic gain, the fallback strings were just reworded to honestly name both
  possibilities — no new control flow, one line changed per site.
- **`components/DataSettings.tsx`'s archive-import upload has the same live-`File`-in-`FormData`
  shape** and was flagged by review as out of scope (not one of the three named attachment
  points). Filed to the backlog (`bli_c24269be`) rather than fixed here — small, well-scoped,
  same pattern to copy.
