# decisions

Dated decision log: what was decided and why, oldest first.

Part 1 of 2.

<!-- Split out of a single 232 KB `.swe/notes.md` on 2026-08-24, which was read in full at the start of every request (engineering rule 10). Entries are verbatim and in date order; only this header is new. -->

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

- **2026-08-05 — a turn ending is not a task ending (`runner/completion.ts`).** In
  streaming-input mode the SDK emits a `result` at every turn boundary and then waits for
  input, so the *runner* decides completion. It used to treat any turn end as done and, if no
  report gate / `[[DONE]]` had appeared, staple `[[DONE]]` onto the last assistant text and
  surface that as the report — which the UI renders as the Report card. Real transcripts
  therefore showed "I'll follow the fe:task workflow — first, investigation. Let me read the
  workflow rules…" as the report with the task **Done**, before any work existed. Now
  `classifyTurnEnd(text)` returns `final` or `paused` (`waiting` | `narration` | `no-text`)
  and the runner nudges (up to `MAX_AUTO_CONTINUE` = 3) then **fails** rather than faking a
  report. Design points worth keeping:
  - **Conservative by construction**: only a positive continuation signal (trailing colon,
    first-person "let me / I'll …" as the *last* sentence, the old `WAITING_RE` phrasing, or
    no text at all) counts as a pause. Ambiguous prose stays `final`, so `onboard`-style
    commands that end with a plain summary and no marker behave exactly as before.
  - A body ending in **`?` is `final`** — the agent asking the user something is a deliberate
    stop, and nudging would answer on the user's behalf.
  - A **structured** message (headings/lists, ≥240 chars) stays `final` even if its closing
    sentence sounds like an intention ("I'll wait for your approval") — that's a real report.
  - Completion is judged from `turnText` (the last main-thread message of *this* turn,
    possibly empty), not the sticky `lastAssistantText`, which can be many messages stale;
    the synthesized report now also uses the turn's own closing text.
  - The nudge no longer requires `!producedReport`: stopping mid-work is a pause even after a
    report gate (the commit step still owes an ending).
  - `GATE_PROMPT` now states the contract to the agent, so the nudge is a backstop and not
    the primary mechanism.
  - **Not retroactive** — tasks that already recorded a synthesized `[[DONE]]` event keep
    showing their bogus Report card; the UI reads persisted events.

- **2026-08-11 — per-project backlog** (pm task `03-backend-backlog-model-api`,
  `.pm/tasks/20260811-113836-tasks-backlog-activity/`). `backlog_items` + routes under
  `app/api/projects/[id]/backlog/`, logic in `lib/backlog.ts`. The rules are in CLAUDE.md
  ("The backlog"); what's worth recording here is *why* the edges are where they are:
  - **Status is the only thing in the row that no file can re-derive**, so it's the only thing
    with precedence rules: `statusOverride` (set by any PATCH of status) beats the sync and the
    linked-task reflection forever; the two machine transitions (dispatch → `in_progress`,
    linked task done → `done`) deliberately don't set it, or running an item would freeze it
    against its own completion. Everything else about a synced item is re-read from the file,
    which is why the API *refuses* (409) edits to title/description/assignee/priority on one
    rather than accepting a change the next load would revert.
  - **Reflection is not scoped to the project on the task side, on purpose.** The first version
    matched `tasks.projectId = projectId` in the subquery; a smoke test with an item linked to
    another project's finished task then silently never reflected. `linkBacklogTask` can't
    produce that link, but a hand-edit or an import could, and "the run finished" is the honest
    answer either way. The item side is still scoped, so one project's sweep can't move
    another's rows.
  - **The scan refuses symlinks** (dirs and files). `.pm/tasks/` is inside a project the agent
    can write, the backlog is shared install-wide, and a symlink named `01-task.md` pointing at
    `~/.ssh/id_rsa` would otherwise land that file's contents in a shared DB row. Cheap because
    `Dirent.isFile()` is already false for a symlink — no `realpath` needed.
  - **`lib/dispatch.ts` was extracted from `POST /api/tasks`** so the run action inherits the
    token gate, model allowlist, agent-version snapshot and failure bookkeeping instead of
    reimplementing them. The route's request/response contract is byte-identical; only the body
    moved. Anything that dispatches in future should go through it.
  - **`lib/pm-spec.ts` is imported by a client component** (`FileModal`), so nothing reachable
    from it may touch `node:*`. That's why the frontmatter primitive moved to
    `lib/frontmatter.ts` (agent discovery uses it too, keys as written; pm-spec lowercases)
    rather than pm-spec importing `lib/util.ts`, which pulls in `node:crypto`. First test run
    caught a real bug in the copied parser while doing it: `.` excludes `\r`, so a CRLF
    frontmatter line failed the key/value regex *entirely* and every field read `undefined`.
  - **Verified against the real repo**: the first `GET` imported all 15 specs in this project's
    `.pm/tasks/` with the right assignee/priority, and a second returned `{added: 0, updated: 0}`.
    A *successful* dispatch was **not** exercised over HTTP — `user_local` has no token on this
    install and there's no `ALLOW_SHARED_TOKEN_FALLBACK`, so the run route answers 412 (which
    did verify the gate, and that a refused run creates no task and leaves the item untouched).
    The 409 already-running guard was verified by temporarily pointing an item at a live task.
  - **Both review subagents found real blocking bugs; the symlink defence was the weakest part.**
    Fixed, with specs for each:
    - The scan classified a *dirent* and then read by *path*. `Dirent.isFile()` is **true for a
      hard link**, so `ln ~/.ssh/id_rsa 03-task.md` imported that file's contents into a row every
      workspace can read (and into export archives); and even for a genuine file, the entry could
      be swapped for a symlink before the read — retried for free, since the scan runs on every
      load. Now `readSpecFile` opens once with `O_NOFOLLOW`, `fstat`s the *handle*, requires
      `nlink === 1`, and reads exactly the measured size. Non-regular files are never opened for
      reading, which matters most for a FIFO: reading one blocks forever and takes the request
      with it.
    - The caps shed the **newest** work. Request folders were walked oldest-first (their names are
      timestamps) and the walk stopped at `MAX_SPECS`, so a project past the cap — and these
      folders are committed, so they never age out — would silently ignore every new plan, with
      `{added: 0, updated: 0}` indistinguishable from "up to date". Now: newest-first, plus a
      2 MB total byte budget (500 × 256 KB would have permitted a 128 MB read *and* response on an
      unauthenticated GET, measured by the auditor at 553 MB RSS and ~500 ms of blocked event
      loop), and the scan reports `skipped`/`truncated` which the route surfaces as `warnings`.
    - `lib/dispatch.ts` had no tests at all, while `agentForNamespace` is the only thing deciding
      which agent takes a backlog item. `lib/dispatch.test.ts` now covers registry-beats-bundled
      precedence, the model allowlist, and the runner-unreachable bookkeeping — the last by
      pointing `RUNNER_URL` at a dead port, so the 502 path is real rather than stubbed.
    - Also from review: `linkBacklogTask` was a read-then-write (now one statement, and it returns
      null instead of throwing if the row vanished after the task went live — the route reports the
      task either way); one test asserted nothing (`sync is scoped to one project` never called
      sync); and the journal's trailing newline I had added could have failed the release
      workflow's `git status --porcelain drizzle` check — reverted to drizzle's exact format.
  - Accepted, not fixed (both pre-existing and app-wide, worth their own task): no CSRF/Origin
    check on any mutating route — `sameSite: "lax"` means a cross-site POST arrives as the shared
    `user_local` workspace, and `req.json()` ignores Content-Type so a `text/plain` body isn't
    preflighted; `POST /api/tasks` has had exactly this shape all along. And a spec file is agent
    instructions, so importing automatically widens the blast radius of prompt injection that
    `FileModal`'s Create-task button already had — task 05 should show provenance before Run.
  - `backlog_items` is in `EXPORTED_TABLES` (after `tasks`, for FK order) so a backlog survives
    export/import.
  - Left for task 05: the UI consumes these four routes.
