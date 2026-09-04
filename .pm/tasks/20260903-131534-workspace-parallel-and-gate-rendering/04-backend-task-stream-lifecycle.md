---
title: Close the task event stream, and keep it alive while a run is quiet
stack: backend
assignee: swe
priority: P1
depends_on: []
---

# Close the task event stream, and keep it alive while a run is quiet

## Issue
Two independent transport defects make the task page claim a run is live when it isn't, and drop
events while it is.

1. **No graceful close.** The stream handler's cold path explicitly sends
   `event: "closed"` (`runner/server.ts:124`); the live path just breaks and returns
   (`:128-145`), so the browser sees a plain EOF and `EventSource` auto-reconnects
   (`components/TaskLiveView.tsx:383-387`). Within the 60 s post-`finalize` grace window
   (`runner/session-manager.ts:1023-1028`) `getHandle` still returns the finished handle, so the
   reconnect takes the **live** path — the one path that never emits `closed` — and parks on a
   promise that will never resolve. The connection hangs open indefinitely.
2. **No heartbeat vs. a 300 s body timeout.** The Next→runner proxy is a bare `fetch` with no
   dispatcher (`app/api/tasks/[id]/stream/route.ts:26-31`), so undici's default
   `bodyTimeout` of 300 s applies, and the runner writes nothing between real events. Any quiet
   stretch over five minutes — a long build, a test run, or the model just reasoning — kills the
   pipe. The install's `web.log` holds **224 occurrences** of
   `failed to pipe response → TypeError: terminated → BodyTimeoutError (UND_ERR_BODY_TIMEOUT)`,
   and zero header timeouts, which is the signature of an idle body rather than a bad connection.

## Goal
A finished run's stream closes cleanly and stays closed; a long quiet stretch mid-run does not
break the stream; and a client that does reconnect always receives the terminal frame it missed.

## Suggested solution
Emit `event: "closed"` on the live path before returning, exactly as the cold path already does —
that alone closes the reconnect loophole. Add a periodic keep-alive comment from the runner's
stream handler at an interval comfortably under 300 s, and/or give the proxy `fetch` an undici
dispatcher with `bodyTimeout: 0`; the heartbeat is the more general fix since it also keeps any
intermediary from timing out. Make the reconnect path safe regardless: a request for a task whose
handle is already `done` should replay from the `after` cursor and then close, never attach a
listener. Events are already persisted before being emitted, so the durable record is intact —
this is purely about delivery and about not lying to the client.

## Affected areas
- `runner/server.ts:60-146` — the `/tasks/:id/stream` handler: the live branch (`:128-145`), the
  cold branch's `closed` frame (`:124`), and the new heartbeat
- `app/api/tasks/[id]/stream/route.ts:26-31` — the proxy `fetch` and its dispatcher/timeout
- `runner/session-manager.ts:1023-1028` — the 60 s handle grace window that makes a finished
  handle still resolvable
- Features affected: the task page's live transcript, the live/reconnecting/ended indicator
  (consumed by task 06), and `router.refresh()` on run end
