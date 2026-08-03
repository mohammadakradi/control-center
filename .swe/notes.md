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

- **2026-07-31 — Token onboarding for new users.** There is **no legitimate way to add a
  "Sign in with Anthropic" button**: per the Agent SDK docs, "Unless previously approved,
  Anthropic does not allow third party developers to offer claude.ai login or rate limits
  for their products, including agents built on the Claude Agent SDK." Anthropic's
  authentication docs list only two app-level methods (API keys, Workload Identity
  Federation) — OAuth is first-party only. Claude Code's OAuth client is discoverable
  (`https://claude.ai/oauth/claude-code-client-metadata`: public PKCE client, loopback
  redirect, no secret) so it *could* be replicated, but doing so means impersonating
  Claude Code and risks users' accounts. **Don't.** Also verified: `claude setup-token`
  emits nothing when stdin isn't a TTY (and nothing under `script`), so the flow cannot
  be hosted server-side either.
  - So onboarding is: guided copy-paste of `claude setup-token` (subscription) or a link
    to `platform.claude.com/settings/keys` (API key). Only the API-key route can have a
    real "go to Anthropic" button.
  - Tokens are now **verified against `GET /v1/models`** before storing (`lib/token-verify.ts`)
    — free, consumes no tokens; OAuth tokens need `Authorization: Bearer` + the
    `anthropic-beta: oauth-2025-04-20` header, API keys use `x-api-key`. A verification
    *outage* stores the token with a `warning` rather than blocking the user.
  - `canRunTasks(userId)` in `lib/secrets.ts` mirrors the runner's `buildTaskEnv` decision
    so the web app can warn up front. **Keep the two in sync — it must never be more
    permissive than the runner.** Used by the `TokenNudge` banner and the POST /api/tasks
    guard (412 + `needsToken: true`, refuses before saving uploads or creating a task row).
  - **Reads of the vault degrade; writes throw.** Both reviewers caught `canRunTasks`
    being *more permissive* than the runner in one branch: master key missing but an
    envelope still on disk. `getUserTokenStatus` reported `configured: true` from file
    presence while `buildTaskEnv` threw a raw `SecretsError` — so the friendly 412 was
    skipped, a task row + uploads were created, and the operator-facing
    "SECRETS_MASTER_KEY is not configured" string leaked into a user-facing 502. Fixed at
    the source: `getUserToken` now returns `null` when the master key is missing (a server
    that can't decrypt has no usable token) and `getUserTokenStatus` always attempts the
    decrypt, so "configured" means *usable*. `setUserToken` still throws — silently not
    storing a token the user just pasted would be worse. Parity verified in all three
    states (key OK / key missing / key rotated): `canRunTasks` and `buildTaskEnv` agree,
    and the user-facing message is the actionable "Save your token under Settings" one.

- **2026-07-31 — Per-task token/cost accounting** (pm task 04). Usage totals live on the
  `tasks` row (`usage_input_tokens`, `usage_output_tokens`, `usage_cache_read_tokens`,
  `usage_cache_creation_tokens`, `usage_cost_usd`), accumulated across continues/resumes.
  - **The load-bearing detail (measured against 118 real `result` events, not assumed):**
    `modelUsage` and `total_cost_usd` on an SDK `result` are **cumulative for the lifetime
    of one SDK subprocess** (and `total_cost_usd` === Σ`modelUsage[*].costUSD` exactly),
    while `usage` (snake_case) is **per-turn and under-reports** — it misses the
    router/haiku/subagent models (e.g. 5 889 vs 7 120 input tokens on the same result).
    A continue/resume spawns a **new subprocess**, so the cumulative counters **restart
    mid-task**. So: naively summing `total_cost_usd` per result over-counts ~2×, and
    summing `usage` under-counts. We accumulate **deltas of the cumulative `modelUsage`
    snapshot**, treating any field going backwards as a subprocess restart
    (`runner/usage.ts`, shared by the live path and the backfill).
  - Writes are **atomic SQL increments** (`col = col + ?`) — the web process reads the same
    row, and read-modify-write would clobber. Wrapped so accounting can never fail a task.
  - History is recoverable at any time because the raw `result` messages are already in
    `task_events`: `pnpm db:backfill-usage` (`--dry-run` / `--all`) replays them through the
    same helper. It makes **no model calls** — free, and needs no Anthropic token. First run
    recovered **$459.61** across 80 tasks; `--all` re-run changed 0 rows (deterministic).
  - **Known gap: a turn that is killed never reports its usage.** Usage only exists on
    `result` messages, and a session killed mid-turn (runner restart, container stop, crash)
    never emits one — so those tokens are invisible to both the live path and the backfill.
    Task 04's own session is the proof: 143 assistant messages of real work, **0** result
    events, so its row reads $0. Assistant messages *do* each carry `message.usage`
    (tokens, no cost), so a follow-up could recover killed-turn tokens — but it would need a
    per-model price table to derive cost, so it was left out of scope.
  - Of 91 historical tasks: 80 got totals, 6 have no `result` event at all, and 5 have a
    result that reports `modelUsage: {}` with zero cost (died before any API call). Those 11
    keep their zeros — "no usage recorded" is not the same as "free".
  - The repo now has a **test suite** (`pnpm test` → 29 specs on `node:test` via the existing
    `tsx`, no new deps). Previously "n/a". The DB spec builds a temp database from the real
    schema with `drizzle-kit push` + `PLATFORM_DB`; it asserts the connection path before
    writing so a broken override can never hit `data/platform.db`.

- **2026-08-03 — usage data layer: date range + per-project breakdown** (pm task
  01-backend-usage-project-date-filter). `spendForUser(userId, { range, topN })` — options
  object replaced the positional `topN`. Decisions:
  - `range: "7d" | "30d" | "all"`, default **"all"** so existing callers (the SSR usage
    page) keep their behavior until the paired frontend task passes an explicit range. One
    shared `createdAt >= start` predicate scopes totals, `topTasks`, and the new
    `byProject`; `unattributed` stays all-time by design.
  - `last30DaysCostUsd` is **deprecated but kept** — `UsageSummaryCard` still renders it;
    the paired frontend task (02) removes both together. It stays the fixed 30-day figure
    regardless of the requested range.
  - Project joins are **LEFT joins**: `tasks.project_id` is NOT NULL with a cascade FK on
    paper, but FK enforcement in the real DB is unreliable (see the drizzle-push gotcha), so
    an orphaned task must not vanish from a billing figure — `projectName` is nullable.
  - `?range=` is parsed by the exported `parseRange()` allowlist: absent/empty → "all",
    anything else off-list → `null`, which the route turns into a 400. Auth is checked
    before range validation.

## Gotchas
- **2026-08-03 — host-side `pnpm test` fails with an esbuild platform error** — the host
  `node_modules` currently carries `@esbuild/linux-arm64` (tsx can't transform anything).
  Run the gates through the dev container instead: `docker exec platform pnpm test` (and
  same for lint / `npx tsc --noEmit`).
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
