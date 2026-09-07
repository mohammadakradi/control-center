# decisions

Product and planning decisions, and why — oldest first.

<!-- Split out of a single 12 KB `.pm/notes.md` on 2026-08-24, which exceeded the 8 KB index budget (pm rule 9). Entries are verbatim; only this header is new. -->

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

- 2026-09-03 — planned workspace parallel runs + per-task changes + honest gate/report rendering
  (`.pm/tasks/20260903-131534-workspace-parallel-and-gate-rendering/`, 7 tasks). Verdict BUILD on
  all three reported symptoms; two reproduced live on the running install.
  **One flag, two features:** Award Maven is the install's only `isWorkspace: true` project, and
  `isWorkspace` disables *both* things the user reported — parallel isolation (`parallelOffer`
  `lib/dispatch.ts:89-94`, the 400 at `:174-183`, `canIsolate` in `runner/worktree.ts:86-92`, so a
  workspace is hard-capped at concurrency 1 — 81/81 Award Maven tasks ran `parallel=false`,
  `workdir=null`) and the per-task Changes card (`lib/task-root.ts:48` → `lib/ui.ts:835` maps
  `available:false` to `{kind:"hidden"}`, so it vanishes with no explanation). The documented
  reason ("member repos make the isolated worktree ambiguous") is real but solvable *because the
  members are siblings of the root*: one per-task dir holding a worktree per repo reproduces the
  relative layout, so `../portal-frontend` still resolves. Approved design: a **set** of worktrees
  per task, and `resolveTaskWorkRoot`'s single root becomes a **`workRoots`** list (label + cwd +
  per-root kind), with a plain-git project as the one-entry case. `isTaskWorktree` is applied per
  repo and NOT widened — accepting a member's worktree under another repo's admin dir is exactly
  the hole that guard closes.
  **Symptoms 2 and 3 share a root cause.** `classifyTurnEnd` seals on the *absence* of a pause
  signal, so a tool-call preamble becomes the report AND ends the task — reproduced on this very
  planning task (`task_2ad6afb5` sealed `done` on *"Smoking gun found. Let me confirm…"* while the
  session kept running and recording events past `end`), and `finalize()`'s `closeInput()` then
  made this request's own `request_approval` fail with `Stream closed`. Decision: sealing must
  require positive evidence, and a gate raised on a handle the runner thinks is finished must
  re-open the task rather than hit a closed channel. `WAITING_RE` still must never be consulted
  where the answer *seals* (the pre-existing trap in `.swe/notes/task-runs.md`) — lean on shape,
  not on waiting language.
  Two transport defects found unfiled: the live stream path never sends `closed`
  (`runner/server.ts:128-145` vs the cold path `:124`), so `EventSource` reconnects into the 60 s
  grace window and parks with `connected:true` forever — and the indicator is that transport
  boolean, not run status; plus no heartbeat against undici's 300 s default `bodyTimeout` on a bare
  proxy `fetch` (224 × `UND_ERR_BODY_TIMEOUT` in `web.log`).
  Rejected: normalizing report text in `components/` (it goes in `lib/ui.ts`, where `pnpm test` can
  reach it); stripping alone as the fix for the proposal card (`[[GATE:PROPOSAL]]` needs a real
  `PROPOSAL_AT_END` branch or it keeps leaking literally); and half-isolating a workspace (a member
  whose worktree can't be created must fail the launch loudly).
  Filed out of scope: `bli_7a99ac63` (platform.db at 545 MB — needs a retention/vacuum decision),
  `bli_c2b4d806` (Award Maven's stale upstream-less `defaultBranch` spamming git errors).
  Extended to 10 tasks on a second follow-up the same day. **Closed features stay on screen —
  reversed on purpose.** `lib/features.ts:345` documents the old stance ("closing a feature out
  keeps it on screen forever as a collapsed heading, which is right for finished work"); the user
  wants active-only with an opt-in closed filter. `listFeatures` returns every status and there is
  no filter anywhere; the fix follows the precedent backlog *items* already set one page over
  (split on `isOpenBacklogStatus`, count the remainder in the header, disclose separately) plus the
  existing query-param `FilterPill` idiom — no new filter mechanism.
  **`createAndStartTask` never validated `command`.** `DispatchInput.command` is a bare string,
  stored as-is, and the runner formats `/${namespace}:${command}` blind — an unknown command
  reaches Claude Code as *prose*, so the run silently does something else instead of failing.
  Reachable because "Create fix task" hardcodes `command: "task"` against the report's own agent
  and `agents/pm/commands/` has only `onboard` + `plan`. Every other path is safe by construction
  (NewTaskForm picks from the discovered list), so the decision is to validate centrally in
  dispatch against `readCommands` — never a hardcoded per-namespace table, which would drift with
  `pnpm agents:sync` and the prefer-a-CLI-copy rule. Also decided: a fix task should go to an agent
  that can *implement* (prefer `fix` over `task`; route a pm report's findings to swe rather than
  hiding the button — a dead button is worse than no button).
