# gotchas

Dated gotcha log: non-obvious traps, environment quirks, and things that cost time.

Part 1 of 2.

<!-- Split out of a single 232 KB `.swe/notes.md` on 2026-08-24, which was read in full at the start of every request (engineering rule 10). Entries are verbatim and in date order; only this header is new. -->

## Gotchas
- **2026-08-11 — never create a FIFO (or other special file) under a bind-mounted path.** While
  testing that the backlog scan refuses non-regular files, I ran `mkfifo` inside
  `/Users/moh/.cc-scan-attack/…` — `/Users` is bind-mounted into the dev container — and it
  **wedged OrbStack's file-sharing layer**: every `docker` call hung (including `docker ps`),
  the `platform` container became unreachable, and every other stack on the machine (portal-*,
  am-workers-*) went down with it. `orbctl status` still said "Running" and `orbctl start` still
  said "ready", which is why it looked like an app bug at first. Recovery: delete the FIFO with
  host tools, `orbctl stop`, reopen `/Applications/OrbStack.app`, then `docker start <name>` each
  container that showed `Exited (255)` (255 = killed by the VM stop, i.e. it *was* running —
  containers stopped earlier show `Exited (0)` with an older timestamp, so the two are easy to
  tell apart). Test special files inside the container's own `/tmp` (the specs do — Node's
  `mkdtempSync(tmpdir())` is container-local, not shared), never under `/Users` or `/Volumes`.
- **2026-08-03 — host-side `pnpm test` fails with an esbuild platform error** — the host
  `node_modules` currently carries `@esbuild/linux-arm64` (tsx can't transform anything).
  Run the gates through the dev container instead: `docker exec platform pnpm test` (and
  same for lint / `npx tsc --noEmit`).
  - **2026-08-11 — but unset `RUNNER_HOST` when you do**: compose sets `RUNNER_HOST=0.0.0.0`
    for the container, and `lib/config.test.ts` asserts the *default* is loopback — so one test
    fails purely from where it ran. `docker exec platform env -u RUNNER_HOST pnpm test` is the
    honest full-suite command (172/172 today).
- **2026-07-31 — `pnpm build` is broken on `main`, independently of any feature work.**
  It compiles and typechecks, then fails exporting Next's internal `/_global-error` page:
  `TypeError: Cannot read properties of null (reading 'useContext')`. Verified by stashing
  all uncommitted work and building a clean tree — same failure — so it is NOT a regression
  from the usage or onboarding changes. CLAUDE.md's old "baseline: ✅" was stale. Use
  `pnpm test` + `pnpm lint` + `npx tsc --noEmit` as the gate until someone fixes the export
  (suspect a React/Next version mismatch in the `/_global-error` boundary, not app code).
- **2026-08-01 — Claude *plan* rate limits are not readable in this app (pm task 05).**
  The SDK's experimental usage API reports plan windows only for a logged-in **profile**;
  a token injected via `Options.env` counts as "missing profile scope". Measured with the
  operator's real subscription token: `accountInfo()` → `{tokenSource:
  "CLAUDE_CODE_OAUTH_TOKEN", apiProvider: "firstParty"}` yet `subscription_type: null` and
  `rate_limits_available: false`; the container has no `~/.claude/.credentials.json` (macOS
  Keychain login doesn't cross the bind mount). **So this is a consequence of task 02's
  design, not a bug** — per-user env tokens are what make limits unreadable. Getting them
  would mean writing per-user credentials to disk, reversing that design, and it collides
  with Anthropic's third-party-auth restrictions. Task 05 therefore shipped as a *combined*
  endpoint: real per-user spend (which works) plus a plan-limits block that honestly reports
  `available: false` and will populate by itself if a future SDK scopes env tokens.
  - The probe spawns a short-lived session (~1.7s) and makes **no model call** — verified
    `session.total_cost_usd === 0`. Cached 60s when available, 10 min when not, and
    de-duplicated per user, so page loads don't spawn subprocesses.
  - The SDK method name is explicitly temporary ("will change when the API is stabilized"),
    so it's feature-detected from a small **allowlist** of names — never a prefix scan, which
    could call an arbitrary method.
  - **90 of 91 tasks here are unowned** (`user_id IS NULL`) because they predate
    `tasks.userId`, so a purely per-user figure reads $0 against $459.61 of real history.
    Hence the `unattributed` bucket in the response. If you want that history to show as
    yours, `UPDATE tasks SET user_id = '<id>' WHERE user_id IS NULL` is correct **only**
    while this instance has a single account — it's a billing-attribution claim, so don't
    run it blind on a multi-user install.
- **2026-07-31 — usage accounting is banked at `result` boundaries only.** A subprocess
  killed mid-turn (runner restart, container stop) never emits a `result`, so its spend is
  unattributable and the task shows $0 despite burning tokens — `task_566f891c` is the
  worked case (1 371 events, 0 result messages). Backfilling can't recover it either, since
  it replays the same events. Accruing per-turn from assistant messages would close the gap
  but overlaps `modelUsage` and needs its own de-duplication; deliberately out of scope.
- **2026-07-31 — a task run against THIS repo kills its own runner.** `pnpm dev:runner` is
  `tsx watch runner/server.ts`, so editing anything in the runner's import graph —
  `lib/db/schema.ts`, `lib/secrets.ts`, `lib/db/index.ts`, `runner/*` — restarts the runner
  and **kills the in-flight SDK session of the very task doing the editing**. Startup
  reconciliation then marks that task `failed` ("Runner restarted while this task was
  active"). Worse, if the edit was mid-flight the runner may not boot at all: task
  `task_566f891c` (pm task 04) added `real("usage_cost_usd")` to `schema.ts` without adding
  `real` to the drizzle import, the watcher restarted the runner, the session died before
  the import was written, and the app went fully down — runner unreachable on :4319 and
  every web route throwing `ReferenceError: real is not defined`. The DB meanwhile still
  said `building`, so the UI couldn't tell whether the task was alive. Symptom to recognise:
  a task stuck in a non-terminal status with `ended_at: null` and no new `task_events`, plus
  502s from `/api/tasks/[id]/*`. **Two agents in one working tree makes this worse** — my
  own edits to `lib/secrets.ts`/`runner/user-env.ts` in the same window were restarting the
  runner too. When dispatching Control Center tasks *at Control Center itself*, expect
  runner restarts, or run that work outside the live dev container.
  - Recovery: fix the broken import, make the DB match the schema, wait for `tsx watch` to
    boot the runner (`fetch localhost:4319/health` inside the container), and let startup
    reconciliation settle the orphaned task.
  - **Adding columns: prefer explicit `ALTER TABLE ADD COLUMN` over `pnpm db:push`** on this
    DB. push has rebuilt the `tasks` table before and silently dropped the `user_id` FK;
    additive DDL touches no data (verified after: `integrity_check ok`, both FKs intact,
    91 tasks).
- **2026-07-31 — review subagents share the live environment; tell them not to mutate it.**
  During this task the operator's real vault entry was clobbered twice mid-review (once
  emptied, once replaced with a different token that decrypted fine but wasn't theirs), and
  a dispatch-guard check spent real subscription quota. `reviewer`/`security-auditor` are
  "read-only" in intent but have Bash against the live repo, DB, and `data/secrets/`.
  **Brief them explicitly:** no writes under `data/`, no DB mutations, no task dispatch,
  throwaway ids (`zz_*`) for any vault probing, and clean up by exact filename. Verify the
  operator's own state again after reviews finish — compare the stored token to the `.env`
  copy, not just "a file exists".
- **2026-07-31 — never point a wildcard `rm` at `data/secrets/`.** During testing the
  owner's real token file was lost from `data/secrets/` between two checks and had to be
  re-written from the `.env` copy. Verified afterwards that the code is *not* at fault:
  `setUserToken` for two users leaves both files intact, `clearUserToken` removes exactly
  one file, and it is the only delete call site in the repo. The most likely cause was a
  `rm -f data/secrets/*.json` used to clean up test users. Clean up test secrets **by
  explicit filename**, and remember `data/secrets/` has no backup — if a file is lost the
  user must re-run `claude setup-token`. (The new `TokenNudge` banner makes this state
  immediately visible instead of surfacing as a failed task.)
- **2026-07-31 — `cd`-ing to a scratch dir makes later relative paths lie.** A
  `ls data/secrets/` in a block that started with `cd $CLAUDE_JOB_DIR/tmp` reported "No
  such file or directory" and briefly looked like data loss. Use absolute paths when
  checking repo state inside a block that changes directory.
- **2026-07-31 — `tasks.user_id` FK is not enforced in the real DB.** drizzle-kit `push`
  adds new referenced columns to an existing SQLite table via `ALTER TABLE ADD COLUMN`,
  which drops the `REFERENCES … ON DELETE SET NULL` clause (confirmed via
  `PRAGMA foreign_key_list(tasks)`). Inert today — nothing deletes `users` rows — but the
  "tasks outlive a deleted user" behavior needs a table rebuild before any user-deletion
  feature ships.
- **2026-07-30 — don't run host-side `sqlite3` dumps/queries against the live WAL DB.**
  A `.dump` from macOS while the container held the WAL open left the container's cached
  connection seeing "database disk image is malformed" (host + container integrity checks
  both said `ok`; a container restart cleared it). Inspect via
  `docker exec platform node -e "…better-sqlite3…"` instead.
- **2026-07-29 — `task_events` corruption + lost auth feature, recovered.** `data/platform.db`
  had a corrupt `task_events` b-tree (`PRAGMA integrity_check` failed on that table only;
  `tasks`/`projects`/`agents` were fine). Fixed via `sqlite3 data/platform.db ".recover" |
  sqlite3 new.db`, verified `integrity_check` + row counts, swapped it in (corrupt original
  kept at `data/backup/`, gitignored). Separately, the entire uncommitted auth feature
  (`lib/auth.ts`, `app/(auth)/`, `app/api/auth/`, `proxy.ts`, …) had been wiped from disk —
  `git reflog` showed two `git reset` events (an IDE "Discard All Changes") after the branch
  was checked out; since those files were untracked, discard deleted them with no git history
  to recover from. Rebuilt from scratch. **Lesson: commit auth/security work incrementally,
  don't let it sit uncommitted+untracked.**
  - Hardened `proxy.ts`: `verifySessionToken()` is now wrapped in try/catch inside the
    middleware. Found by accident — a transient SQLite I/O error on the macOS bind mount
    (see below) threw inside `proxy()`, and Next's default behavior on an uncaught middleware
    exception is to serve the request anyway. That's a fail-*open* auth gate. Now any error
    is treated as "no session" (fail closed).
  - **Security review (blocking, both fixed):** the `security-auditor` found (1) `signin`
    short-circuited `verifyPassword` via `!user || !verifyPassword(...)` — since a nonexistent
    email skips the ~27ms scrypt call entirely, response time leaked account existence. Fixed
    by always calling `verifyPassword` against a constant `DUMMY_HASH` when there's no user.
    (2) no password length cap + no rate limiting → an unauthenticated attacker could send a
    huge password to force expensive scrypt work, or brute-force with no throttle. Fixed:
    `.max(256)` on both password schemas, plus `lib/rate-limit.ts` (in-memory fixed-window,
    10/min on signin+signup, 30/min on signout).
    - **Caveat:** `clientIp()` reads `x-forwarded-for`, but this app has no reverse proxy in
      front (Docker binds straight to `127.0.0.1`) so that header is never set — every client
      falls into one shared `"unknown"` bucket per route. Still strictly better than no limit
      (bounds total request rate to the endpoint), but it isn't per-client throttling. If a
      reverse proxy is ever added in front of this app, make sure it sets `x-forwarded-for`.
  - **Turbopack dev cache is fragile here.** Hit two distinct corruption modes on
    `platform_platform_next` (the `.next` named volume): (1) RocksDB-style "Persisting
    failed: Another write batch or compaction is already active" panics after concurrent
    route compiles: (2) a parser bailing on a file (`proxy.ts`) with `Unexpected token <eof>`
    at a byte offset from a *previous* version of the file, surviving even a full container
    restart — an incremental-reparse bug, not a real syntax error (confirmed byte-for-byte
    correct on disk both from the host and via `docker exec cat`). Fix for both: stop the
    container, wipe the volume (`docker run --rm -v platform_platform_next:/target alpine sh
    -c "rm -rf /target/* /target/.[!.]*"`), start again — `.next` is a pure cache, safe to
    nuke. Don't run a second Next process (e.g. a comparison build in a worktree) against the
    same DB/cache while the main dev server is live.
- **Never bind-mount host `node_modules` into the linux container** — `better-sqlite3` is
  compiled for the host (macOS/arm); the container needs its own linux build. We mask
  `node_modules` (and `.next`) with anonymous volumes so the in-image install wins.
- WAL SQLite over a macOS bind-mount can have locking quirks; acceptable for dev.
- `next dev` must bind `0.0.0.0` (`-H 0.0.0.0`) to be reachable from the host when in a
  container — but only inside the container (`dev:container`), never the native scripts.
- Empty Docker **named volumes inherit the ownership** of the image dir at their mount point,
  so `chown -R node:node /app` in the Dockerfile (before `USER node`) lets the non-root
  process write to the `node_modules`/`.next` volumes. Don't forget the `chown` if adding a
  new volume-masked path.
- **`pnpm build` can't fully run outside the container** — it compiles and typechecks fine,
  then dies at "Collecting page data" with `invalid ELF header` on `better-sqlite3` (the
  host's macOS binary). So the honest local gate is: `pnpm lint` + `npx tsc --noEmit` +
  `pnpm build` reaching "Finished TypeScript", then smoke-testing routes against the
  container's dev server on :3001. Don't report a green build from outside Docker.
- **Theme/sidebar state must not live in React state.** Reading `localStorage` in an effect
  and calling `setState` trips this project's hard `react-hooks/set-state-in-effect` error
  *and* flashes the wrong theme. The pattern here: a blocking `<head>` script writes
  `class`/`data-*` onto `<html>` pre-paint, and components read it with
  `useSyncExternalStore`. `<html>` needs `suppressHydrationWarning`.
- **Tailwind v4 sorts variant utilities after plain ones**, so `w-60 rail:w-16` resolves
  correctly even though `@custom-variant rail (&:where(...))` has zero added specificity.
  Verified in the compiled CSS (`rail:w-16` emitted after `w-60`).
- Tailwind v4 **does** support fractional spacing like `size-4.5` (dynamic spacing scale) —
  it compiles to `1.125rem`. Grepping the built CSS for it needs the escaped form `size-4\\.5`.

- **2026-08-12 — explicit `busy_timeout` on the shared SQLite connection** (pm task
  `01-backend-sqlite-busy-timeout`, `.pm/tasks/20260812-191427-fix-update-build-sqlite-lock/`).
  `control-center update` / a fresh `install.sh` install could fail mid-`next build` with
  `SqliteError: database is locked`: both scripts run `next build` *before*
  `runner/migrate.ts`, so at build time `platform.db` doesn't exist yet, and Next's parallel
  build workers all import `lib/db` (33+ route modules) during "Collecting page data" —
  several race to create/WAL-convert the same brand-new file at once.
  - Fix: `lib/db/index.ts`'s `createConnection()` now sets `sqlite.pragma("busy_timeout =
    8000")` before `journal_mode = WAL`. **Nuance found while investigating:** `better-sqlite3`
    (pinned `^12.11.1`) already applies an *implicit* `sqlite3_busy_timeout(db, 5000)` at
    connection-open by default (`node_modules/better-sqlite3/lib/database.js:34`,
    `src/objects/database.cpp:172`) — confirmed empirically too: 20 concurrent opens against a
    fresh file, unpatched, produced zero SQLITE_BUSY failures inside the dev container. So the
    fix's value is making the timeout an explicit, visible, intentional setting in our own
    code (and picking a value provably above the library default, so a test can actually catch
    the pragma being dropped) rather than silently depending on an undocumented default that
    could change with a dependency bump.
  - Verified against the spec's exact repro: `NODE_ENV=production PLATFORM_DATA_DIR=<fresh
    dir> next build` inside the container completed cleanly (7 workers, 6/6 static pages, exit
    0) against a directory with no pre-existing `platform.db`.
  - New test `lib/db.test.ts` — **not** `lib/db/index.test.ts`: the `test` script's globs
    (`lib/*.test.ts`, not `lib/db/*.test.ts`) are exact, so a spec under `lib/db/` would
    silently never run (this exact trap is already documented in CLAUDE.md). Asserts
    `db.$client.pragma("busy_timeout", { simple: true }) > 5000` — deliberately above the
    library default so the test fails if the pragma line is ever deleted, not a tautology that
    passes either way.
  - **Both independent reviews (reviewer + security-auditor) passed with no blocking
    findings**, and both surfaced the same non-blocking trade-off worth recording: the pragma
    applies to the one shared singleton connection every request and the runner's task
    subprocess use, not only the one-time build path. better-sqlite3 is fully synchronous, so
    a busy-wait blocks the whole Node main thread — raising the ceiling from the previous
    implicit ~5s to 8s means any live lock contention (e.g. the runner writing task_events
    while a web request reads, or a `VACUUM INTO` backup snapshot in flight) now stalls the
    *entire* server for up to 3s longer than before. Accepted as-is, not scoped to
    build-time-only: the app is loopback-only, the increase is modest, and this stall class
    already existed pre-fix. Flagged here rather than fixed, per both reviewers' non-blocking
    verdict.

- **2026-08-12 — `control-center status`/`running()` now checks both `web` and `runner`**
  (pm task `03-devops-status-liveness-check`, same
  `.pm/tasks/20260812-191427-fix-update-build-sqlite-lock/` epic as the busy_timeout fix above,
  independent — `depends_on: []`). `running()` used to be `pid_of web` only, so `status` could
  print "Stopped" while `runner` (holding its own connection to the production database) was
  still alive, and `cmd_start`'s already-running guard could spawn a duplicate `web`+`runner`
  pair alongside an orphaned live `runner`.
  - Fix: `running()` is now `pid_of web || pid_of runner`. `status` reports each process
    independently (`Running` / `Partially running — <which one>` / `Stopped`). `cmd_start`'s
    guard only no-ops when *both* are alive; if only one is, it `die`s naming which pid is up
    and telling the operator to `stop` then `start`, instead of silently double-spawning.
  - **`wait_for_http` deliberately was *not* switched to the broadened `running()`** — it's
    waiting specifically for the just-spawned `web` process to answer HTTP, and checks
    `pid_of web` directly. Broadening it there would have been a silent regression: a dead
    `web` next to a live orphaned `runner` would then wait the full `$WAIT_TIMEOUT` (180s)
    instead of failing fast with the web log tail.
  - The broadened `running()` also fixes two latent bugs at its other call sites for free:
    `import` now correctly `stop_all`s (and thus closes the DB) when only `runner` was
    orphaned, instead of running `runner/import.ts` while the live runner still held the
    connection open; `update`'s `was_running` bookkeeping no longer misses a runner-only state
    and skips restarting after applying an update.
  - No automated test harness covered this script at the time (`infra/release/*.sh` was outside
    `pnpm test`'s globs — since 2026-08-18, `infra/release/control-center.test.ts` covers the
    update lock, and the glob is wired in). Verified manually: fake pid files pointing at real backgrounded `sleep`
    PIDs (alive) and a nonexistent pid (dead), covering all four states, against `status` and
    `start --no-update`; both independent reviews (reviewer + security-auditor) reproduced the
    same manual verification independently and passed with no blocking findings. Non-blocking
    notes from both, left as-is per their own verdict: `pid_of`'s `kill -0` check doesn't
    verify process *identity* (pre-existing, not introduced here — a stale pid file whose
    number gets reused by an unrelated process would still read as "alive"); `status` always
    exits 0 regardless of state (matches prior behavior, not a regression).

- **2026-08-13 — five requests in one task: backlog titles, uploads, skills, skill order, and
  agent-filed work.** The interesting half is the upload one, because the reported bug did not
  reproduce and the investigation is worth more than the fix.
  - **Backlog runs no longer pay for a title.** `DispatchInput.title` → the row, and the runner
    only names a task whose row has none (`if (!resume && !task.title)`), so passing the item's
    own title through suppresses the Haiku call by construction rather than by a new flag.
  - **"I can't send a request after attaching a photo" could not be reproduced, and here is
    what was tried** (all against the *installed* app on :7373, since that's what the user
    runs — `~/.control-center` is a different database and a production build):
    - `curl` multipart at 18 B / 1 MB / 8 MB / 24 MB → all parsed and saved. No body-size limit,
      no permission problem, no `PLATFORM_DATA_DIR` issue.
    - Chrome driven over CDP against the *real* project page: attached a 1.8 MB PNG via
      `DOM.setFileInputFiles`, the chip rendered, pressed **Run task**, and intercepted the
      request with the `Fetch` domain — a correct
      `multipart/form-data; boundary=----WebKitFormBoundary…`, then aborted so nothing
      dispatched. This is the cheapest way to inspect what the real UI sends without paying for
      a run; keep `/tmp/wk-test/cdp.mjs`'s shape in mind next time.
    - A **WKWebView replica of the Mac app**, compiled with `swiftc` (~40 lines, same
      `runOpenPanelWith` delegate, auto-answering with a file URL): the open panel fires for a
      `display:none` input, the chip appears on the real page, and a separate probe posted a
      disk-backed 1.8 MB photo with a proper boundary. So WebKit is not the problem — including
      the two things that looked most suspicious (a hidden input, and a File backed by a real
      file rather than constructed in JS).
  - **What the logs did show: 7 × `TypeError: Failed to parse body as FormData` → `no boundary
    found in multipart body`** in `~/.control-center/logs/web.log`. An unhandled throw in a
    route handler is an HTML 500, so the composer's `res.json()` yielded `{}` and the user saw
    a bare "Failed to dispatch task". The cause of *those seven* is unknown — possibly an
    earlier agent's hand-written `curl -H 'Content-Type: multipart/form-data'`, since a browser
    always emits a boundary. Note the production server (`next start`) logs no request lines,
    so there is nothing to correlate them against; don't expect to.
  - Fixed what was actually defective rather than guessing: `readFormData` (400 + the offending
    content-type logged, never a 500), the client sending multipart **only** when there are
    files (the plain Continue button was posting an empty `FormData`), and `NewTaskForm`
    catching a rejected `fetch` — it didn't, so a network error left the button spinning on
    "Dispatching…" forever with no message, which is itself a faithful description of "I can't
    send the request".
  - **The real gap, and the likeliest thing the user hit: you could not attach anything to a
    task that was still running.** The composer with the attach button only renders on a
    terminal task, and the gate feedback box was text-only — so at a proposal/report gate, the
    one moment the agent is listening, a screenshot had nowhere to go. `respond` now takes
    multipart and appends the saved paths to the feedback via `attachmentNote`. Only
    server-written paths are appended; a client-supplied path there would be an
    arbitrary-file-read primitive aimed at the agent.
  - **`ONBOARD_MARKERS` became load-bearing.** Hiding `onboard` once an agent is onboarded means
    a namespace with no marker (it reads as "always onboarded") would never offer onboarding at
    all — pm was in that state, so it got `.pm/notes.md`. A "Re-onboard /ns" link keeps a
    deliberate refresh reachable.
  - **`orderSkills` lives in `lib/ui.ts`, not in the component**, purely so `pnpm test` sees it:
    the test script's globs are exact (`lib/*.test.ts`), and ordering logic inside a `.tsx` is
    untestable here. Verified in the browser too, since a unit test can't prove the picker uses
    it: fe renders task, fix, audit, review, plan, ship; swe task, fix, security, review, plan,
    ship, workspace; pm just plan; and Re-onboard reveals + selects `onboard`.
  - **The agent-side dedupe I planned already existed** (`openItemWithTitle` in
    `runner/backlog-tool.ts`), so "re-running `/swe:plan` shouldn't double-file" needed no code —
    only the rule text telling `plan` to file its tasks in the first place. Check that file
    before adding a guard to it.
  - Agent rule edits go in the **source checkouts** (`../swe-agent`, `../fe-agent` — neither is
    a git repo, so nothing to commit there) and then `pnpm agents:sync` to refresh `agents/`.
    Both plan commands, both review commands, `swe:security`, the fe audit procedure and both
    workflows' report gates now say to file out-of-scope findings, and to use `assignee: "pm"`
    for anything the agent couldn't scope.
  - Probes that touch real state must be cleaned up **by exact name**: this task created
    `task_zz_probe` plus `data/uploads/task_zz_probe/` in the dev DB and three upload dirs in the
    *installed* data dir, and removed each one explicitly (`data/uploads` back to 11 dirs, no
    `task_zz%` rows). Never a wildcard `rm` under `data/`.
  - **The security review's one blocking finding, worth remembering as a class:** the new
    multipart branch on `POST /api/tasks/[id]/respond` wrote files for *any* owned task, with no
    check that a gate was pending — so it was a disk-fill primitive that needed no agent turn
    and no state transition, i.e. cheaper than the `continue` path it was modelled on (which at
    least requires a terminal task and starts a session). Fixed two ways: files are refused
    (409) unless the row is `awaiting_proposal`/`awaiting_report`, and `saveAttachments` now
    takes the task's existing attachments and enforces **cumulative** ceilings
    (`MAX_TASK_FILES` 30, `MAX_TASK_BYTES` 100 MB). The general lesson: a per-request cap bounds
    one request, never a sequence, and "the existing endpoint does it this way" is not a bound —
    ask what the *cheapest repeatable* call costs the disk. Verified by curl in all three
    states (non-gated + files → 409 and nothing written; gated + files → saved; non-gated
    text-only → unchanged passthrough).
  - The correctness review's two worth-fixing notes: `cleanTitle` sliced UTF-16 units, so a
    title ending in an emoji truncated mid-surrogate-pair and would render a replacement
    character in every task list (now cut by code point); and a gate answer that failed to send
    cleared the card optimistically, losing the typed feedback *and* the attached screenshot —
    it now removes its own decision bubble and puts the gate, the text and the files back.
  - Known and accepted after the re-review (non-blocking, from the auditor): the gate check and
    the cumulative caps both read `task.status`/`task.attachments` once per request, so two
    *concurrent* `respond` calls against the same open gate can each pass against the same
    snapshot and write one batch apiece. That bounds an overrun to a few extra batches under
    deliberate concurrency — not the unbounded loop it replaced. Closing it properly means the
    read and the write in one transaction; not worth it for a loopback app today.
