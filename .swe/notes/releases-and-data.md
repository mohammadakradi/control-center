# releases and data

How someone gets and updates the software: the release workflow, `install.sh`, the update lock, export/import, and the Settings → Data operations.

<!-- Moved out of CLAUDE.md on 2026-08-24 to bring it inside its 20 KB budget (engineering rule 7). Content is verbatim; only the heading level and this header are new. -->

## Releases, installing, and updating
Two separate things, easy to confuse: **this section** is how someone *gets* the software; the
next one is how the running dashboard behaves like a desktop app. A user needs both.

Releases install **natively — Node.js 22+, no Docker.** Docker is only the development runtime;
there is intentionally no published image and no `release` stage in the Dockerfile.
- **`package.json` `version` is the source of truth.** To cut a release: bump it, commit, tag
  (`v0.2.0` or `0.2.0` — both accepted), push the tag, then **publish the release on GitHub**.
  Publishing is the trigger (`release: published`), not the tag push, so a tag alone ships
  nothing. `.github/workflows/release.yml` refuses when the tag and `package.json` disagree,
  because the *installed* version is read from `package.json` (that's what `control-center
  version` and the in-app update check report). A run that failed can be re-run from Actions →
  Release → "Run workflow" with the tag as input; publishing is idempotent (assets are
  re-uploaded with `--clobber`, and hand-written release notes are left alone).
- **The workflow** runs typecheck + lint + test, verifies `drizzle/` covers the schema (it
  re-runs `db:generate` and fails if that produces anything), builds the tarball with
  `infra/release/pack.sh`, asserts the tarball carries no local state, and publishes a release
  with three assets: `control-center-<version>.tar.gz`, `install.sh`, `SHA256SUMS`. It also runs
  `pnpm build`, so a release can't ship source that doesn't build — the tarball is source, and
  the build happens on the user's machine where a failure would be theirs to discover.
- **Shell scripts in `infra/release/` must survive bash 3.2** — that's what `/bin/sh` is on
  macOS, and it swallows a UTF-8 character placed directly after `$VAR` into the variable
  name (`$REPO…` → `REPO…: unbound variable`). It shipped in v0.1.0 and killed the installer
  on its third line. Brace them: `${REPO}…`. `pack.sh` now refuses to build if the pattern
  reappears, using `LC_ALL=C grep -E` — **not** `grep -P`, which BSD grep answers with exit 2,
  which an `if` reads as "no match" (the first version of that guard passed by being broken).
  Linux CI can't catch this class at all, so the packaging check is the only line of defence.
- **`pack.sh` uses an allowlist, never an exclude list.** This repo keeps a SQLite database, an
  encrypted token vault and `.env` files beside the source, so "ship only these paths" is the
  only safe direction. It hard-fails if a listed path was renamed. `pnpm release:pack` builds
  one locally into `dist/` to inspect.
- **Install:** download `install.sh` from the release page and run it. It checks Node ≥ 22,
  downloads and checksums the tarball, installs deps with `npx pnpm@9.12.1` (no global pnpm
  needed; `better-sqlite3` pulls a prebuilt binary, so no compiler), unpacks into
  `~/.control-center/app`, generates `~/.control-center/.env` with a fresh
  `SECRETS_MASTER_KEY`, creates the database from the schema, and drops a `control-center`
  command into `~/.local/bin`.
- **Update:** `control-center start` asks the GitHub Releases API for the latest tag, and if
  it's newer, downloads → verifies → installs deps → stops → backs up the DB → swaps
  `app/` (keeping the old one at `app.old`) → starts. Everything happens in a temp dir first,
  so a failure leaves the working install untouched. `control-center update` does it on demand.
- **Layout under `~/.control-center`:** `app/` (replaced wholesale on update), `data/`
  (SQLite + token vault + uploads — *never* touched by an update), `logs/`, `run/` (pid files),
  `.env`. The data directory lives outside `app/` precisely so updates can't take it with them;
  `PLATFORM_DATA_DIR` is what points the app at it (`lib/config.ts`, `lib/db`, and
  `drizzle.config.ts` all honour it, so a manual `db:push` can't create a second database).
- **Installs run a production build, not the dev server.** `install.sh` and `control-center
  update` run `pnpm build` (in the temp dir, so a failed build leaves the working install
  untouched), and `start` serves it with `next start`. `start` also builds if `.next/BUILD_ID`
  is missing — that's the marker for *production* output specifically, since a `.next` left by
  `next dev` has none, and it's how an install updated by an older `control-center` heals
  itself. Shipping `next dev` was a workaround for the build being thought unfixable; it cost
  a dev-tools badge in the window and a compile pause on every first visit to a page.
- **`update` refreshes `~/.local/bin/control-center` too.** It lives outside `app/`, so
  replacing `app/` used to leave the command frozen at whatever version first installed it —
  every change to ports, or to how the server starts, would reach nobody who updates. It's
  written temp-then-`mv`, because `sh` reads a script incrementally and overwriting the running
  file in place feeds it garbage.
- **The dashboard binds `127.0.0.1`, on 7373 (runner 7374).** It was on every interface, so the
  whole thing — which dispatches agents with your token against your files — was reachable from
  the local network. The runner had it worse: `@hono/node-server` binds all interfaces when no
  hostname is passed, and the runner has no auth of its own. Containers set `RUNNER_HOST=0.0.0.0`
  because binding loopback *inside* a container makes Docker's published port unreachable; the
  publish itself is 127.0.0.1-only. The ports moved off 3001/4319 so an install and the dev
  container stop fighting over the same numbers — that clash silently pointed the Mac app at the
  dev server.
- **The session cookie's `Secure` flag is keyed to `CC_HTTPS`, not `NODE_ENV`.** It looks wrong
  and isn't: the dashboard is plain http on loopback, and `Secure` on an http origin means
  "never send this cookie" in WebKit — so the Mac app's sign-in would have broken silently the
  moment releases switched to a production build.
- **The app still doesn't update itself — but the banner has a button.** `POST
  /api/updates/apply` hands the work to a **detached** `control-center update`, the same shape
  as uninstall, because applying an update replaces the files of the process that would be
  applying it. `CC_NO_OPEN=1`, or the restart opens a second window next to the one that asked.
  The banner then polls `/api/updates` until the reported version *changes* — a liveness check
  would pass instantly, since the old server is still up for a moment after the request — and
  reloads. It refuses while a task is running unless forced (the restart ends the session, and
  the runner fails every non-terminal task it finds on boot), and refuses in a checkout, where
  `git pull` is the answer. Still no Docker socket anywhere.
- **A release is only *offered* once its tarball exists, and that fixed a bug every release
  had.** `.github/workflows/release.yml` triggers on `release: published` but uploads the assets
  at the very **end** of the run — after typecheck, lint, test, `next build` and `pack.sh`. For
  those minutes `/releases/latest` reports the new tag while `control-center-<v>.tar.gz` does
  not exist, so `apply_update`'s `curl` 404'd and the banner reported a failed update. Both
  halves now gate on the asset: `isInstallable`/`releaseTarball` (`lib/updates.ts`) check
  `assets[]`, and `fetch_latest_release` (`infra/release/control-center.sh`) greps the payload
  with `grep -qF` (fixed string, because `CC_REPO` can name a fork whose tag is not ours; also
  never `grep -P`, which BSD grep answers with exit 2 — a failure an `if` reads as "no match").
  Four details are load-bearing:
  - **The shell gate is anchored on the unescaped `"browser_download_url": "` key, and JSON
    escaping is what makes that sound.** There is no `jq` here, so it greps the *whole* payload —
    which includes the release **body** (a generated changelog for us, arbitrary text for a fork).
    Two weaker versions were both spoofed from that body by the security audit: the bare filename,
    then the bare download URL. The key form can't be forged because every quote inside a JSON
    string arrives as `\"`, so a body quoting this key never carries the bare quotes the pattern
    needs. Both `": "` and `":"` spacings are tried, since the anchor now depends on GitHub's
    formatting and a compacted payload would otherwise refuse every update forever. The URL is
    built from `$REPO`, so an asset pointing at a *different* repo isn't evidence either.
  - **The asset check runs *after* the version compare, not before.** Screening in
    `fetch_latest_release` made an *older* assetless release read as "still publishing" instead
    of "you're already up to date", and `update` exited 1 where it used to exit 0. A spec pins
    it; the fixture that caught it is the suite's own `up-to-date` curl stub.
  - **`fetch_latest_release` sets globals and prints nothing**, because `x=$(f)` runs `f` in a
    subshell where an assigned global can't escape. The first cut returned the tag on stdout and
    every caller read a stale flag.
  - **A missing `assets` array reads as not-installable**, not as "assume fine": a real payload
    always carries it, and a release published without our tarball genuinely has nothing to
    fetch. `unavailable: "publishing"` is the reason code, and it gets its own 2-minute cache
    TTL because it is the one state that resolves itself.
- **A failed update never stops the app from starting** (`check_and_update`). `apply_update` ends
  in `die` and `die` exits the script, so on the `start` path a bad download meant the server
  simply never came up — much worse than being a version behind, and it needed no attacker (a
  flaky network during the download did it; the security audit reached it deliberately by pointing
  `CC_REPO` at a fork whose release notes forged the asset). The attempt now runs in a subshell,
  so its exit ends the attempt and not the launch; the lock is released and the app starts on what
  is already installed. **`control-center update` keeps the fatal behaviour on purpose** — a
  command whose whole job is to update must exit non-zero when it couldn't. Both halves are spec'd.
- **`checkForUpdate` coalesces concurrent callers behind one in-flight promise**, and that — not
  the cache — is what makes `FORCE_FLOOR_MS` real. The cache is only written *after* a fetch
  resolves, so N calls inside that window all saw an empty cache and all went to GitHub: the floor
  was bypassable by concurrency rather than by patience (`for i in $(seq 60); do curl
  '…?force=1' & done` burnt the whole hourly budget in one burst). The floor is **2 minutes**, not
  1, because 60s exactly matched GitHub's 60/hour budget and left no headroom. `resetUpdateCache`
  bumps a `generation` counter so an answer already on the wire can't repopulate a dropped cache.
- **Nothing re-checked, which is why several releases went unseen.** `UpdateBanner` fetched
  `/api/updates` exactly once, on mount — and it mounts in `app/(app)/layout.tsx`, a persistent
  App Router layout that client-side navigation never remounts. On a window left open (which is
  what the Mac app *is*) the check happened when the window opened and never again. Now: the
  server's OK cache is **30 minutes** (was six hours), and the banner re-checks on an interval
  **and** on `visibilitychange`/`focus`, so a window buried for days is current by the time it's
  read. `shouldRecheck` (`lib/update-ui.ts`) owns both floors and is spec'd, since `pnpm test`
  can't reach `components/`. A negative age (two clocks) reads as "recent" and holds — the
  direction that can't produce a request loop.
- **The launcher's check is still skipped when the Mac app attaches to a live server**, and that
  is deliberately *not* fixed here. `control-center start` is what runs `check_and_update`, and
  `ControlCenter.swift` only calls it when nothing already answers on 7373/3001 — so a server
  someone started from a terminal never gets checked. Making the attach path update would apply
  a release unattended while the window is loading, which is the same class of surprise the
  in-app banner exists to avoid. With the poll above, the window tells you and you choose.
- **`GET /api/updates?force=1` backs a "Check now", and it has a 60-second floor.**
  `FORCE_FLOOR_MS` in `checkForUpdate`, not in the route, because that route has **no auth** and
  is reachable over loopback from inside the container where a task's Bash tool runs (the gap
  documented for the backlog routes). Without a floor, forcing is a primitive for burning the
  unauthenticated 60-requests-per-hour GitHub budget, after which every user's honest check
  answers `rate-limited`. Serving the cache inside the floor is honest rather than a refusal —
  the answer is seconds old, and `checkedAt` is on screen so the UI can say so. Only exactly
  `"1"` forces, so a stray `?force=` isn't truthy.
- **`components/VersionSettings.tsx` (Settings → Version) is where "am I current?" is
  answerable.** The banner only renders when there is something to *install*, which is right but
  left the quiet states — offline, rate-limited, mid-publish, a git checkout — with no surface at
  all. `versionSummary` (`lib/update-ui.ts`) has a sentence for every one, spec'd exhaustively,
  and `publishing` is spelled out rather than hidden: someone who just read the release
  announcement and finds nothing offered would otherwise conclude the check is broken.
- **One update at a time, enforced in the script, not just the route.** `apply_update()` is
  reachable from `update` *and* from `check_and_update()` on the `start` path, so "click
  Update, quit the app, reopen it" used to put two swaps on the same `app/` — the route's
  `readUpdateRun()` refusal only covers button-vs-button. Both entry points now take
  `run/update.lock` (a `mkdir` directory whose `owner` file holds `pid startedAt`), and `start`
  refuses outright while another process holds it live — the in-flight update restarts the
  server itself. **The O_EXCL creation of `owner` (`set -C`), not the `mkdir`, is the real
  mutual-exclusion token**: the `mkdir`-then-write gap let a racer reclaim the not-yet-populated
  directory and both callers win (~46% under a reviewer's concurrency test), so the owner write
  fails rather than clobbers when a directory is reclaimed under it — which also stops a symlink
  planted at `owner` from redirecting the write onto `~/.control-center/.env`. Reclaim is
  verify-after-`mv` (move the dead lock aside atomically, re-judge that copy, and put back a copy
  that turns out to be live rather than dropping it) so a delayed reclaimer can't destroy a
  freshly re-acquired live lock and double-acquire. Staleness matches
  the status reader's rules (dead pid, or age outside −5 min … 1 h); an ownerless/malformed lock
  is *not* stale (a racer mid-claim) and is only reclaimed after a one-beat recheck. Owner fields
  are digit-bounded (≤18) before any `kill -0`/`$(( ))` — an oversized value is *fatal* under
  dash. The owner read is a byte-capped, regular-file-only `dd` (a planted symlink or huge file
  can't leak or DoS it). The lock stays held through the update's own restart (`cmd_start` lets
  its own `$$` through) so its restart can't double-spawn beside a user's reopen. Specs:
  `infra/release/control-center.test.ts` — the script's first automated coverage; they drive the
  real script with `curl` stubbed on `PATH`, offline.
- **Schema migrations are automatic and run before anything serves a request.** `install.sh`
  and every `control-center start` run `runner/migrate.ts` (→ `lib/db/migrate.ts`), which
  applies the versioned SQL in `drizzle/`. Three cases it handles, all covered by
  `runner/migrate.test.ts`:
  - *no database* → apply every migration;
  - *database with bookkeeping* → apply what's pending (usually nothing, and then it does
    **not** snapshot — `start` runs every launch and copying the DB each time would fill the
    disk);
  - *database without bookkeeping* (created by the old `db:push` flow) → **adopt** it: record
    the migrations as already applied rather than replaying `CREATE TABLE`s against tables that
    already exist. Verified to preserve rows.

  After migrating it compares every ORM table/column against `PRAGMA table_info` and **throws
  rather than starting** if something the code needs is missing — a database too old to adopt
  gets a specific error and a pointer to `pnpm db:push`, not a crash on first query. Anything
  that changes the database is snapshotted to `data/backup/` first via `VACUUM INTO` (the
  supported way to copy a live WAL database).
- Migrations are **not** wired into `pnpm dev` on purpose: dev databases here have been corrupt
  before, and a failed `VACUUM INTO` would block the dev server. Run `pnpm db:migrate` by hand
  in a checkout — the first run will adopt your existing `data/platform.db`.
- **`control-center` env:** `CC_PORT` (7373), `CC_RUNNER_PORT` (7374), `CC_HOME` (`~/.control-center`),
  `CC_SKIP_UPDATE_CHECK=1`, `CC_NO_OPEN=1` (don't open a window — used by smoke tests),
  `CC_REPO` (track a fork).

## Moving data between installs (export / import)
`pnpm cc:export` → a `.tar.gz` you can `control-center import` on another machine. The dev
checkout and an installed app are separate databases with separate master keys, so this is how
work moves between them.
- **The database is rebuilt table by table, not copied.** Slower than `VACUUM INTO`, but a byte
  copy dies on the first corrupt page and this repo's own database has had a corrupt
  `task_events`. Unreadable rows are skipped, counted, and reported in the manifest — never
  silently dropped. (On the live database it recovered all 59,305 transcript rows.)
- **Sessions never travel** (live login cookies). **Tokens only with `--include-tokens`**, which
  decrypts them into the archive so the destination can re-encrypt under its own key — that
  makes the file a credential; it's written 0600 and warned about loudly.
- Usage data needs no special handling: it lives in `tasks.usage*` and is recomputable from the
  `result` messages in `task_events`, both of which travel.
- Import refuses an archive whose migrations this install doesn't know (newer app), snapshots
  the destination before replacing it, and needs `--force` if the destination already has tasks.
  `--claim-as-local` re-homes everything to the local workspace so it's visible without signing
  in; the default keeps original owners.
- The CLI's `import` stops the app first — swapping the database under a live process is how you
  get a half-written one.

## Data operations from the UI (Settings → Data)
Export, restore and uninstall are in the UI as well as the CLI, with three things to keep in mind:
- **They act on the whole install**, every workspace — that's what a backup is. So
  `installWideDataOpAllowed()` refuses all three once there's more than one account: on a shared
  install they'd let anyone who merely opened the app take, or delete, someone else's history.
  Past one account they stay CLI-only, which needs filesystem access anyway.
- **Restore is queued, not applied.** The page is served by the process holding the database open,
  so replacing it inline would produce a half-written one. The upload is *validated* immediately
  (a bad archive fails while someone is watching) and staged at `data/pending-import.tar.gz`;
  `control-center start` applies it with the server down, then moves it to `data/backup/`. A
  failed restore is moved to `data/failed-import.tar.gz` rather than retried on every launch.
- **UI exports never include tokens.** `--include-tokens` stays a deliberate CLI choice, because
  it turns the archive into a credential.
- Uninstall spawns a **detached** `control-center uninstall`: the first thing it does is stop the
  server answering that very request.

## The app owns the server's lifetime
The native app starts the server when it opens and stops it when the window closes — but only the
one it started. If something was already listening it attaches instead, so a server you started
from a terminal survives quitting the window. `applicationWillTerminate` runs `control-center
stop` **synchronously**: macOS gives a terminating app a short grace period, and a detached stop
would lose that race and leave the server running.
