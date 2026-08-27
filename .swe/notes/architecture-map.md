# architecture map

The full annotated architecture map — every directory and the load-bearing module, with the reasoning attached.

<!-- Moved out of CLAUDE.md on 2026-08-24 to bring it inside its 20 KB budget (engineering rule 7). Content is verbatim; only the heading level and this header are new. -->

## UI architecture map
- `agents/` — the swe / fe / pm plugins, vendored and shipped in the release tarball (see
  "The agents ship with the app"); read by `lib/discovery/agents.ts`, never imported as code
- `app/` — Next.js App Router pages and API routes
- `app/page.tsx` — Dashboard (agent list, project list, recent tasks)
- `app/agents/` — Agent list + detail pages
- `app/projects/` — Project list + detail pages
- `app/tasks/[id]/` — Task live view (SSE + gate actions via the authenticated
  `/api/tasks/[id]/{stream,respond,reply,stop}` proxy routes — the browser never talks
  to the runner directly). `respond` and `continue` accept multipart, so a gate answer or a
  follow-up can carry files; `reply` exists on the runner but no UI calls it. Also hosts the
  **Changes** card (`components/TaskChanges.tsx`) — what this run changed on disk, see
  "A task's own changes" below
- `app/settings/` — Per-user settings (Anthropic token vault card, `Version` card, Data card)
- `app/usage/` — Per-user usage page: spend summary + Claude plan-limit bars. A top-level
  nav entry, not a Settings sub-section (moved out of Settings 2026-08-02)
- `app/api/` — API routes (projects, tasks, agents, git, fs, diff, file, settings/token)
- `app/api/fs/list/` — Signed-in-only directory listing behind the **Browse…** folder picker
  (`components/FolderPicker.tsx` + `lib/fs-browse.ts`). There is no native OS picker: the
  old `/api/fs/pick` shelled out to macOS `osascript`, which can never work in the Linux
  dev container, so it was removed (2026-08-04)
- `app/api/projects/[id]/backlog/` — Per-project backlog: `GET` (list, which also syncs
  `.pm/tasks/` specs and reflects finished runs), `POST` (add one), `PATCH …/[itemId]`,
  `POST …/[itemId]/run` (dispatch it as a task, optionally `{ parallel: true }` to isolate it in
  its own worktree instead of queueing — the only field the body accepts). Logic lives in
  `lib/backlog.ts`; the routes only translate HTTP
- `app/api/projects/[id]/features/` — Per-project features: `GET` (list — a plain read, it never
  touches the disk; the `.pm/tasks/` walk that *derives* features belongs to the backlog load),
  `POST` (create by hand), `PATCH …/[featureId]` (close one out, or rename a hand-made one),
  `DELETE …/[featureId]` (retire a grouping — ungroups its work, refuses a pm-derived one or one
  with a live run, never runs git). Logic and every bound are in `lib/features.ts`. See
  "Features" and "Managing feature groups" above
- `app/api/tasks/[id]/` — `GET` task detail + event log, and `PATCH` to move the task into a
  feature or out of one (`{ featureId }` only). The one owner-scoped feature route
- `app/api/tasks/[id]/changes/` — This task's own uncommitted-changes summary, resolved to the
  root the run actually used. Takes no path or directory parameter; logic is in
  `lib/task-root.ts` and `gitChanges` is consumed unchanged
- `app/api/search/` — `GET /api/search?q=…&limit=…`: one query, four types (tasks, projects,
  agents, backlog items). HTTP translation only; logic and every bound are in `lib/search.ts`.
  See "Global search" below
- `components/` — All reusable UI components (bespoke)
- `components/ui-cards.tsx` — Core primitives: `card`, `CardSection`, `PageHeader`,
  `EmptyState`, `Chip`, `Tile`, `Fact`
- `components/FeatureGroup.tsx` — `FeatureGroup` (the one feature heading, now a collapsible
  disclosure: chevron button + name + branch chip + merge summary + count, `<h3>` so it nests
  under every host's `CardSection`; active features start open, closed ones collapsed) and
  `MergeStateChip` (one row's merge state, wording decided by `mergeChipView` in `lib/ui.ts`).
  Shared by the backlog, project detail and `/tasks`; see "Following one feature in the UI"
- `components/FeatureManager.tsx` — The **Features** card on project detail, which is now that
  page's whole work view: every feature is a row that **expands to its own tasks** (rendered
  through the shared `TaskList`), with the ungrouped runs as a last "No feature" row. Also add,
  rename, close
  out / reopen, and delete a grouping (delete behind a confirmation that names what survives).
  Row-level rules come from `featureRowActions` (`lib/ui.ts`); see "Managing feature groups"
- `components/VersionSettings.tsx` — Settings → **Version**: which release this install is on,
  what the newest one is, when that was last checked, and a "Check now" that sends `?force=1`.
  Copy comes from `versionSummary` (`lib/update-ui.ts`), which has an answer for every state
- `components/ui/` — Base primitives: `button.tsx`, `modal.tsx`, `select.tsx`
- `components/Sidebar.tsx` — Desktop primary nav (collapsible rail, `md+`)
- `components/MobileNav.tsx` — Mobile top bar + bottom tab bar (`< md`)
- `components/ThemeToggle.tsx` — Light/dark/system control (segmented + icon variants)
- `lib/` — Shared logic: db (Drizzle + SQLite), discovery, git, ui utils
- `lib/theme.ts` / `lib/sidebar.ts` — Pre-paint init scripts + external stores for the
  theme and sidebar state (both persisted in `localStorage`, applied to `<html>`)
- `lib/secrets.ts` — Encrypted per-user Anthropic token vault (`data/secrets/`, master
  key from `SECRETS_MASTER_KEY`; write-only API, tokens never leave the server)
- `lib/backlog.ts` — The per-project backlog (`backlog_items`): scans/syncs the pm agent's
  `.pm/tasks/` specs, derives one **feature** per request folder and links that folder's items to
  it, validates API input, and owns the status rules (a manual status wins over both the sync and
  the linked task; see "The backlog" below)
- `lib/features.ts` (+ `lib/features.test.ts`) — The feature entity (`features`): branch naming
  (an allowlist, because the result is a git ref), idempotent derivation from a `.pm/tasks/`
  folder, the caps, the validators, and `parseFeatureRef` — the one place a client-supplied
  `featureId` is checked against the project it claims to belong to. Also `deleteFeature` (the
  two refusals, and the `mergeState` clearing an FK can't do) and `backlogCountsByFeature` (items
  only, never tasks — tasks are private). See "Features" and "Managing feature groups" above
- `lib/pm-spec.ts` — Reading a pm task spec (frontmatter → title/assignee/priority) and naming a
  request folder (`requestTitle`, which is what a derived feature is called), plus
  `specSourcePath()`, which maps a spec's on-screen path to the `sourcePath` key the backlog
  scan would have stored — root-only and matched exactly, since the modal's path may name a
  workspace member's spec that has no row. Shared by
  `components/FileModal.tsx` and the backlog sync so one spec always routes to the same agent.
  **Imported by a client component — nothing reachable from it may touch `node:*`**
  (`lib/frontmatter.ts` is the dependency-free primitive underneath, also used by agent
  discovery)
- `lib/dispatch.ts` — Creating + starting a task: token gate, model allowlist, agent-version
  snapshot, optional pre-set `title` (which suppresses the runner's naming call), project↔agent
  link, failure bookkeeping. `POST /api/tasks` and the backlog's run action both go through it —
  anything else that dispatches should too. Also `parallelOffer`: whether a page may offer
  "Run isolated" (default-checked where offered), kept in this file so the offer can't drift
  from the refusal beside it (see "Running planned work in parallel")
- `lib/uploads.ts` — Saving request/gate/follow-up attachments under
  `data/uploads/<taskId>/`, plus `readFormData` (a malformed multipart body answers 400 instead
  of throwing a 500) and `attachmentNote` (the "read these with the Read tool" note, shared by
  the runner's prompt and the gate reply so the wording can't drift)
- `lib/safe-read.ts` — Reading a file a project tree *claims* to contain: `readFileInside`
  (the file route), `escapesOnDisk` (the git callers, which hand a path to a subprocess and
  can't hold an fd) and `isUsableRelPath` (the lexical gate both routes share). See "Reading
  files out of a project tree" below
- `lib/task-root.ts` — Which directory a *task's* files and changes are read from: the project
  checkout, the git worktree a parallel run used, or neither once that worktree is cleaned up.
  Spawns nothing (row + two `existsSync`); see "A task's own changes" below
- `lib/search.ts` (+ `lib/search.test.ts`) — Global text search: one query over tasks, projects,
  agents and backlog items, with the owner scoping, the `LIKE` wildcard escaping and every bound
  (query length, per-type limit, snippet caps) in one place. See "Global search" above
- `lib/ui.ts` — Shared UI logic with no DOM: status labels/tones, `taskDisplayTitle`,
  `orderSkills` (skill order + whether `onboard` is offered), `featureRowActions` +
  `FILE_OWNED_FEATURE_NOTE` (what a Features-card row may do, and why not), and
  `fixTaskReasons` (why a report offers a fix task — see below). Kept out of the
  components so `pnpm test` can cover it
- `lib/update-ui.ts` (+ `lib/update-ui.test.ts`) — Everything the update UI says and when:
  the banner's phase/copy builders, `shouldRecheck` (the re-check interval and the
  come-back-to-the-window floor) and `versionSummary` (the Settings card's sentence for every
  state, including the quiet ones the banner renders as nothing)
- `lib/db/migrate.ts` — Schema migrations: applies `drizzle/`, adopts pre-migration databases,
  snapshots before changes, and refuses to run against a schema the code can't query. Driven
  by `runner/migrate.ts` (`pnpm db:migrate`), which `install.sh` and `control-center start` run
- `drizzle/` — Versioned migration SQL + journal. **Ships in the release tarball** (an
  installed app can't migrate without it) and is checked against the schema in CI
- `lib/fs-browse.ts` — Jailed directory listing for the folder picker. Browsable roots come
  from `PROJECT_ROOTS` (colon-separated; compose sets **host** paths), else the home dir *plus*
  the parents of registered projects. Refuses anything above the outermost root (403), but
  walks up freely between roots, so `$HOME:/Users` lets you start in your home and still climb
  to `/Users`. Widening the roots without widening the compose mounts just yields empty
  folders. Typing a path into the Add-project field is *not* restricted — only browsing is
- `runner/` — Hono task-execution server (separate from Next.js; loopback-only, no CORS —
  reached exclusively through the Next.js proxy routes; `runner/user-env.ts` builds each
  task's subprocess env with the owner's token)
- `runner/platform-mcp.ts` — the in-process `swe-platform` MCP server every session is handed:
  `request_approval` (the workflow gate — its handler stays suspended, and that *is* the pause)
  and `add_backlog_item` (`runner/backlog-tool.ts`). `runner/gate-prompt.ts` is what tells the
  agent they exist; a tool nothing mentions is a tool nothing calls
- `runner/merge-sweep.ts` (+ `.test.ts`) — retries `blocked` feature merge-backs and
  reclassifies settled ones from the git object store; runs at boot and whenever a project's
  checkout frees up. See "The feature branch: lifecycle and merge-back"
- `app/api/usage/` — Per-user usage: real spend from `lib/usage-summary.ts` plus a
  best-effort Claude plan-limits block. **Plan limits are normally `available: false`** —
  the SDK only reports them for a logged-in profile, and this app injects tokens via
  `Options.env`; see `runner/usage-snapshot.ts`
- `lib/usage-summary.ts` — Per-user spend aggregated from `tasks.usage*`, scoped to the
  caller (transcripts are shared; spend isn't), plus an `unattributed` bucket for tasks
  predating `tasks.userId`
- `runner/usage-snapshot.ts` — Best-effort plan-limit probe under the user's token. Spawns a
  short-lived session (~1.7s, no model call, nothing billed), caches per user, and degrades
  to `available: false` on any surprise — the SDK method behind it is experimental and will
  be renamed
- `runner/usage.ts` — Token/cost accounting from SDK `result` messages. Those counters are
  cumulative **per subprocess** and restart on a continue/resume, so usage is accumulated
  as deltas onto `tasks.usage*`; shared by the live runner and `runner/backfill-usage.ts`
- `public/` — Agent avatar images (`<namespace>-agent.png`)
- Theme tokens/global styles: `app/globals.css`
- Tests: `runner/*.test.ts`, `lib/*.test.ts`, `lib/discovery/*.test.ts`,
  `infra/release/*.test.ts` (`pnpm test`)
