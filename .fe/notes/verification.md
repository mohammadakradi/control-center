# verification

How to actually look at a page in this app: throwaway DBs, CDP, headless Chrome flags.

<!-- Split out of a single 79 KB `.fe/notes.md` on 2026-08-24, which was read in full at the start of every request (frontend rule 10). Entries are verbatim; only this header is new. -->

## Verifying a page without touching the live DB
Better than seeding a session into `data/platform.db` (which has corrupted twice — see the
root memory): run a second instance against a throwaway file —
`PLATFORM_DB=/tmp/x.db npx next dev --port 3099`, `POST /api/auth/signup` for a cookie, then
curl the pages. Fully isolated, and you can seed tasks/spend freely to see populated states.

## Verifying rendered pages without a browser
There's no Playwright/Puppeteer here. To check real markup: mint a session row directly (`sessions.id = sha256(token)`, see `lib/auth.ts`), `curl -H "Cookie: session=<token>" http://localhost:3001/…`, inspect the HTML, then delete the session row. Client-only branches still render, because App Router SSRs client components — temporarily seeding a `useState` initial value is enough to see them.

## Verifying a page: `next start` on a throwaway DB, not a second `next dev`
The documented recipe (`PLATFORM_DB=/tmp/x.db npx next dev --port 3099`) **dies when the dev
container is already running** — two `next dev` processes fight over `.next/`, and the second
exits silently, so you get connection-refused and no error anywhere. Use the production build
instead: `pnpm build` once, then
`docker exec -d platform sh -c 'PLATFORM_DB=/tmp/x.db npx next start -H 0.0.0.0 -p 3099 > /tmp/log 2>&1'`
and curl from inside the container. `next start` only reads `.next`, so it can't disturb the
dev server, and it's what installs actually run. Two container gotchas: **`ps`, `pkill` and
`kill` don't exist** in the image (walk `/proc/*/cmdline` and use the shell builtin via
`sh -c 'kill <pid>'`), and no session cookie is needed at all — `getCurrentUser()` inserts and
returns `user_local` when there's no session, so seeding tasks with `user_id = 'user_local'`
makes them visible.

**Killing that server needs the right pattern, or you verify a stale build.** `next start`
renames its process to `next-server (v16.2.9)` — the port is *gone* from its cmdline — so
walking `/proc/*/cmdline` for the port number only finds the `sh`/`npm exec` wrappers. Kill
those and the real server keeps the port, the next launch can't bind, and you spend a while
wondering why a rebuilt page still renders the old markup (this cost me a round trip: a Run
button kept rendering at its pre-fix size). Match `*next-server*` as well — and take care not to
kill the container's own dev server, which is the low-PID one of the same name.

## Headless Chrome screenshots of this app need `--virtual-time-budget` (2026-08-13)
`--headless=new --screenshot` waits for the load event, and pages here hold open connections
(`ActivityBadge` polls, `UpdateBanner` fetches `/api/updates`, which reaches out to the GitHub
Releases API and can hang for minutes offline). Chrome then never exits and the shell call
times out with no file written. Add `--virtual-time-budget=5000` and background the process
with a hard `kill -9` fallback. macOS has no `timeout(1)` — that's coreutils' `gtimeout`.

## Driving a real browser: use CDP, not `--screenshot` (2026-08-20)
**Supersedes half of the "Verifying a modal without a browser" note below.** That note's
warning is real — macOS Chrome clamps a `--window-size=390` headless window to a **500px**
minimum layout width, so mobile screenshots silently render at 500 and crop. But the
conclusion drawn from it ("check your viewport is real, screenshot a centred layout") is
working around the wrong tool. Chrome's DevTools Protocol has no such clamp, and Node 22+ ships
a global `WebSocket`, so a **~60-line dependency-free CDP driver** gets you the whole thing:
`Emulation.setDeviceMetricsOverride` honours 390px exactly (verified: `innerWidth` reports 390,
not 500), `Emulation.setEmulatedMedia` flips `prefers-color-scheme` so **dark mode needs no
`localStorage` seeding**, and `Runtime.evaluate` lets you *click real controls* and read values
back — so a modal no longer has to be verified by temporarily seeding its `useState`.

What that bought on this task, none of which static reasoning would have caught:
- focus **stays on the Next button** across a file change (the `key={path}` remount could have
  dropped it — this project's `UpdateBanner` note is emphatic that focus claims must be
  measured, and it was right);
- the focus trap's tab order and both wrap directions, read out of the live DOM;
- `scrollWidth` vs `clientWidth` at 390px, which is how you prove "no horizontal overflow"
  rather than squinting at a screenshot;
- a **DOM node count** (3 vs ~300 000) as the proof that a perf guard fires.

Keep `--virtual-time-budget` in mind for the plain `--screenshot` path (see the 2026-08-13
note) — with CDP you don't need it, because you control when the shot is taken.
