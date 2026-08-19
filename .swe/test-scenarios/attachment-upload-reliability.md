# Test scenario: reliable photo/file uploads across all three attachment points

_Task: fix intermittent `BAD_MULTIPART` ("The upload didn't arrive intact") failures when
attaching a photo/document at dispatch, at a gate answer, or on a follow-up · 2026-08-19_

## What changed

- `lib/attachments.ts` (new): `materializeFiles()` reads each attached file's bytes into memory
  (`arrayBuffer()`) and rebuilds it as a plain in-memory `File` **before** it's appended to a
  `FormData` that gets `fetch()`'d — the standard mitigation for WebKit's documented
  `fetch`+`FormData`+live-`File` streaming bug. Applied at all three call sites:
  `components/NewTaskForm.tsx`'s `submit()`, and `components/TaskLiveView.tsx`'s `respond()`
  and `continueRun()`.
- `lib/uploads.ts`: `readFormData`'s failure log now also captures the request's declared
  `Content-Length` and `User-Agent`, so a future occurrence can tell "no boundary" apart from
  "body cut short mid-transfer," and which browser/engine hit it.

## Important honesty note before you test

The underlying WebKit bug this targets is **intermittent and could not be force-reproduced**
even during planning (no real WebKit engine was available then either — see
`.pm/tasks/20260819-150644-fix-attachment-upload-multipart-error/index.md`). There is no way to
manufacture the exact failure on demand, so this scenario can verify two things directly —
**(1)** the fix introduces no regression to normal uploads, and **(2)** the strengthened
diagnostics actually appear in the log — but it **cannot prove the WebKit bug itself is gone**.
The real confirmation is negative evidence over time: real usage from Safari/the Mac app's
`WKWebView` stops producing `BAD_MULTIPART`, or if it recurs, the new log fields say whether it
was actually a truncated body from an Apple engine (confirming the hypothesis) or something
else entirely (ruling it out, and giving the next occurrence a concrete lead this fix couldn't
have used).

## Setup / preconditions

- The stack running: `pnpm dev` (dev container, http://localhost:3001) or the installed app
  (`control-center start`, http://localhost:7373).
- A registered project with a `CLAUDE.md` and an Anthropic token saved under Settings (needed to
  actually dispatch tasks).
- A photo/screenshot on hand (any `.png`/`.jpg` under 25 MB).
- Ideally, access to a real Safari/iOS device or the packaged Mac app — the mechanism can be
  exercised from any browser, but the bug it targets is WebKit-specific.

## Happy path — no regression at any of the three attachment points

1. **Dispatch.** From **New task**, attach a photo, write a short prompt, press **Run task**.
   The task is created normally and the header shows the attachment count. Open the task and
   confirm the agent's first `Read` tool call names a path under `data/uploads/<taskId>/`.
2. **Gate answer.** Wait for a proposal or report gate. Attach a screenshot in the gate card's
   file picker (or drag it onto the box), type a sentence of feedback, and press **Approve with
   changes**. The transcript shows your decision with `(+1 file)`, and the agent's next messages
   include a `Read` call for the new file.
3. **Follow-up.** On a `done`/`failed` task, use the bottom composer ("Request changes or a
   follow-up"): attach a file and press **Send to agent**. It resumes and reads the file.
4. **No-file paths unaffected.** Press the plain **Continue from where it left off** button (no
   text, no files) on a failed task — it still resumes via a plain JSON body, unaffected by the
   `materializeFiles` change (which only runs when there are files).

All four should behave exactly as before this change — the fix is invisible when nothing goes
wrong.

## Diagnostics — the strengthened log

1. With the stack running, send a deliberately malformed multipart request directly:

   ```sh
   curl -s -X POST http://localhost:3001/api/tasks \
     -H 'Content-Type: multipart/form-data' \
     -H 'User-Agent: test-verification-agent/1.0' \
     --data 'not really multipart'
   ```

2. **Expected:** a 400 response with the `BAD_MULTIPART` message, and the server log (`pnpm dev`
   terminal, or `docker logs <container>`) now shows a line like:

   ```
   [uploads] unreadable multipart body — content-type: "multipart/form-data" content-length: "21" user-agent: "test-verification-agent/1.0" - Failed to parse body as FormData
   ```

   Before this change, that line had no `content-length`/`user-agent` fields — confirm they're
   both present and match what `curl` sent.

## Edge / failure case — a rejected request still recovers cleanly

Stop the server (`pnpm stop` / `control-center stop`), then attach a file and press **Run task**
in a tab you already had open. You get the red **"Couldn't send the request — the server might
be unreachable, or an attached file couldn't be read. Check it's still running and try again."**
message and the button returns to "Run task" — not a spinner stuck forever. Start the server
again afterwards. (The same `try`/`catch` that used to only cover a failed `fetch` now also
covers a file that fails to read, which is why the message names both possibilities.)

## What success looks like

Attaching a photo or document at any of the three points delivers it reliably, with no visible
change in behavior from before. If `BAD_MULTIPART` is ever logged again, the log line alone
should be enough to tell whether the declared body length matches what arrived and which
browser/engine sent it — turning "this happened seven times and we never found out why" into an
actionable lead the next time.
