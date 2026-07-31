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

- **2026-07-30 — Runner lockdown + per-user Anthropic token vault** (pm tasks 03 + 02,
  `.pm/tasks/20260729-155024-auth-and-per-user-tokens/`). Decisions:
  - `tasks.userId` (nullable, `set null` on user delete) scopes **billing/attribution
    only** — projects/agents stay shared. Stamped from the session in POST `/api/tasks`.
  - The browser NEVER talks to the runner anymore: `/api/tasks/[id]/{stream,respond,reply,
    stop}` are session-gated Next routes that forward to `RUNNER_URL` server-side (the
    stream route pipes the runner's SSE body through with `signal: req.signal` so a closed
    EventSource tears down the upstream fetch). `PUBLIC_RUNNER_URL`/`NEXT_PUBLIC_RUNNER_URL`
    are gone, compose no longer publishes :4319, and the runner has no CORS.
  - Tokens live OUTSIDE the DB: `lib/secrets.ts`, AES-256-GCM per-user file under
    `data/secrets/` (dir 0700, file 0600), master key = `SECRETS_MASTER_KEY` (base64,
    32 bytes; vault refuses to operate without it). AAD = userId so a copied file fails
    auth under another user. API is write-only: GET returns `{configured, kind, last4}`.
    Kind is auto-detected from the prefix (`sk-ant-oat…` → oauth, else api-key) — no
    user toggle to get wrong.
  - Injection: `runner/user-env.ts` `buildTaskEnv(userId)` — **SDK `Options.env`
    REPLACES `process.env`** (sdk.d.ts ~L1351), so it spreads `process.env`, strips the
    shared `CLAUDE_CODE_OAUTH_TOKEN`/`ANTHROPIC_API_KEY`, then sets the owner's token.
    Applied to the main `query()` AND model-router's classify/generateTitle. Fails closed
    at dispatch (clear 502 with message) unless `ALLOW_SHARED_TOKEN_FALLBACK=1`.
    Verified end-to-end: with a real shared token in the container env and a fake user
    token in the vault, the session failed 401 — the user token strictly won.
  - The SDK reports auth failures as `result.subtype === "success"` with
    `is_error: true` — session-manager now treats that as failed (it used to finalize
    "done" with an error text as the report).
  - `lib/daemon-client.ts` now surfaces the runner's `{error}` JSON body instead of a
    generic "(500). Is it running?" — needed so the no-token error reaches the UI.
  - **Transcript redaction (from security review, blocking):** task transcripts are
    visible to every signed-in user (shared-visibility product model), and the agent
    subprocess can echo its own env (deliberately or via prompt injection) into tool
    output that lands in `task_events`. So `record()` in session-manager — the single
    chokepoint for everything persisted/streamed — scrubs the task's injected credential
    values (`handle.secrets`) from every payload, and `finalize()` scrubs the task error
    column. Residual: ephemeral `partial` token-stream deltas could in theory split a
    secret across chunk boundaries (final persisted message is still redacted).
  - **Second-pass audit finding:** the `{...process.env}` spread also carried operator
    secrets. Now `buildTaskEnv` DELETES `SECRETS_MASTER_KEY` from the child env (the
    subprocess never needs the vault key), while `GH_TOKEN` stays (agents need it for
    `gh`/git) but its value — plus the master key's, covering `cat .env` on this very
    repo — is in the redaction set via `sensitiveEnvValues()`. **Caveat:** this is a
    blocklist; any NEW operator secret added to `.env` later must either be deleted in
    `buildTaskEnv` or added to `sensitiveEnvValues`, or it will ride into agent
    subprocesses unredacted. (A strict env allowlist for the child was considered and
    deferred — too easy to break the Claude CLI's runtime expectations untested.)

## Gotchas
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
