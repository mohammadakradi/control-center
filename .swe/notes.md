# Decision & Gotcha Journal

Running journal of non-obvious decisions, environment quirks, and traps. Read before acting;
update after every change.

## Architecture facts (load-bearing)
- The app is **host-coupled by design**. The runner (`runner/session-manager.ts`) drives the
  Claude Agent SDK with `cwd: project.path` against **absolute host paths** stored in the DB
  (`projects.path`, e.g. `/Users/moh/Dev/...`). It also reuses the host `~/.claude` login +
  plugins via `settingSources: ["user","project","local"]`. The Claude CLI is **bundled in
  `@anthropic-ai/claude-agent-sdk`** — no separate install needed.
- DB is file-based SQLite (`data/platform.db`, WAL) via better-sqlite3 (a **native** module).
  Web app + runner share the same DB file and run with `cwd = repo root`.
- Runner binds all interfaces via `@hono/node-server` `serve()` (port `RUNNER_PORT`, default
  4319). The browser hits the runner **directly** at `PUBLIC_RUNNER_URL`
  (`NEXT_PUBLIC_RUNNER_URL`, default `http://localhost:4319`).

## Decisions
- **2026-06-26 — Dockerized dev (`pnpm dev` runs a container).** Because there is no infra
  layer to containerize (unlike Matcher's postgres/redis/minio), we containerize the *app
  itself*: one `platform` service runs `pnpm dev:local` (web :3000 + runner :4319) inside the
  container. `pnpm dev` → `docker compose up --build`; `pnpm dev:local` keeps the native flow
  (mirrors Matcher's `dev`/`dev:local` split). Compose file lives at
  `infra/docker/docker-compose.yml` (Matcher-style layout).
  - To keep the agent functional in-container we bind-mount the host: `~/.claude` (auth +
    plugins) → `/home/node/.claude`, `~/Dev` at the **same absolute path** (so DB-stored
    project paths resolve), `~/.gitconfig`, and the repo source (which carries `./data`).
    `ANTHROPIC_API_KEY` is passed through if set. This gives a **reproducible runtime, not
    isolation** — accepted by the user.
  - **Hardening from review (2026-06-26):** container runs as non-root `node` (UID 1000,
    `HOME=/home/node`); published ports bind to `127.0.0.1` only; the `next dev -H 0.0.0.0`
    bind lives in a container-only `dev:container` script so native `dev:local`/`dev:web`
    stay localhost. `dev:clean` (`compose down --volumes`) re-seeds the `node_modules`/`.next`
    named volumes after a dependency change.

- **2026-07-29 — Sidebar + light/dark theming via a semantic token layer.** The app was
  dark-only with ~315 hardcoded `neutral-*` classes across 28 files. Rather than sprinkle
  `dark:` variants (which doubles every class string), we introduced a **semantic CSS-variable
  token layer** in `app/globals.css`: `:root` holds light values, `.dark` holds dark values,
  and `@theme inline` maps them to Tailwind utilities (`bg-surface`, `text-fg-subtle`,
  `border-line`, `text-ok`, …). One sweep, both themes, and it retires the "no semantic token
  layer" debt logged in `.fe/design-system.md`.
  - Top navbar → **sidebar** on `md+` (collapsible to an icon rail, persisted). Per the user,
    the **mobile bottom tab bar stays** — it's the right pattern on phones — so mobile gets a
    slim top bar (brand + theme toggle) plus the existing bottom tabs.
  - Theme modes are `light | dark | system`, default **system**. A blocking inline script in
    `<head>` applies the class before paint (no FOUC); the value read from `localStorage` is
    validated against an allowlist before it is used as a class name.
  - **Tests were explicitly waived by the user for this change** (repo has no test setup).
    Verification was lint + typecheck + build-compile + rendered-HTML inspection only.

## Gotchas
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
