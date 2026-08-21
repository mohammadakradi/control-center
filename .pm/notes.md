# Project Planning Notes

Durable planning context kept by the pm-agent: product decisions and rationale,
constraints, and recurring stack conventions. Read before planning; update after each
planning decision. Keep entries short and accurate.

## Decisions
<!-- YYYY-MM-DD — what was decided — why -->
- 2026-07-29 — onboarded pm-agent for planning; graphify code graph unavailable in this
  environment (no uv/pipx/pip to install it) — planning will rely on CLAUDE.md's UI
  architecture map plus direct file search until graphify can be installed.
- 2026-07-29 — graphify is now installed (`~/.local/bin`, `PATH` prefix per call) and
  `graphify-out/graph.json` exists — the fallback above no longer applies.
- 2026-07-29 — planned auth + per-user Anthropic tokens
  (`.pm/tasks/20260729-155024-auth-and-per-user-tokens/`, 6 tasks). Approved decisions:
  self-hosted credentials auth (users + session cookie, no external auth service);
  per-user token in an encrypted store OUTSIDE the DB (`data/secrets/`, AES-256-GCM,
  master key from env), write-only API, injected per task via SDK `Options.env` (replaces
  `process.env` — must spread); runner (:4319) locked behind session-checked Next proxy
  routes (browser currently hits it directly with open CORS); projects/agents stay
  shared, `tasks.userId` scopes billing/attribution only; per-task usage extracted from
  SDK `result` messages already persisted in `taskEvents`; subscription limits via the
  SDK's experimental `get_usage` API — best-effort, hidden when unavailable (API keys).
- 2026-08-02 — planned moving Usage out of Settings into its own "Usage" nav item
  (`.pm/tasks/20260802-083437-usage-own-menu/`, 1 frontend task). Verdict: PARTIAL — the
  nav/page move is a real gap (BUILD); the requested percent-used plot (like Claude's own
  usage-limits screenshot) already exists as `components/PlanLimits.tsx`'s `WindowBar()` and
  just needs to move with the page, not be rebuilt — it usually renders nothing because plan
  limits report unavailable for this app's env-injected tokens, a known prior limitation, not
  a gap to fix.
- 2026-08-11 — planned title-first task lists, Tasks menu, per-project Backlog, and a
  running-tasks activity badge (`.pm/tasks/20260811-113836-tasks-backlog-activity/`,
  6 tasks). Verdict PARTIAL: `tasks.title` + project-detail display already existed; only
  Dashboard/agent-detail lists showed raw request text. User-approved direction: extract ONE
  shared task-list component (modeled on `components/TaskHistory.tsx`) instead of patching
  each list. Backlog decisions: DB table `backlog_items` (shared per project, like projects
  themselves), fed by (1) idempotent sync of `.pm/tasks/` spec files keyed by `sourcePath` —
  deliberately NO pm-agent changes, (2) an `add_backlog_item` MCP tool on the runner's
  existing in-process `swe-platform` server, (3) manual UI add; run-from-backlog reuses the
  `FileModal.createTask` dispatch shape and stores `linkedTaskId`.
- 2026-08-12 — planned a fix for `control-center update`/`install.sh` failing mid-build with
  `SqliteError: database is locked` (`.pm/tasks/20260812-191427-fix-update-build-sqlite-lock/`,
  3 tasks). Root cause: `lib/db/index.ts` opens SQLite at module load with no `busy_timeout`;
  ~33 files import `lib/db`, and Next's "Collecting page data" build phase evaluates them
  across parallel workers that race to create/WAL-convert the same brand-new file in the temp
  build dir both `install.sh` and `apply_update()` (`control-center.sh`) use. Fix: add a
  busy_timeout pragma. Also confirmed two developer-reported hardening gaps in the same
  pipeline: (1) Turbopack auto-infers its project root from the nearest ancestor lockfile, and
  these builds run deep under `$HOME` — a stray lockfile there could silently mis-trace the
  build; fix is pinning `turbopack.root` in `next.config.ts`. (2) `running()`/`status` in
  `control-center.sh` only checks the `web` pid, never `runner` — can misreport a live runner
  as stopped and let `cmd_start` double-spawn. Explicitly did **not** adopt the suggestion to
  have the installer stop a running instance before building: `apply_update()`'s build writes
  to a temp-dir database distinct from the production one, so stopping first wouldn't fix this
  bug and would regress the deliberate build-before-swap (fail-safe, zero-downtime) ordering —
  flagged this reasoning back to the user rather than applying it as-is.

- 2026-08-14 — planned backlog run-tracking + parallel runs
  (`.pm/tasks/20260814-170321-backlog-tracking-and-parallel-runs/`, 2 tasks). Verdicts:
  (1) BUILD — `FileModal.createTask` dispatches via `/api/tasks`, bypassing the backlog, so a
  spec's item never leaves `todo`; fix is client-side: resolve the item by `sourcePath` via the
  self-syncing backlog GET and use `POST …/backlog/[itemId]/run`, direct dispatch as fallback.
  (2) ALREADY-DONE — pm-assignable backlog items shipped in b9c2c3b (`AddBacklogItem.tsx`
  offers `/pm`, dispatches `/pm:plan`). (3) User asked for a pre-queue overlap check to run
  tasks concurrently; assessed RISKY (overlap unknowable pre-run; shared checkout collides on
  git index/HEAD regardless) — user approved the substitute: opt-in per-task `git worktree`
  isolation, queueing stays the default, non-git projects unchanged.
- 2026-08-17 — planned a fix for the in-app "Update now" button not reliably updating the app
  (`.pm/tasks/20260817-191237-fix-update-button/`, 2 tasks). Verdict PARTIAL: the update
  mechanism itself (`apply_update()` in `infra/release/control-center.sh`, driven by
  `control-center update`/`start`) works — this dev machine's own install went 0.5.0 → 0.6.0.
  Two real gaps in the *button* path explain the report: (1) `POST /api/updates/apply` 409s
  whenever any task is in an active status (`ACTIVE_STATUSES` includes `awaiting_proposal`/
  `awaiting_report` — a task simply waiting at a gate, common here), and the banner responds by
  silently relabeling the same button "Update anyway" rather than making the block obvious,
  easy to read as the button doing nothing; the manual stop/start path has no such check, so it
  always proceeds. (2) The detached `control-center update` is spawned with `stdio: "ignore"`
  (`app/api/updates/apply/route.ts`), discarding every line `apply_update()` prints — a real
  failure (checksum, `npx pnpm install`, `next build`) leaves zero trace; the banner just times
  out to "stalled" after 6 minutes with a "quit and reopen" message that doesn't diagnose or
  reliably fix anything. Approved fix: (1) instrument the pipeline — capture its output to
  `logs/update.log` and expose a real status via `/api/updates` instead of a guessed timeout
  (swe); (2) fix the banner UX — make the active-task block unmissable and surface the real
  failure reason once available (fe, depends on the swe task's new status surface).
- 2026-08-19 — planned a fix for photo/file attachments failing with "the request body wasn't
  valid form data" (`.pm/tasks/20260819-150644-fix-attachment-upload-multipart-error/`,
  1 fullstack task). Verdict BUILD: `BAD_MULTIPART` (`lib/uploads.ts`) is a friendly-error
  wrapper added in b9c2c3b specifically because raw `request.formData()` crashes had already
  happened seven times in the logs — the underlying cause of the broken multipart body was
  never diagnosed, only made readable. Ruled out: client FormData construction, middleware,
  and body-size limits (`serverActions.bodySizeLimit` doesn't apply to Route Handlers). Leading
  hypothesis (not confirmed — couldn't force-repro without a real WebKit engine): the
  long-standing WebKit `fetch()`+`FormData`+`File` streaming bug, consistent with this
  project's prior WebKit-specific upload bugs (the WKWebView file-chooser fix). Approved
  direction: stronger failure diagnostics (expected vs. actual body size, user-agent) plus the
  standard mitigation (pre-materialize files before appending to FormData, or use
  `XMLHttpRequest` for the upload leg) across all three upload sites (dispatch, gate answer,
  follow-up).

- 2026-08-19 — planned "beat T3 Code on UI/UX" (`.pm/tasks/20260819-222248-beat-t3-ui-ux/`,
  6 tasks). T3 Code (github.com/pingdotgg/t3code, MIT, Theo/ping.gg) is the direct competitor:
  open-source control plane for coding agents; praised for instant three-panel workspace,
  turn-by-turn unified+split diff review, one-click PR, terminal, shortcuts. We already beat it
  on gated workflows, pm/backlog loop, security, token vault, usage, theming, PWA/Mac app.
  Confirmed gaps → tasks: per-task diff panel (swe), diff viewer highlighting/split/nav (fe),
  global toast system off `lib/active-tasks.ts` (fe), search API (swe), ⌘K palette (fe),
  loading-skeleton/prefetch instant-feel pass (fe). User approved REJECTING: in-app terminal
  (security model collision — T3 criticized for exactly this), commit/PR-from-UI buttons
  (git-through-agents is the design stance; `/swe:ship` is the PR flow), full SPA rewrite
  (incremental perceived-speed work instead), kanban backlog.

- 2026-08-21 — planned feature grouping + feature branches + parallel-from-backlog
  (`.pm/tasks/20260821-135656-feature-grouping-branches-parallel/`, 4 tasks). Verdict BUILD on
  all three parts: no feature/group concept exists (the pm request folder is implicit in
  `backlog_items.sourcePath`, never parsed out; every list groups by project at most); no merge
  machinery exists anywhere (worktree `task/<id>` branches off current HEAD, `finalize()` only
  cleans up); the backlog run route reads no body so `DispatchInput.parallel` never reaches it.
  Approved design decisions: new `features` table + nullable `featureId` on tasks/backlog items,
  features auto-derived one-per-`.pm/tasks/<request>/`-folder by the sync AND manually creatable;
  deterministic runner-side merge of task branches into `feature/<slug>` in a TEMP worktree
  (never the user's checkout, hardened `lib/git.ts` path) — conflicts surface as per-task
  unmerged state, never auto-resolved; feature-linked parallel runs ALWAYS isolate (today
  `launchMode` isolates only when busy, so the first of N siblings would land in the shared
  checkout); checkout runs get an instruction-level preamble naming the feature branch (honest,
  weaker). NOTE: this knowingly reverses part of the 2026-08-14 decision that merging stays in
  the PR/ship flow — the real need ("all tasks done ⇒ one branch holds all work") requires it.
  Rejected: agent-performed merges (non-deterministic, siblings race on one target) and
  auto-resolution (`-X theirs` = silently wrong code).

## Constraints & conventions
<!-- stacks present, who owns what, non-obvious rules to respect when planning -->
- Single stack: full-stack Next.js 16 App Router (App Router pages/API in `app/`) + a
  companion Hono runner process (`runner/`) for task execution. No separate backend repo.
- Frontend work here is owned by the fe-agent, which runs its own gated workflow
  (investigate → plan → build → review → report → commit) and keeps `.fe/design-system.md`,
  `.fe/notes.md`, `.fe/epics/`, `.fe/test-scenarios/` current. Plans that touch UI should
  hand off tasks compatible with that workflow.
- Non-standard Next.js version (16.2.9) — implementation must read
  `node_modules/next/dist/docs/` before coding; don't assume mainline Next.js APIs/conventions.
- Styling is Tailwind v4 CSS-first (no tailwind.config), semantic tokens only
  (`bg-surface`, `text-fg-subtle`, etc.) — never raw palette shades or `dark:` variants.
  Source of truth: `.fe/design-system.md`.
- Package manager: pnpm. Dev runs via Docker Compose (`infra/docker/docker-compose.yml`,
  web :3001 + runner :4319) or natively via `pnpm dev:local`.
- DB: Drizzle ORM + better-sqlite3 (`lib/db/`, migrations via `pnpm db:push`).
- A test suite now exists: `pnpm test` (Node's built-in runner via `tsx`, 29 tests as of
  2026-08-02), specs live next to code as `runner/*.test.ts`. Backend/runner tasks should
  account for it; there's still no frontend test runner.
- Code graph (`graphify-out/`) is installed and built — query it with the
  `PATH="$PATH:$HOME/.local/bin"` prefix per call (see CLAUDE.md). Note: broad queries
  truncate at ~2000 tokens; narrow the query or raise `--budget`.
