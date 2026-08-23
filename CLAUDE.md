@AGENTS.md

<!-- fe:begin (managed by fe-agent — safe to re-generate) -->

## Project overview
Agent Platform is a control-center web UI for managing AI agents, projects, and tasks. It is
a full-stack Next.js 16 App Router app running in SSR mode (`force-dynamic`), with a
companion Hono runner process for task execution. The UI supports light/dark/system themes
and presents agent activity in real time via SSE.

## Frontend stack
- Framework: Next.js 16.2.9 (App Router) — **non-standard version; read `node_modules/next/dist/docs/` before coding**
- Language: TypeScript 5, strict mode
- Build tool: Next.js built-in (Turbopack/PostCSS)
- Package manager: pnpm
- Styling: Tailwind CSS v4 (CSS-first, no config file — `@theme` in `app/globals.css`)
- Theming: **light / dark / system**, default system. Semantic CSS-variable token layer in
  `app/globals.css` (`:root` = light, `.dark` = dark); blocking init scripts in `<head>` apply
  the theme + sidebar width before first paint
- Component library: Bespoke (`components/`) — no shadcn/Radix/MUI
- Routing & state: App Router; no external state library; `usePathname` for active nav;
  `useSyncExternalStore` for theme/sidebar state read off `<html>`
- Icons: lucide-react `^1.21.0`
- Fonts: Geist Sans + Geist Mono via `next/font/google`

## Design system
**Source of truth: `.fe/design-system.md`** — tokens (colors, typography, spacing, radii),
the light/dark mechanism, and the reusable-component catalog. Reuse tokens & components from
there; never hardcode values a token already expresses. **Components must use the semantic
utilities (`bg-surface`, `text-fg-subtle`, `border-line`, `text-ok`, …), never raw palette
shades like `neutral-800` or `sky-400`, and never `dark:` variants.**

## Build / run / test
> Commands run during onboarding; baseline status noted.
- Install: `pnpm install`
- **Run it like an app: `pnpm app`** — brings the stack up *detached* and opens the dashboard in
  a Chrome app window (no tabs, no address bar). Stop with `pnpm stop`. Use `pnpm dev` instead
  when you want the logs in the foreground. See "Installable app" below.
- Regenerate app icons: `pnpm icons` (macOS only — see "Installable app")
- Refresh the vendored agent plugins: `pnpm agents:sync` (see "The agents ship with the app")
- Build a release tarball locally: `pnpm release:pack` → `dist/` (see "Releases")
- Dev server: `pnpm dev`  (Docker: builds the image + runs web :3001 + runner :4319 in one
  container via `infra/docker/docker-compose.yml`; URL: http://localhost:3001)
- Stop the container: `pnpm stop`  ·  reset volumes after a dep change: `pnpm dev:clean`
- Native dev (no Docker): `pnpm dev:local`  (Next.js + runner directly on the host)
- Next.js only: `pnpm dev:web`  ·  Runner only: `pnpm dev:runner`
- Container-only entrypoint: `pnpm dev:container`  (= `dev:local` but binds Next to `0.0.0.0`)
- Build: `pnpm build`  (baseline: ✅ — and it is a real gate again. It used to die prerendering
  Next's own `/_global-error` with `TypeError: Cannot read properties of null (reading
  'useContext')`, which looked like an upstream bug and cost this project production builds
  entirely. It was **`NODE_ENV=development`**: the dev container sets it, so `pnpm build` inside
  the container built a production bundle under a dev NODE_ENV and Next's own chunks broke.
  Next says so — `⚠ You are using a non-standard "NODE_ENV" value` — a line that scrolled past
  above 40 lines of React key warnings. The script now pins `NODE_ENV=production` itself, so it
  no longer depends on where it runs.)
- **Host commands that need esbuild hop into the container automatically.** `pnpm dev` installs
  `node_modules` *inside* the Linux container and the named volume means the host sees that
  same Linux build, so `tsx` and `drizzle-kit` die on macOS with "You installed esbuild for
  another platform". `infra/dev/run-script.sh` wraps `db:*` and `cc:*`: it tries the host, falls
  back to the running container, and otherwise names the two fixes. Test/lint/typecheck are not
  wrapped — run those with `docker exec platform …`. Caveat: arguments pass through untouched,
  so a path argument must exist inside the container too (the repo and `~/Dev` are mounted).
- Lint: `pnpm lint`  (baseline: ✅ — no warnings)
- Test: `pnpm test`  (baseline: ✅ 562 tests — Node's built-in runner via `tsx`, no extra
  deps; specs live next to the code as `runner/*.test.ts`, `lib/*.test.ts`,
  `lib/discovery/*.test.ts` and `infra/release/*.test.ts`, fixtures in
  `runner/__fixtures__/`. Those globs are listed
  explicitly in the `test` script — a spec in a directory that isn't listed silently never
  runs. DB specs build a throwaway SQLite file from the real schema — via `drizzle-kit push`,
  or `migrateDatabase()` where the committed migrations should be exercised too — and the
  `PLATFORM_DB` override, never `data/platform.db`. **Run them inside the container with
  `RUNNER_HOST` unset** (`docker exec platform env -u RUNNER_HOST pnpm test`): compose sets
  `RUNNER_HOST=0.0.0.0`, which `lib/config.test.ts` correctly asserts is not the default.)
- Typecheck: `npx tsc --noEmit`
- **Schema changes: `pnpm db:generate` then `pnpm db:migrate`.** `db:generate` writes a
  versioned SQL file into `drizzle/` (review it — that file is what runs on every user's
  machine, and it is **not** always a faithful rendering of the schema: drizzle-kit drops the
  `ON DELETE` clause from an `ALTER TABLE ADD COLUMN`, which SQLite does accept, so a new
  nullable FK column silently ships as `no action`. `drizzle/0004` was hand-completed for exactly
  that. Editing the SQL doesn't disturb `db:generate`'s idempotency — CI compares the snapshot);
  `db:migrate` applies what's pending, snapshotting first. Commit the migration with
  the schema change: the release workflow refuses to publish when they disagree.
- `pnpm db:push` is **dev-only** and no longer the migration path — it diffs the schema against
  a live database and has rebuilt the `tasks` table (`__new_tasks` + copy + drop) rather than
  adding columns, dropping the `user_id` foreign key with it. Never run it against a real
  install; it's kept for throwaway databases and for repairing one that drifted.
- Backfills (idempotent, safe to re-run): `pnpm db:backfill-titles` ·
  `pnpm db:backfill-usage` (`--dry-run` / `--all`; recomputes token+cost totals from the
  `result` messages already stored in `task_events` — no model calls, nothing billed)

### Docker dev notes
- The app is host-coupled (drives Claude against absolute host project paths, reuses
  `~/.claude`), so the container bind-mounts `~/.claude` → `/home/node/.claude`, **`/Users`
  and `/Volumes` at their identical absolute paths** (a project must live under a mounted path,
  or the runner can't see it — and the folder picker shows an unmounted path as an empty
  folder), `~/.gitconfig`, and the repo source. Those mounts are deliberately broad: tasks can
  read/write anything under them, `~/.ssh` included. Narrow them in compose (and keep
  `PROJECT_ROOTS` in sync) if that's not wanted. `node_modules` and `.next` are masked by named
  volumes so the Linux-built
  `better-sqlite3` isn't shadowed by the host's macOS build — **never** bind-mount host
  `node_modules` into the container. After a dependency change, `pnpm dev:clean` drops those
  volumes so they re-seed from the rebuilt image.
- **Nothing GUI-bound works inside the container** — no `osascript`, no Finder, no
  `open`. That's why the Add-project **Browse…** button is an in-app folder browser
  (`/api/fs/list`) rather than a native dialog. Compose passes
  `PROJECT_ROOTS=${HOME}:/Users:/Volumes` — *host* paths, since the container's own home is
  `/home/node`; the first entry is where the picker opens, the rest are switchable roots. `/`
  is deliberately not a root: inside the container that's the container's own filesystem, not
  the Mac's, so it would show paths that don't exist on the host.
- **Host OS: macOS as configured; Linux with edits; Windows only via WSL2.** The server code is
  OS-agnostic (`lib/fs-browse.ts` splits `PROJECT_ROOTS` on `path.delimiter`, so `;` on Windows),
  and in Docker it always runs on Linux anyway. What's host-specific is the *wiring*: compose
  mounts `/Users` + `/Volumes` (macOS layout — use `/home`, `/mnt`, `/media` on Linux) and
  interpolates `${HOME}` (Windows sets `USERPROFILE`). A native Windows path can't resolve
  inside a Linux container at all, so the same-absolute-path contract only holds under WSL2.
- **A new route directory is not hot-reloaded.** File watching over the macOS bind mount
  misses newly *created* directories, so adding `app/api/<new>/route.ts` 404s until the dev
  server restarts — the running route table still holds the old tree (check
  `.next/server/app-paths-manifest.json`). Touching files does not help. Same for compose env
  changes: recreate the container (`pnpm stop && pnpm dev`).
- **Claude auth is per user:** each signed-in user saves their own Anthropic token
  (subscription token from `claude setup-token`, or an API key) under **Settings** in the
  UI; it's encrypted (AES-256-GCM) into `data/secrets/<userId>.json` under the required
  `SECRETS_MASTER_KEY` from the repo-root `.env` (see `.env.example`). Tokens are verified
  against Anthropic before being stored, so a bad paste fails in the form. The runner
  injects the task owner's token into every SDK session via `Options.env`; a user with no
  token is told up front (banner + a 412 on dispatch) rather than getting a failed task.
  The legacy shared `CLAUDE_CODE_OAUTH_TOKEN` / `ANTHROPIC_API_KEY` in `.env` are honored
  only with `ALLOW_SHARED_TOKEN_FALLBACK=1` (dev-only). Note: the bind-mounted `~/.claude`
  doesn't carry a usable login on macOS anyway (host login lives in the Keychain).
  - **There is no "Sign in with Anthropic" button and there can't be** — Anthropic does
    not allow third-party apps to offer claude.ai login (Agent SDK docs), and
    `claude setup-token` requires a real TTY so it can't be driven server-side. Only the
    API-key route links out to Anthropic. See `.swe/notes.md` before revisiting this.
- **Git/GitHub:** the image installs `gh` so agents can open PRs (`/swe:ship`, `/fe:ship`)
  and the UI's push/pull work. macOS keychain/SSH creds don't cross into Linux, so set
  `GH_TOKEN` in `.env` (see `.env.example`): `gh` uses it for PRs, and `git` push/pull over
  HTTPS to github.com authenticate through gh's credential helper, wired via `GIT_CONFIG_*`
  env in compose (so nothing writes to the read-only bind-mounted `~/.gitconfig`, and the
  host's macOS `osxkeychain` helper is cleared). SSH remotes need the optional `~/.ssh` mount
  (commented in compose) — or switch the remote to HTTPS and use `GH_TOKEN`.
- The container runs as the non-root `node` user (UID 1000, `HOME=/home/node`); published
  ports bind to `127.0.0.1` only.
- Files: `Dockerfile` (multi-stage dev image), `infra/docker/docker-compose.yml`,
  `.dockerignore`.

## Sign-in, workspaces, and who owns what
Signing in is **optional**. Opening the app with no session makes you the *local workspace*
(`user_local`, seeded by `drizzle/0001_local_workspace.sql` with a password hash that can never
match). Creating an account starts a private workspace instead of unlocking the app.
- **`lib/task-access.ts` is the only thing separating owners.** `proxy.ts` no longer gates
  anything, so every task read goes through `ownedBy` (lists) or `findOwnedTask` (one row).
  Both treat "not yours" and "doesn't exist" identically so callers can only 404 — probing ids
  must not reveal that someone else's task exists. If you add a task query, scope it here.
- **Projects, agents and backlogs are deliberately shared**: a project is a folder on the device,
  an agent is an installed plugin, and a backlog is a description of that folder's planned work.
  Tasks, transcripts and Anthropic tokens are the private part.
- `getCurrentUser()` never returns null now (it falls back to the local workspace);
  `getSignedInUser()` is the one that can, for UI that must tell the two apart.
- **This is app-level separation, not OS-level.** Anyone with filesystem access can read
  `~/.control-center/.env` and the vault. Separate macOS accounts get separate installs and are
  genuinely isolated; two people sharing one login are not.

## Features (how work is grouped)
A `feature` is the unit work is actually organised around — several tasks and several backlog
items, one branch. `lib/features.ts` owns every rule; the routes under
`app/api/projects/[id]/features/` translate HTTP, the same split `lib/backlog.ts` uses.
- **For pm-planned work a feature costs nobody anything, because the grouping already existed
  on disk.** It was the `.pm/tasks/<request>/` folder, buried inside
  `backlog_items.source_path` and never read out. The backlog sync now derives one feature per
  request folder that holds at least one spec (`ensureRequestFeature`, keyed on
  `(projectId, sourceDir)` by a unique index, so it is a no-op on every load after the first)
  and links that folder's items to it. An empty request folder is a folder, not a feature.
- **The name comes from the request's `index.md`** — its frontmatter `title`, else its first
  heading — falling back to the folder name with the timestamp prefix stripped. Deliberately not
  `specTitle`, whose last resort is the *filename*, which is the word "index" for every request
  folder in the project. That read goes through `readSpecFile` like a spec's (O_NOFOLLOW,
  `nlink === 1`, regular files only, size-capped) and is charged to the same scan byte budget: a
  symlinked `index.md` must no more be able to name a feature after `~/.ssh/id_rsa` than a
  symlinked spec can put it in a row.
- **`features.branch` is a reserved name, and it is immutable.** `feature/<slug>`, minted from
  the name by `featureSlug` — an **allowlist** (`[a-z0-9-]`, cut at a word boundary, no leading,
  trailing or doubled dash), because this string becomes a **git ref** that task 02 hands to
  `git` in the runner process. The allowlist is what makes a leading `-` (which git reads as an
  option), `..`, `~^:?*[\`, whitespace and a trailing `.`/`.lock` unrepresentable rather than
  filtered. `lib/features.test.ts` runs the minted names through `git check-ref-format` — the
  regex is an argument, git is the authority. Renaming a feature (or editing its `index.md`)
  changes the name and never the branch: the ref may already exist, and moving it would orphan
  the work on it.
- **One branch per project** (`features_branch_unq`), since two features on one ref would merge
  each other's work. Colliding names get `-2`, `-3`… then the feature's own id; a lost race on
  the unique index is retried once with the id-suffixed form.
- **A synced item's feature is file-owned, so `featureId` is in `FILE_OWNED_FIELDS`** and a
  `PATCH` of it answers 409 naming the file. There is deliberately no `statusOverride`-style
  precedence flag for it: status is the one thing *no file knows*, whereas the request folder
  genuinely does know the grouping, so giving it two owners would be inventing a conflict.
  Someone who wants a spec grouped elsewhere moves the file — or groups its **task**, which is
  freely assignable, because nothing on disk re-derives a task's feature.
- **The sync writes the derived feature as a plain assignment, not `featureId ?? row.featureId`.**
  What keeps a grouped item grouped is that `ensureRequestFeature` resolves an already-derived
  folder *before* it consults `MAX_FEATURES_PER_PROJECT` — so reaching the cap strands only
  *new* folders' items and can't unglue the rest of the project. The fallback was tried first and
  removed: no test could be made to fail with it in place, and in the one state that *is*
  constructible (a feature row deleted with FK enforcement off) it preserved a dangling id.
  `lib/backlog.test.ts` pins the ordering by failing if the cap check moves up.
- **A cross-project `featureId` is refused on every path that accepts one** — dispatch, the task
  PATCH, and both backlog writers — via `parseFeatureRef`/`findFeature`, the stance
  `sourcePath`/`linkedTaskId` already get. Refused rather than dropped: silently unlinking would
  hide the run from every grouped view, and storing it would put this project's work on another
  repo's feature branch once task 02 merges. Addressing a feature through the wrong project
  answers 404, not 403, so ids can't be probed across projects.
- **`PATCH /api/tasks/[id]` is the only owner-scoped one** (`findOwnedTask`, so "not yours" ≡
  "doesn't exist", checked before the body is read). It takes `featureId` and nothing else — a
  task's status belongs to its run, its request text is what the agent was handed. The
  project-scoped feature routes have no auth, like every other project-scoped route here.
- **`MAX_FEATURES_PER_PROJECT` (500) counts every row**, not just open ones as the backlog's cap
  does: nothing closes a feature automatically, and the sync can create one per request folder on
  an unauthenticated GET, so this is what bounds a repo full of `.pm/tasks/` folders.
- `features` is in `EXPORTED_TABLES` **before** `tasks` and `backlog_items` (both carry a
  `feature_id`), so a grouping survives export/import. Both FKs are `set null` — closing out a
  feature must never delete the history of the work done under it. Note drizzle-kit **omits
  `ON DELETE` from an `ALTER TABLE ADD COLUMN`**, so `drizzle/0004_pretty_vapor.sql` was
  hand-completed after generation; a spec asserts the committed SQL, not the ORM's intent.
- The grouped UI is below ("Following one feature in the UI"). Nothing in `lib/features.ts` runs
  `git` — the branch it names is only created, based-on and merged-into by the runner (below).

### The feature branch: lifecycle and merge-back (runner)
Each feature has one real `feature/<slug>` git ref, and a feature-linked task's finished work
ends up merged into it. The *system* merge stays deterministic and never silent — but a real
content conflict now gets **one** shot at being resolved by the run's own still-live session
(below), and a merge that couldn't be *attempted* is retried automatically by the merge sweep.
`runner/worktree.ts` owns the git mechanics; `runner/session-manager.ts` wires them into
dispatch and `finalize()`; `runner/merge-sweep.ts` is the retry half; `lib/git.ts` holds the
hardened merge primitive.
- **A feature-linked parallel run always isolates, busy checkout or not.** `launchMode` gained
  a `feature` input: `canIsolate && (workdir || (parallel && (busy || feature)))`. Before this,
  isolation only kicked in when the checkout was already busy — so the *first* of N parallel
  siblings dispatched against a free checkout would land directly in it, un-isolated, with no
  branch to base on and nothing for the merge step to find. A non-parallel feature run is
  unaffected: it stays a plain checkout run, on purpose (next bullet).
- **On that first isolated run, `ensureFeatureBranch` creates `feature/<slug>` off the
  project's `defaultBranch`** (a plain `git branch <name> [<base>]` — never a checkout, so it
  never touches the working tree and is safe to run even while another session is live in that
  same checkout). Idempotent, and hardened against the one real race: two feature-linked tasks
  dispatched at once both find the ref missing and both attempt the create; `git branch` is
  atomic, so exactly one succeeds, and the loser's failure is swallowed once `branchExists`
  confirms the winner's ref is already there. Anything else (an unusable `base`) still throws.
  `ensureTaskWorktree` then takes an optional `baseRef`: the task's own `task/<id>` branch is
  created **at the feature branch**, not at the checkout's current HEAD — that's what gives
  every task of a feature (and the merge below) a common ancestor. `baseRef` only matters on
  first creation; reattaching an existing branch (continue, or a recreate after cleanup)
  ignores it, same as it already ignored HEAD.
- **On `done`, the merge-back runs *before* the task is sealed (`mergeOnDone`, called from
  `finalize()`), and where it runs depends on where the feature branch is checked out.**
  `mergeFeatureTask` (`runner/worktree.ts`) decides per attempt:
  - branch checked out **nowhere** → a **throwaway worktree of the feature branch** under the
    **OS tmpdir, not `WORKTREES_DIR`** (it must never count against `MAX_WORKTREES`),
    force-removed (plus a defensive `rmSync`) before returning either way;
  - branch checked out **in the project's main checkout** → the merge runs **there**, but only
    while no session is live in it (the caller passes `mergeInMainCheckout`). This was the
    single biggest source of bogus "conflict" rows: a checkout run leaves the feature branch
    checked out (the preamble tells it to work there), git refuses a second checkout of one
    branch, and the failed `worktree add` used to be recorded as a content conflict. Merging
    in place advances the user's checkout together with the branch — which is what a checkout
    sitting on that branch means — and `gitMerge` aborts clean on any failure;
  - branch checked out **anywhere else**, or the checkout is busy → `"blocked"`, retried later.
  It never touches the task's own worktree (still needed a moment longer to read the branch
  off), and never merges a branch with no commits of its own (`branchContained` pre-check —
  a `--no-ff` merge of an already-contained branch answers "Already up to date" and used to
  read as `"merged"` even for a run that committed nothing).
- **The actual merge (`gitMerge`, `lib/git.ts`) is `git merge --no-ff --no-edit <branch>`,
  aborting on any failure, and it classifies what happened.** `--no-ff` always leaves a merge
  commit — without it, the first task merged into a fresh feature branch would fast-forward
  with no merge commit while every later one (having diverged) couldn't, an inconsistency with
  nothing to do with the content. On failure `merge --abort` runs immediately, so no tree is
  ever left mid-merge, and the task's branch is never touched either way. `MergeResult.conflict`
  is decided **structurally, before the abort**: `MERGE_HEAD` exists only once a merge genuinely
  started and stopped needing resolution, so a refused merge (missing ref, dirty files in the
  way) can never read as a content conflict. Deliberately not `ls-files -u` through `runGit` —
  that helper maps empty output to `"Done."`, so emptiness there is unreadable (found by a spec
  that asserted a missing branch isn't a conflict and failed).
- **The outcome is recorded on the task row as `mergeState`** (`lib/db/schema.ts`; migration
  `drizzle/0005`) — now five states, and the column is plain text with no CHECK, so widening it
  needed **no migration**: `"pending" | "merged" | "conflict" | "blocked" | "no_commits"`.
  `"pending"` is set at **dispatch** (`lib/dispatch.ts`) the moment a `featureId` is attached
  — and by `setTaskFeature` when a task is grouped by hand *after* dispatch, which used to
  leave null forever (indistinguishable from ungrouped, so the chip silently omitted itself).
  `"conflict"` now means a **real content conflict only**; `"blocked"` is "couldn't be
  attempted" (retryable, nothing to resolve); `"no_commits"` is "the branch holds nothing to
  merge" — honest for a run that ended `done` without committing (its kept worktree still has
  the work; the log entry says so). A **non-isolated run stays `"pending"` forever** — the
  platform never system-merges one, so that is the honest answer, not a stuck one. `mergeState`
  is independent of the task's own `status`: a task can be `done` with `mergeState:
  "conflict"` at once — the agent's work finished; the system's merge of it didn't.
- **A real conflict gets one automatic resolve turn in the same live session, then the merge
  is retried — nothing is ever auto-picked.** On `conflict`, `mergeOnDone` records the state
  first (a cancel mid-resolve keeps the honest answer), then pushes `mergeResolvePrompt` into
  the session: merge the feature branch *into your branch* in your own worktree, reconcile
  both sides — never discard either — commit, no gates, no push. When that turn ends,
  `finalize()` re-runs the deterministic merge, which now fast-forwards content-wise; if it
  still conflicts, `"conflict"` stands, exactly as before. Bounded by
  `handle.mergeResolveAttempted` (one attempt per run, ever) and it costs one extra agent turn
  on the owner's token, logged in the transcript. The delicate part is turn accounting:
  a mid-turn `[[DONE]]` finalize pushes the prompt while that turn's own `result` is still in
  flight, so `mergeResolveSwallowResult` eats exactly that one stale result — otherwise the
  handler would re-attempt the merge before the agent had even seen the prompt and seal the
  task as `conflict` with the resolution still ahead of it. The stream-end finalize passes
  `resolve: "none"` (the input channel is closing; a pushed turn could never run).
- **`blocked` merges retry themselves: `sweepFeatureMerges` (`runner/merge-sweep.ts`)** runs
  at boot and from `promoteNext` — i.e. every time a project's checkout frees up, which is
  exactly when a merge blocked on that checkout can succeed (it passes
  `mergeInMainCheckout: true`; at that instant nothing is live there). It also **reclassifies
  from the object store**: any `blocked`/`conflict` row whose branch is now fully contained in
  the feature branch becomes `"merged"` (someone resolved it by hand — that is also what heals
  rows the old catch-all mis-recorded), or `"no_commits"` when the run's kept worktree is
  still dirty (marking that "merged" would hide uncommitted work). A `conflict` row with real
  divergent commits is **left alone** — it needs reconciling, not retrying on every sweep.
  Every state change writes a log event into the task's transcript; a chip that silently flips
  is a mystery. Bounded (`MAX_SWEEP_TASKS`), best-effort, and one task's git hiccup never
  stops the rest — or boot, or the queue.
- **A non-isolated (checkout) feature run gets an instruction-level guarantee only, and says so
  to the agent.** The platform can't system-merge a run sharing the user's own checkout, so
  `featureBranchPreamble` (`runner/session-manager.ts`, exported for its own spec) appends a
  line naming the feature and its branch to the dispatched prompt — resent on **every** launch
  (fresh dispatch, continue, and resume alike), since a fresh subprocess remembers nothing of
  an earlier one's instructions. Decided from `handle.worktree` (set, or not, by the
  isolate/queue/run branch before `launch()` ever runs — including the deferred "queue" case),
  not from `mode`, which would read "queue" forever even after a queued task is promoted and
  actually runs un-isolated. Degrades to an empty string if the feature was deleted mid-run
  (`featureId`'s FK is `set null`, so the task can briefly outlive the row) — naming a branch
  that no longer means anything would be worse than saying nothing.
- **No new hook or config exposure.** `gitMerge` goes through `runGit` (the existing
  `repoOpts`/`gitEnv`/`NO_HOOKS`/timeout wrapper); the temp-worktree creation/removal in
  `runner/worktree.ts` goes through that file's own long-hardened `git()`. Verified directly,
  not just inferred from sharing the wrapper: `post-merge` was already in `lib/git.test.ts`'s
  planted-hook set but only ever exercised via `gitPull`'s fast-forward; a real `gitMerge` call
  (prepared before the plant, like every other fixture command in that test) is now in it too.
- **Every new ref reaching git gets the same leading-dash guard the rest of the file already
  uses**, even where the value is provably safe today: `mergeFeatureTask`'s `featureBranch`
  always comes from `features.branch` (an allowlisted slug that can never start with `-`), but
  the function takes a bare string, so it's guarded anyway — defense in depth, not paranoia
  about a path that's actually reachable right now.

### Managing feature groups (create, rename, close out, delete)
Features were readable everywhere and editable nowhere: the sync derived them, a picker assigned
work to them, every list rendered them as headings — and there was no way to add one, fix a name,
or retire one. `components/FeatureManager.tsx` (a full-width **Features** card on project detail)
is that half; `deleteFeature` in `lib/features.ts` is the only new rule, and `DELETE
/api/projects/[id]/features/[featureId]` only translates it.
- **Delete ungroups; it never destroys.** Both FKs are `set null` and `foreign_keys` is ON, so
  tasks (with their transcripts) and backlog items survive the row that grouped them. Deleting is
  the honest verb for "this grouping was a mistake" — `status: done` keeps the heading forever as
  collapsed history, which is right for finished work and wrong for a group nobody wants.
- **`mergeState` is cleared by hand, because the FK can't.** `ON DELETE SET NULL` only touches
  `feature_id`, so without this an ungrouped task keeps `blocked`/`conflict` — breaking the
  invariant `setTaskFeature` documents (`mergeState` null ⇔ no feature) and rendering a chip that
  promises a retry `sweepFeatureMerges` can never perform, since it joins *through* `featureId`.
  Done in one transaction with the delete so neither half is observable alone.
- **A sync-derived feature is refused (409), not deleted.** `ensureRequestFeature` re-derives one
  per `.pm/tasks/<request>/` folder on the next backlog load, so a delete would appear to work and
  then silently undo itself. Same stance renaming one already gets, and the message names the
  folder to remove instead.
- **A feature with a live task is refused (409).** That run's merge-back reads `featureId` when it
  finishes (`mergeOnDone`) and targets this feature's branch; pulling the row out from under it
  would silently drop the merge and leave committed work on `task/<id>` with nothing pointing at
  it. Finished/failed/cancelled runs never block it — history is not a reason to keep a grouping.
- **It never runs git.** The `feature/<slug>` ref and every commit on it are untouched; nothing in
  `lib/features.ts` has ever executed git and this didn't change that. The response and the
  confirmation dialog both say so, because "delete" on a thing spanning several tasks reads as
  "delete the work".
- **The DELETE response returns the backlog-item count and *not* the task count.** A backlog item
  is documented as shared install-wide, so counting them discloses nothing; a task is private to
  whoever ran it (`lib/task-access.ts`) and this route has no auth, so an aggregate over
  everyone's tasks would be a new cross-user disclosure. `backlogCountsByFeature` exists for the
  same reason — the card says "task history stays, ungrouped" with no number.
- **Project-scoped like every sibling route, which is what bounds a destructive unauthenticated
  verb.** `findFeature(projectId, featureId)` means a feature addressed through the wrong project
  answers **404**, so ids can't be probed across projects and nothing can be deleted through a URL
  it doesn't belong to. The wider no-auth gap is the one documented for the backlog routes; it
  wants the same fix, not a special case here.
- **`featureRowActions` (`lib/ui.ts`) decides what a row offers**, and it does *not* consult live
  tasks — that refusal depends on rows a shared page can't scope to the reader and changes second
  to second, so it stays a server 409 surfaced as an error **on the row that was clicked**.
- **The "why you can't edit this one" note is card-level, not per-row** (`FILE_OWNED_FEATURE_NOTE`).
  It began as a sentence on every derived row, which reads fine for one and is a wall of text for a
  pm-planned project — measured on this repo, all twelve features were derived, so the list carried
  twenty-four lines of the same explanation. The **folder path** varies per row and stays there;
  the rule is said once, and only when a derived row is actually on screen.

### Following one feature in the UI
Three surfaces group work by feature — `/backlog`, project detail's Task history and `/tasks`
(project → feature) — so one feature's development can be read on its own. `components/
FeatureGroup.tsx` is the single heading; the grouping and merge-state rules are pure functions in
`lib/ui.ts` with specs, because `pnpm test` cannot reach `components/`.
- **`groupByFeature` returns `null` when no row has a feature, and that null is the contract.**
  Every caller then renders the flat list it always rendered, so an install that has never used a
  feature is byte-identical to before — grouping everything under one "No feature" heading would
  add a level of hierarchy that conveys nothing. The ungrouped bucket sorts **last** and exists
  only when something is in it. A row whose `featureId` doesn't resolve lands there rather than
  vanishing: `feature_id` is `set null`, so a row can briefly outlive its feature and work must
  never disappear from a list because its grouping did.
- **Every feature group is a disclosure.** `FeatureGroup` is a client component holding the
  open state; the heading (name + chevron, a real `<button>` with
  `aria-expanded`/`aria-controls`) always renders, the rows fold under it. Active features and
  the ungrouped bucket start open, closed features start collapsed
  (`featureGroupDefaultOpen`, spec'd) — their rows are history that would otherwise push live
  work below the fold. Deliberately **not persisted**: a remembered collapse is a filter, not
  a fold. The chips and the count stay outside the button — the branch chip is a string to
  copy, and folding it into the button would make it unselectable without toggling.
- **A row's chip goes through `mergeChipView` (`lib/ui.ts`), and `pending` is no longer one
  word.** The old label "Not merged" was read by a real user as a verdict on work that was in
  fact sitting *in* the feature branch (a checkout run's agent commits there directly). Now:
  a cancelled/failed run whose merge was never attempted gets **no chip**; a live run that may
  isolate reads "Merges when done"; everything else reads "In checkout", with a tooltip
  explaining the agent commits directly. Recorded outcomes render as themselves — labels,
  tones and tooltips all come from `MERGE_STATE_LABEL`/`mergeStateTone`/`MERGE_STATE_TITLE` in
  `lib/ui.ts` (the tooltips moved out of the component so the whole vocabulary is testable).
- **`featureMergeSummary` never counts `pending` or `no_commits`, and does count `blocked`.**
  A checkout-bound feature run stays `pending` forever by design (above), so aggregating it
  would put a permanent "N pending" on every heading — a queue that never drains. `blocked`
  IS that queue's opposite: the sweep genuinely drains it, so "N waiting" earns its chip.
  `no_commits` is terminal with nothing anyone will do about it. A spec pins all of it.
- **A merge conflict is toned `warn`, not `danger`** — the merge failing is not the *run*
  failing (a task can be `done` with `mergeState: "conflict"`), and reserving `danger` for a
  failed run keeps the two tellable apart in a list holding both. `blocked` is `muted`, not
  `warn`: it needs nothing from the user, and a caution tone would summon them to a job the
  sweep already owns.
- **The `feature/<slug>` branch chip wraps and is never truncated.** It is the string a user has
  to type into `git checkout`, so a truncated prefix is useless and a `title` tooltip is
  unreachable by keyboard. It is `min-w-0` + `break-all`, **not** `shrink-0` — at `featureSlug`'s
  60-character cap a rigid mono chip forced 95px of horizontal page overflow at 390px (measured;
  164px at 320px).
- **The feature pickers take the project's features as a prop, not a fetch.** Both hosts
  (`NewTaskForm` on project detail, `AddBacklogItem` on the backlog) render inside server
  components that already hold the rows, so `GET …/features` would buy a loading state for data
  already on screen. The route stays for other consumers. Closed features are offered by neither
  picker — new work must not land on a branch shown everywhere as finished — while still
  appearing as groups in every list.
- `listBacklog`'s `linkedTask` projection grew `mergeState` alongside `id` and `status`. That a
  run happened and how it ended is not the private part; the transcript is. A spec `deepEqual`s
  the whole object, so a fourth column can't reach a shared list unnoticed.

## The backlog (per-project planned work)
Each project has a durable queue of planned work in `backlog_items`, fed from two directions:
the pm agent's `.pm/tasks/<request>/<task>.md` specs, and items added by hand (or by an agent).
`lib/backlog.ts` owns all of it; the routes under `app/api/projects/[id]/backlog/` only
translate HTTP. An item can be dispatched as a real task and links back to it.
- **Reading the backlog is what keeps it current.** `GET` syncs the spec files and reflects
  finished runs, both idempotent, so there is no separate sync call to forget. The trade is
  that a load does synchronous filesystem I/O on an unauthenticated route, in the process that
  also serves the SSE task streams — so the scan's caps are a DoS budget, not tidiness:
  256 KB per spec, 500 specs, 200 folders, 200 entries per folder, **and a 2 MB total** (the
  product of the first two would otherwise permit a 128 MB read *and* a 128 MB response).
- **Request folders are walked newest-first, and a clipped scan says so.** The names start with
  a timestamp; walking oldest-first meant that once a project hit the cap — and these folders
  are committed, so they never age out — every newly planned spec was silently ignored forever.
  The scan reports `skipped` (entries it refused) and `truncated` (a cap stopped it), which the
  route turns into `warnings`, so "nothing imported" can't be mistaken for "nothing to import".
- **`sourcePath` (project-relative) is the sync key**, unique per project. SQLite treats NULLs
  as distinct in a unique index, which is what lets any number of hand-added items coexist.
- **The sync never touches status.** Content is re-read from the file (an edited spec should
  dispatch its current text); status, `linkedTaskId` and the item's identity are things no file
  knows. A spec deleted from disk therefore *keeps* its item.
- **A manual status wins, permanently.** `PATCH`ing status sets `statusOverride`, after which
  neither the sync nor the linked-task reflection will move that item. Machine transitions
  (dispatch → `in_progress`, linked task `done` → `done`) leave the flag alone, or running an
  item would freeze it against its own completion. A task that started and then *failed*
  deliberately leaves the item `in_progress` — it was started and didn't finish; the linked task
  shows the truth. A dispatch that never started at all (runner unreachable → 502) leaves the
  item untouched at `todo`, since there is nothing to resume; the failed task row is still there.
- **Everything a spec file owns is read-only through the API** (title, description, assignee,
  priority): accepting those edits would be a lie, since the next load re-reads the file. The
  route answers 409 and names the file. Hand-added items are fully editable.
- **Clients may not set `sourcePath`, `source` or `linkedTaskId`.** A forged `sourcePath` would
  park a row on a path the sync then treats as already-imported; a forged `linkedTaskId` would
  point an item at someone else's task. The parser drops them.
- **A spec is read through its handle, never re-resolved by path** (`readSpecFile` in
  `lib/backlog.ts`): `open` with `O_NOFOLLOW`, then `fstat`, then a read bounded by the size
  `fstat` reported. This is the arbitrary-file-read defence, and each clause earns its place —
  a repo can hold a symlink named `01-task.md` pointing at `~/.ssh/id_rsa`, the backlog is
  shared with every user on the install, and the content also travels in export archives.
  - `nlink === 1` rejects a **hard link**, which is the non-obvious one: a hard link is a plain
    regular file by every other measure (`Dirent.isFile()` says true), so the dirent check alone
    was bypassable. Note the cost, measured: hard-linking a spec makes **both** names unreadable,
    the legitimate original included, since `nlink` is a property of the inode and not of the
    name you opened. That surfaces as a `warnings` entry on the load, not as silence.
  - Checking the handle rather than the path is what closes the **TOCTOU** window — classify a
    dirent, then open by name, and it can be a different file by then. The scan re-runs on every
    load, so an attacker retries for free until it wins.
  - Everything non-regular is skipped *without being opened for reading*. That matters most for
    a **FIFO**: reading one blocks until someone writes, i.e. forever, taking the request with it.
  - Names containing control characters are skipped — a newline in a `sourcePath` would forge
    lines in the preamble a dispatched run is handed.
- **A run is stamped to whoever pressed it**, not to whoever added the item: it goes through
  `lib/dispatch.ts` like any other task, so it runs on that user's token and only they see the
  transcript. Its `linkedTask` is exposed to everyone as `{ id, status }` and nothing more.
  An item whose task is still live refuses a second run (409) — a double click shouldn't buy
  two sessions.
- **The file modal's "Create task" is the same dispatch, not a second one.** `FileModal` resolves
  the spec's item (`GET …/backlog` — the load that syncs, so an on-disk spec is guaranteed
  present) by `specSourcePath()` and then calls this route, so a spec dispatched from a
  transcript moves its item exactly as the Run button does. Dispatching straight to
  `POST /api/tasks` left the item at `todo` with no `linkedTaskId` forever, which is what made
  the backlog's own status untrustworthy. That direct dispatch is now only the fallback for a
  spec the backlog *cannot* hold — a workspace member's, or one the scan refused. A lookup that
  **fails** is deliberately not that fallback: it refuses and says so, because `POST /api/tasks`
  has no duplicate check, so guessing would turn one transient error into two concurrent
  sessions on the same spec, billed to the user twice.
- **A run reuses the item's title, so no model renames it.** `DispatchInput.title` is stored on
  the row, and the runner only names a task whose row has *no* title (`nameTask` in
  `runner/session-manager.ts`) — passing it through is what suppresses the Haiku call. The item
  was already titled, by its spec's frontmatter or by whoever filed it; paying the owner's
  tokens to summarise that into something shorter produced a worse name. Titles are normalised
  (one line, 80 chars) and an empty one stays null so the runner still names those.
- **An item can be assigned to `pm`, and that means "investigate this", not "build it".**
  `BacklogAssignee` (`lib/pm-spec.ts`) is `fe | swe | pm`, while `SpecAssignee` stays
  `fe | swe` — a pm spec routed back to pm would be a loop, and `targetNamespace` must always
  land on someone who implements. A pm-assigned item dispatches **`/pm:plan`** (pm has no
  `task` skill), and the specs that plan writes re-enter this same backlog through the
  `.pm/tasks/` sync — that round trip is the escalation path for a finding nobody could scope.
  The command is keyed off the agent actually chosen, so falling back to swe (pm not installed)
  still dispatches a skill swe has. The column is typed only, so this needed no migration.
- **Only the project root's `.pm/tasks/` is scanned.** For a workspace project
  (`projects.members`), specs planned inside a member repo don't enter the backlog, even though
  `lib/pm-spec.ts` recognises the nested path form. Deliberate for now — a workspace's members
  are separate repos with their own registrations.
- **Items are capped at 1 000 *open* per project** and 20 000 characters of body: the list returns
  every item's body on every load, and an uncapped POST is a disk-fill primitive. `done` and
  `cancelled` items don't hold a slot — there is no delete endpoint, so cancelling is the only
  reclaim path and it has to actually reclaim, or a project that hit the cap could never come back
  under it.
- **An agent can file one itself**, via the `add_backlog_item` MCP tool on the runner's
  in-process server (`runner/backlog-tool.ts`) — that's what `source: "agent"` means. It goes
  through the same `lib/backlog.ts` validation as the HTTP route, so the two paths can't drift,
  and it is the only writer that isn't a person. Three things are deliberate about it:
  - **The project is not a tool argument** — it comes from the task's own row. A backlog is
    shared install-wide, so an agent that could name a project could file work into someone
    else's list.
  - **The row is scrubbed of the task's credentials** before it's written. `record()` only
    covers `task_events`; a backlog row is read by *every* workspace and travels in export
    archives, so an agent talked into pasting the owner's token into a description would
    otherwise park it somewhere wider than the transcript redaction was written to protect.
  - **Its allowance is per launch** (20 items, 4 000 characters of description each — a tenth of
    what a person may type, since a model can max the field out on every call), on top of the
    per-project 1 000. A continued task gets a fresh 20, so the per-project cap is the real
    ceiling. An add is refused, never silently dropped, and both the add and the refusal are
    logged into the transcript.
  - **A repeat title is answered with the existing item, not a second row.** Agents retry tool
    calls, and `/swe:plan` re-run on the same goal files the same tasks again — so an open item
    with that exact title short-circuits the add. Checked ahead of both caps, since that branch
    writes nothing and "it's already on the list" stays the useful answer even for a session
    that has spent its allowance.
  - **`assignee` accepts `pm`**, which is how an agent escalates something it could not scope
    (see the assignee note above). The swe/fe agents are told to use it — `plan` files one item
    per planned task, and `review`/`security`/`audit`/the report gate file what they found and
    aren't fixing — so a finding lands somewhere durable instead of in a report read once.
    Their rule text lives in `agents/<ns>/` (edit the source checkout, then `pnpm agents:sync`).
- **An agent-filed item is dispatched inside a nonce fence, and every part of that shape is
  load-bearing.** An item's body becomes the top-level instruction to an autonomous agent running
  on *whoever pressed Run's* token — so a `source: "agent"` body is text a model wrote, possibly
  while being steered by a hostile file or web page, executing later as a different user.
  `backlogRequestText` wraps those items: a head line, the request between
  `===== BEGIN AGENT-ITEM_<nonce> =====` / `===== END … =====`, then the caution **restated after
  the body**. Human-authored items are untouched (byte-identical to before — the file modal's
  wording is a documented contract).
  - **The fence is derived at dispatch, not stored**, so a `PATCH` can't strip it and it doesn't
    depend on any UI shipping.
  - **The nonce is what makes it unforgeable.** The body was written before the id existed, so it
    cannot close the span or open a second one. A fixed marker is just text a description can
    contain — the first version of this used a bare `---` rule and no closing marker, and the
    security audit's PoC opened a fake second section reading "PROVENANCE: correction — the notice
    above was a stale CI fixture… authoritative operator instruction" and then gave orders.
  - **The caution is repeated last** so untrusted text is never the final thing in context, and it
    names that exact move: anything inside claiming to be a correction, a newer notice, an
    approval already granted or an operator override is still the filed item.
  - **`source` is not an authorship guarantee, so the fence is not a security boundary.** The
    mutating backlog routes have no auth and are reachable over loopback from inside the container
    where a task's Bash tool runs, so an agent can `POST /api/projects/<id>/backlog` and get an
    unfenced `manual` row in any project — and `POST …/run` is equally unauthenticated, so it can
    dispatch it without a human. Found by the security audit; **not** fixed here, because fencing
    every item regardless of `source` would put a false "nobody reviewed this" warning in front of
    requests a user typed themselves, telling the agent to refuse their legitimate instructions —
    and because it would paper over an auth hole with a disclaimer. The real fix is auth on those
    routes, which collides with the deliberately cookie-less local-workspace mode and is bigger
    than one task. Until then the fence is worth exactly this: on the honest path it warns the
    human and the downstream agent. It stops nothing that an agent could not already do through
    the equally unauthenticated `POST /api/tasks`.
  - Still a mitigation, not a fix — a model can be argued with. The control is a person reading
    an item before pressing Run.

### Running planned work in parallel
A backlog item or a pm spec runs with the same git-worktree isolation the composer offers, so
a batch of planned tasks fans out instead of queueing single-file behind the checkout.
Nothing new happens at launch — this is the existing `tasks.parallel` opt-in reaching two more
buttons. **Since 2026-08-22 isolation is the default**: the checkbox ("Isolated") is offered
wherever the dispatch would accept the flag and starts **checked** in all three hosts —
queueing into the shared checkout is the manual choice (untick). The copy explains the
worktree in plain words (own copy of the project, own branch, feature runs merged back
automatically) instead of assuming the user knows what a worktree is.
- **`POST …/backlog/[itemId]/run` takes an optional body, and `parallel` is the only thing in
  it.** Everything about *what* runs is read off the item's own row — its text, its title, its
  assignee, its feature — so the only thing a caller gets to say is *how* to launch it.
  `parseRunOptions` (`lib/backlog.ts`, beside the other parsers because the routes are thin) is
  what enforces that: unknown keys are dropped, so a forged `featureId`, `title` or
  `linkedTaskId` in the body reaches nothing.
- **No body, an empty body and an unparseable body all mean "run it normally".** The route took
  no body at all until this, and both existing callers sent none — so the read is
  `await req.json().catch(() => null)`. An unhandled throw here would be an HTML 500, which the
  UI can't read an error out of (the same failure `readFormData` exists to prevent on the
  multipart routes).
- **A non-boolean `parallel` is a 400, not a coercion.** Coercing fails invisibly: the run just
  queues, which is exactly what it would have done had nobody asked for isolation, so the caller
  can't tell their flag was dropped. Parsed after the project/item 404s, so a malformed body
  can't turn a missing id into a different status code and be used to probe for ids.
- **`parallelOffer` (`lib/dispatch.ts`) is the one definition of when the choice is offered** —
  a plain git repo that isn't a workspace, i.e. **exactly where the dispatch accepts the
  flag** — and it lives beside `createAndStartTask` because **the offer must not drift from
  the refusal**: offering the flag where the dispatch answers 400 turns a click into a dead
  end. `lib/dispatch.test.ts` pins the two together by asserting they agree row-for-row,
  rather than restating either one's logic. Shared by the project composer, the backlog and a
  task page's file modal. It **no longer consults busyness** (and `checkoutBusy` is gone with
  no other consumer): the busy clause made the offer a page-load snapshot — the first dispatch
  against a free checkout never saw it, a batch needed a reload between runs, and a
  feature-linked task dispatched without the flag ran in the checkout, checked the feature
  branch out there, and blocked every isolated sibling's merge-back (the exact failure
  measured on a real install). The flag is harmless on a free checkout: the runner re-decides
  at launch, and free + no feature simply runs in the checkout as before.
- **The clients gate on `parallel && parallelOffer` before sending**, so a stale checkbox can't
  send a flag that will be refused. Not a security boundary — the server's refusal is — just the
  difference between a run that queues and an error the user can do nothing about.
- `FileModal` carries the choice down **both** of its paths: through the backlog item where one
  exists (which is what keeps the item's status honest), and through `dispatchDirect` →
  `POST /api/tasks` for a spec the backlog can't hold. A spec is worth isolating either way.
- Per row, not per page: one item may be worth isolating while the next should wait its turn. The
  checkbox is dropped from a row whose Run button can't dispatch anyway (`done`, or already
  running), and its accessible name carries the item's title — a page holds dozens of them.

## A task's own changes (the task page's Changes card)
`GET /api/tasks/[id]/changes` answers "what did *this run* change", for both a plain checkout run
and a parallel run's isolated worktree. `lib/task-root.ts` resolves the root; `gitChanges` /
`gitFileDiff` are consumed **unchanged**, so all the hardening in the section below applies
untouched — this feature adds no git call of its own.
- **The only input is the task id.** No path, no directory, no project parameter: the root comes
  from the rows (`findOwnedTask` → the task, its `projectId` → the project). So the containment
  machinery below isn't bypassed here, it simply isn't reachable. Owner scoping is the whole
  boundary, and "not yours" answers exactly like "doesn't exist" (`lib/task-access`).
- **"Is this directory still a worktree" is a stricter question than it looks, and two weaker
  answers were both reproduced.** For a directory git no longer recognises, git walks *up* — and
  `data/worktrees/` is **inside the platform's own repo in a dev checkout** — so the panel rendered
  the platform checkout's entire change set under the task's name. `existsSync(workdir)` misses it;
  `existsSync(workdir + "/.git")` **also** misses it, because that is true for an **empty directory
  named `.git`** and for a symlink to a non-git directory, and git walks straight past both (found
  by the security audit, no race needed — one `mv .git .git.real && mkdir .git` from inside the
  worktree). `isTaskWorktree` (`lib/task-root.ts`) therefore requires: `.git` is a **regular file**
  (`lstat`, so a symlink is judged as itself, and nothing non-regular is ever opened — a planted
  FIFO would block the request), small enough to be a pointer, holding a `gitdir:` that **exists**
  and resolves **under the project's own `.git`** — which is also what bounds a *retargeted*
  pointer, the documented "`.git` file redirects a whole repo" class, at the one place holding both
  `project.path` and `task.workdir`. Containment is skipped when the project is *itself* a linked
  worktree (its `.git` is a file, so its worktrees' admin data lives under the main repo): a false
  negative there would silently show "no changes" for a legitimate run.
  - **Not race-free.** `.git` can go away between the check and git's own discovery in the child;
    the audit reproduced that across the spawn window. Closing it needs `GIT_CEILING_DIRECTORIES`
    on every invocation in `lib/git.ts` (the audit verified it works and leaves legitimate repos
    byte-identical) — shared git hardening this feature consumes unchanged, so it is filed, not
    smuggled in. What survives the clauses above leaks file *names* and line counts, never content.
  - `lib/task-root.test.ts` pins each clause **and** characterises the leak it prevents; reverting
    the guard to either weaker form turns four specs red (verified by reverting).
- **A removed worktree never falls back to the project checkout**, the same stance the diff route
  already takes: the checkout's uncommitted state belongs to whatever is running there now, so
  showing it as a finished isolated run's work would credit this task with someone else's edits.
  It reports its own `worktree-removed` scope and names the branch the commits are on.
- **The card states whose changes it is showing**, because "Changes" on a task page implies
  ownership it can't always claim: a worktree run's list *is* exclusively that run's (so it renders
  expanded), while a checkout run's is a shared tree's (collapsed, with a line saying so).
- **Not polled** — two git subprocesses per load, in the process that also serves the SSE streams.
  It refreshes when the run ends (`TaskLiveView`'s `router.refresh()` changes the server-rendered
  `status` prop) and on demand. Changes during a long run aren't live; that's the trade.
- Clicking a file opens the diff through the existing `/api/projects/[id]/diff?…&task=<id>`, which
  resolves the same worktree — `ChangesList`/`DiffModal` take an optional `taskId` for exactly that
  and send nothing extra when it's absent (the project page's own list is unchanged). Note those
  two routes still gate on a bare `existsSync(task.workdir)`; this card is what makes `?task=`
  one-click reachable, so moving them onto `resolveTaskWorkRoot` is filed.
- **The card's render decisions live in `taskChangesView` (`lib/ui.ts`), not in the component.**
  `pnpm test` cannot reach `components/`, and this is the branchiest part of the feature — which
  scope is exclusive, when to hide the card entirely, when "empty" is honest — so it sits beside
  `orderSkills` with specs. A stale response can't overwrite a newer one either: two loads overlap
  when a run ends mid-refresh, so `load()` stamps a sequence number and drops superseded replies.

## Global search (`GET /api/search`)
One query, four types — tasks, projects, agents, backlog items — sized to drive an as-you-type
command palette. `lib/search.ts` owns the queries, the types and every bound; the route is auth
plus two parsers plus one call, the same split as `lib/backlog.ts`.
- **Tasks are scoped to the caller (`ownedBy`); projects, agents and backlogs are not.** That
  asymmetry is the whole security story: a task and its transcript are private, so an unscoped
  search would be a text box for probing other people's work — type "invoice" and learn someone
  on this install is working on invoices. The other three are documented shared install-wide and
  each is already returned by its own unauthenticated route, so searching them discloses nothing
  new.
- **Search deliberately shows exactly the tasks the task lists show.** `ownedBy` excludes the
  legacy null-owner rows, so on an install where those dominate search looks sparse — which is
  correct, because `/api/tasks`, the dashboard and the project/agent pages all exclude them too.
  **If search and the task lists ever disagree about what you can see, search is the wrong side.**
- **`q` is echoed back (trimmed) on every path, `tooShort` says whether it ran.** One meaning
  each. Blanking `q` when nothing ran broke the cheapest client staleness guard there is —
  `if (res.q !== input) discard` — by discarding the very response that carries `tooShort`, so
  the palette could never render its "keep typing" state.
- **A too-short query (< 2 chars) is a 200 with empty lists and `tooShort: true`, not a 400** —
  this endpoint is typed into, and an error on the first keystroke is a flash the palette would
  have to suppress. Genuinely malformed input (`q` over 200 chars, `limit` outside 1…25) *is* a
  400, and **refused rather than clamped**: results must never quietly answer a different question
  than the one asked. `searchAll` independently refuses an over-long query and clamps a bad limit,
  so a caller that skipped the parsers gets nothing rather than an unbounded scan.
- **The `ESCAPE` character is a bound parameter, never written into the SQL text.** Spelled inline
  it is a trap the specs caught immediately: in a JS template literal `ESCAPE '\'` is an escaped
  *quote*, so SQLite got `ESCAPE ''` and every query threw. Escaping itself is **correctness, not
  injection defence** (the pattern is always parameterised) — an unescaped `%` means "match
  everything" and `_` means "any character". `escapeLike` covers `\ % _` in one pass over a
  character class, so the escape character it inserts is never rescanned, and `prefixFirst`'s
  `ORDER BY` reuses the same binding rather than opening a second escaping surface.
- **A snippet cap must count code points, not `String.length`.** SQLite's `substr` counts
  characters while JS counts UTF-16 units, so 150 emoji came back from SQL whole and were then
  declared over-long and cut in half — and slicing at a UTF-16 offset can split a surrogate pair
  into a replacement character. Cut with `[...value]`, like `cleanTitle` in `lib/dispatch.ts`.
- **Bodies are matched but not returned, and the two types differ for a reason.** A backlog
  description runs to 20 000 chars and its item always has a non-empty title, so there's no
  fallback text to supply — matched, then dropped. A *task* may have no title at all, so
  `taskDisplayTitle` needs its `requestText`, which is returned but `substr`-capped **in SQL** so
  the untruncated value never enters the process.
- `hasMore` comes from over-fetching `limit + 1`, not from four `COUNT(*)`s over the same
  predicates — that would double the work to report a boolean.
- **Plain `LIKE`, no FTS5 and no new index**, measured at 10–25 ms end to end on the real database
  (106 tasks, 76 backlog items) including a two-letter query at `limit=25`. Nothing here touches
  `task_events`, which is why a long history doesn't slow it down. Known scaling limit: those
  tables have no index beyond their primary key, `better-sqlite3` is synchronous, and this process
  also serves the SSE streams — so revisit if `tasks` reaches the tens of thousands, and **measure
  before choosing an index or FTS5**.
- Known limitation, not a bug: SQLite folds case for **ASCII only**, so `Ü` doesn't match `ü`.
  `lower()` has the same limitation; the fix is an ICU build.

## Reading files out of a project tree
`GET /api/projects/[id]/{file,diff}` take a caller-supplied relative path and read it under a
root the user registered — `project.path`, a workspace member, or a task's git worktree, which
for a parallel run is **written by an agent with Bash**. Their old guard (reject a leading `/`
or a `..` segment, then `resolve()`) is purely lexical, so it proved nothing about what the
path lands on. `lib/safe-read.ts` is the containment check; the routes keep the lexical gate
only as a cheap pre-filter.
- **Three escapes exist and no single check catches all three.** Measured, not assumed:

  | planted in the tree | `O_NOFOLLOW` | realpath containment |
  |---|---|---|
  | `docs.md` → `/etc/passwd` | refuses | refuses |
  | `link/` → `/secrets`, read as `link/id_rsa` | **opens it** | refuses |
  | `docs.md` hard-linked to a file outside | opens (only `nlink` sees it) | **contained** |

  `O_NOFOLLOW` only refuses a symlink as the *final* component, so a symlinked intermediate
  directory walks through it; a hard link has no target to resolve, so realpath reports it as
  living exactly where it appears. Hence both, plus `nlink === 1`.
- **A symlink that stays inside the root is allowed**, unlike `readSpecFile` in `lib/backlog.ts`,
  which refuses links outright. `README.md → docs/README.md` is ordinary in a repo and this is a
  file viewer; a `.pm/tasks/` spec becomes the instruction text of an autonomous run, so the
  stricter rule is right where it is. Escaping the root is what both refuse. The two are
  deliberately **not** merged.
- **Containment is decided on the inode, not by resolving the path twice.** `realpath` then
  `open` is check-then-use, and `O_NOFOLLOW` only guards the *last* component — so swapping a
  **directory** along the path for a symlink mid-flight gets followed. Both reviews reproduced
  that with a shell loop. After opening, `readFileInside` therefore re-resolves and requires the
  file at that contained path to be the very inode the handle holds (`dev` + `ino`); with
  `nlink === 1` that is airtight, since the open file then has exactly one name and that name was
  just seen inside the root. Re-checking the *path* alone is not enough — an attacker can put the
  directory back and pass a second path check.
- **`O_NONBLOCK` on the open is load-bearing, not tidiness.** `open` on a FIFO blocks until a
  writer arrives, and that happens *before* `fstat` can classify it — so a named pipe left in a
  tree hangs the request forever and no check afterwards helps. Found by the FIFO spec hanging
  the suite. Regular files ignore the flag.
- **No worktree path is handed to a subprocess any more.** A Node-side check followed by
  `execFileSync` is check-then-use with a whole *process spawn* in the window — the audit leaked
  a planted secret through `git diff --no-index` in 9–15ms, under 100 attempts, 3 times out of 3.
  So an untracked file's diff is now **synthesized** in `untrackedDiff` (`lib/git.ts`) from a
  contained read: same shape git produced (`--- /dev/null`, `@@ -0,0 +1,N @@`, `+` lines, binary
  and no-trailing-newline cases included), close enough for `components/DiffModal.tsx`, which
  colours by prefix. Keep it that way — reintroducing `--no-index` on a worktree path reopens the
  race that the remaining `escapesOnDisk` pre-check cannot close.
- **git is not allowed to read the working tree for a file's content at all** (2026-08-17), and
  that — not `escapesOnDisk` — is what makes `gitFileDiff` safe. The tracked branch used to run
  `git diff HEAD -- <path>` after the check, and git resolves the path *again*, on its own: a
  tracked file swapped for a **hard link** to an outside file mid-request leaked it at **3 hits
  in 53 attempts, 20 ms**. Now `git ls-tree HEAD` classifies the path from the object store, the
  before side comes from `git show HEAD:<path>` and the after side from `readBytesInside`; git
  renders the diff from those two, written into a private `mkdtemp` (which is why `--no-index`
  is safe *there* and not on a worktree path). Keep any new diff work on that side of the line.
  - **The filed item blamed the wrong shape, and so did the note it came from.** A symlinked
    *ancestor directory* does **not** leak on the tracked path — git answers `deleted file mode
    100644` instead of following it, which is why an audit at 66k attempts found nothing and
    called the window narrow. A hard link has no target to resolve, so only `nlink` sees it.
  - **A tracked *directory* path leaked with no race at all.** `escapesOnDisk` allows a contained
    directory (below), so `git diff HEAD -- docs` walked it and diffed a hard link planted at
    `docs/a.md` — a file the caller never named and no check ever looked at. A `tree` entry now
    returns nothing: this route serves one file.
  - **`--submodule=short` is as load-bearing as `--no-ext-diff --no-textconv`.** `diff.submodule`
    is ordinary `.git/config` — untracked, shared across linked worktrees, writable by a task's
    Bash tool — and it changes the output wholesale: `log` drops the `@@` line entirely (so a
    real pointer change rendered blank), `diff` prints the *contents of files inside the
    submodule*. Pinning the format means neither depends on how a repo is configured.
  - **A submodule keeps the real `git diff`, with its output checked positionally.** HEAD saying
    "gitlink" doesn't bind the worktree to still be one, and a regular file there makes git
    render a typechange carrying that file's content. `isSubmoduleDiff` requires every line from
    the first `@@` onward to be a `Subproject commit` line; a typechange puts a second
    `diff --git` block there, so it fails whatever the planted file holds. Both earlier attempts
    were wrong and each failed a different way, so don't "simplify" this back:
    - matching header *prefixes* let content through — git prefixes added lines with one `+`,
      so a file whose lines start with `++ ` renders as `+++ …` and passes as the `+++ b/…`
      header (found by the security audit, reproduced end to end);
    - matching header lines *exactly against the path* blanked real submodules — git appends a
      trailing **tab** to `--- a/<path>` when the path has a space, and C-quotes the path when
      it isn't ASCII. Specs cover `my sub` and `üni sub`.
  - **A committed symlink's target is never read.** A *deleted* one still renders its deletion
    (built purely from HEAD's committed blob, so nothing comes out of the tree); one that is
    still there renders nothing. Both alternatives were tried and both leak or lie:
    - a contained *content* read follows the link, so it diffs the target's content against
      HEAD's stored path text — a large bogus diff for a link nobody touched;
    - **`readlink` follows the directories above the link**, so pointing an ancestor outside
      the tree returns an outside link's target. The security re-audit proved this, including
      a variant with **no race at all**: `escapesOnDisk` answers "safe" for a path with nothing
      on disk (deliberately — that is how a deleted file's diff works), which is exactly a
      *dangling* link behind a swapped ancestor. Validating the returned target lexically does
      not save it: a plain relative target resolves inside the root on paper while having been
      read from outside it.
    There is no sound version in Node — it needs the parent held as a descriptor
    (`openat`/`O_PATH`), which Node doesn't expose. The cost is that a *retargeted* committed
    symlink shows no diff; the file list still reports it as modified.
  - Fixed on the way: the old code read an empty `git diff` as "not tracked" and fell through to
    `untrackedDiff`, so **every unchanged tracked file** rendered as a brand-new file containing
    its whole content.
  - Both git calls carry **`--literal-pathspecs`**: the path is a name, not a pattern, and
    without it a leading `:` is pathspec magic (`:/`, `:(exclude)…`) and `*` globs.
  - **A tracked diff's read cap is 16 MB, not the untracked 2 MB**, and the difference is
    load-bearing: an untracked file's diff *is* its whole content, but a one-line edit inside a
    4 MB tracked file is a five-line hunk. Reusing the small cap returned no diff at all for it
    (caught in review). The cap bounds memory, not what is worth showing.
- **`escapesOnDisk` allows a contained *directory*.** It's the containment question, not "is this
  a plain file". Refusing every non-regular path silently returned an empty diff for **every git
  submodule in every project** — `git diff HEAD -- <submodule>` is an ordinary "Subproject commit"
  diff. Caught in review; there's a spec for it now. A path with **nothing on disk answers false**
  too: `git diff HEAD -- deleted.md` is served from the object store, so there is no filesystem
  read to escape through. It is now a **pre-filter, not the containment guarantee** — every
  branch of `gitFileDiff` is sound without it.
- **The diff route's exposure was narrower than it looks, which is why it had to be tested.**
  `git diff --no-index` renders a plain symlink as mode 120000 whose content is the *target's
  path* — harmless. Only the symlinked-directory form leaked real content.
- **`readFileInside` is a UTF-8 wrapper over `readBytesInside`.** The diff path needs the bytes
  undecoded: two files differing only in bytes that don't map to UTF-8 decode to the same
  replacement character, so a string-based diff reports an edited file as unchanged. `mode` comes
  off the open handle (`fstat`), not a second `stat` of the path, which is what lets a
  mode-only change (`chmod +x`) still render its `old mode`/`new mode` lines.
- **Every `git diff` here carries `--no-ext-diff --no-textconv`.** A repository can define what
  "diff" *means*: `diff.<name>.textconv` / `.command` name a shell command git runs to render a
  file, with the command in `.git/config` and the binding available from `.git/info/attributes`
  — neither tracked, so neither shows in `git status`, a review, or a clone, and both are
  ordinary writes inside a repo, which a task's Bash tool has. Verified: without the flags a
  planted driver **executes** on `git diff HEAD -- <path>`; with them it doesn't and the diff is
  unchanged. There's a spec for it. The shared-`.git` half (backlog `bli_e0d5be33`) is now
  **partly** closed: hooks and config are still shared across all linked worktrees, but as of
  2026-08-19 no *platform-issued* git command executes them — see the `NO_HOOKS` entry below.
  Still open from that item: `filter.<driver>.clean`, which has no `-c` key to pin.
- **A refused path and a missing one answer identically** (404), like `lib/task-access`'s "not
  yours ≡ doesn't exist". A separate "invalid path" status turned one planted symlink into an
  existence oracle for arbitrary absolute paths on the host — no race, no auth, repeatable. Only
  a *lexically* bad path (leading `/`, a `..` segment, control chars) still answers 400, since
  that is decided before anything is looked up and reveals nothing.
- **`gitChanges` reads untracked files just to count lines**, and `git status` lists an untracked
  symlink like any other entry — so that read leaked a target's line count, and would have hung
  on a FIFO. It now goes through the same helper, capped (it was unbounded, so a huge untracked
  file was a memory-exhaustion primitive); anything refused counts 0, as unreadable files already did.
  Its *tracked* counts still come from a whole-tree `git diff --numstat HEAD`, which does read the
  worktree — the same plant can misreport an outside file's **line count**.
  - **Re-examined 2026-08-18 and deliberately closed as won't-fix**, with the leak reproduced
    (a tracked path hard-linked to a 137-line outside file reports `+137 −1`). Two shortcuts were
    measured and rejected, and both are worth knowing before reopening this:
    - *Post-filtering the numstat map with `escapesOnDisk`* is not a fix. That helper answers
      "safe" for a path with nothing on disk — deliberately, since that is how a deleted file's
      diff is served — so the plant is simply removed after numstat has read it and the check
      passes. No timing skill needed; it would be a disclaimer, not a boundary.
    - *Synthesizing the summary* is the sound direction, and the review improved the cost estimate
      worth recording: it is **not** a subprocess per file. `git archive HEAD -- <changed paths>`
      into a private `mkdtemp` gives the whole "before" tree in **one** spawn, `readBytesInside`
      gives the "after" side with no spawn at all, and a single `git diff --no-index --numstat -z`
      over the two directories keeps git as the thing computing the numbers (so they can't disagree
      with git's) — two subprocesses total. What still makes it a real project rather than a patch:
      it materialises every changed file's bytes twice on disk, `--no-index` across two trees does
      not reproduce `diff.renames` so renames have to be re-paired from the status entries by hand,
      and added/deleted/one-sided paths each need their own case. Sounder, not cheap.
    Added/deleted are *diff* quantities rather than line counts, so any honest accounting of the
    working tree has to read the working tree. Severity is bounded by the attacker being an agent
    with Bash running as the **same uid as the server** — it can already read the file directly, so
    this is a confused deputy, not an information gain.
    - **Don't read "two integers" as the size of the leak, only its shape** (the audit's fair
      objection): the attacker also controls HEAD's blob for that path and can re-trigger the
      render freely over the unauthenticated loopback routes, so what it really has is a
      chosen-plaintext *diff-distance* oracle — a content-extraction primitive in kind, just a slow
      and coarse one. Nobody has built it, and the same-uid argument above is what keeps it
      non-blocking, not the output shape.
    - The audit also **falsified the bound as originally written**, via `core.worktree` putting
      outside *filenames* in the list. That is fixed (see `repoOpts` below), which is what restores
      it. `lib/git.test.ts` pins it: the summary is a path, a status word and two integers, and
      never any of the file's bytes.
- **Every git command in `gitChanges` carries `-z`, and that is correctness, not tidiness.** git
  *quotes* a path it can't print plainly — C-style, **named** escapes for `\n \t \" \\` etc. and
  **octal** for everything else, non-ASCII included. The old parse undid that with `JSON.parse` (a
  different format) and applied it **only to the status path, never to the `--numstat` key**. The
  two resulting failures are not the same failure, which is worth keeping straight:
  - a name with `"` or a tab is quoted by *both* commands and `JSON.parse` **succeeds**, so the
    status side became raw while the numstat key stayed quoted → lookup missed → `+0 −0`;
  - a **non-ASCII** name is quoted by both too, but `JSON.parse` **throws** on `\3`, so both sides
    stayed quoted and *matched* — counts were correct, but the path was displayed as
    `"\346\227\245…"` and clicking it returned an **empty diff** (verified end to end). Untracked
    non-ASCII files did read `+0`, because the contained line-count read got the quoted name.
  - every renamed file read `+0 −0` too: `diff.renames` defaults to on and numstat writes a rename
    as the unmatchable `old => new`.

  Under `-z` both commands emit raw, NUL-terminated, never-quoted paths, so nothing needs
  unquoting and nothing depends on `core.quotePath` — ordinary repo config, the same "a repo gets a
  say in the output format" class as `--literal-pathspecs` and `--submodule=short`. Note the record
  shapes differ: a rename is `new\0old` from `status` and an empty path field followed by
  `old\0new` from `--numstat`; the extra field is consumed **by position**, so an old name that
  looks like a status record (a file really called `?? evil.md`) can't forge a row.
- **`repoOpts` pins three config keys on *every* git call in `lib/git.ts`** — the same "a
  repository decides what git does" class as `--no-ext-diff --no-textconv`, and both leaks below
  were found by the security audit as unverified hypotheses and reproduced on the first try:
  - **`core.fsmonitor` names a program git executes.** Measured: it ran on `git status
    --porcelain`, on `git diff --numstat HEAD` and on the submodule `git diff` (not on `ls-tree`,
    `show` or `rev-parse`). `.git/config` is untracked and shared across every linked worktree, so
    a plant from inside one task's "isolated" worktree executes **in the web server process** when
    anyone — including another user — loads that project's page. `-c core.fsmonitor=` disables it.
  - **`core.worktree` redirects the working tree.** A planted absolute path made `git status
    --untracked-files=all` enumerate that directory and report *its* filenames as this project's
    untracked changes — arbitrary directory listings, no race, nothing planted in the tree.
    `-c core.worktree=…` does **not** override it (git resolves the worktree during setup, before
    `-c` is layered); **`--work-tree=<cwd>` does**. On `runGit` the same flag guards a *write*:
    `checkout` would otherwise materialise a branch into the attacker's directory.
    - **It is sent only when `cwd` is a worktree root, and that condition is load-bearing.**
      `--work-tree` pointed at a *subdirectory* corrupts the repo instead of failing: HEAD moves,
      the branch's files are written rebased into that subdirectory, and the real tracked files stay
      stale — exit 0 and a "Switched to branch" message. Reachable with no attacker, because
      `memberPath()` (lib/workspace.ts) doesn't check that a workspace member is its own repo, and
      the git-actions route feeds it straight to `checkout`/`pull`. Caught by round-two review after
      my own testing only ever used correctly-rooted directories. `repoOpts` therefore gates the flag
      on `existsSync(cwd/.git)` — the same test `isGit` uses.
  - **Every `execFileSync` here carries a `timeout`** (30 s local, 120 s for `runGit`, since
    `pull`/`push` are network calls). A repository can make a git command *never return* — see the
    `filter.<driver>.clean` note below — and these are synchronous, so a blocking filter wedges the
    event loop that also serves the SSE task streams until someone restarts the process.
  - **`diff.renames` / `status.renames` are pinned to `true`** so the two commands can't be made
    to describe one change differently (with `status.renames=false` a move is add+delete on one
    side and a single rename record on the other, so the deleted name lost its lines and the
    totals came out short). Wrong numbers, not a leak.
- **No platform-issued git command runs a hook** (`NO_HOOKS` / `gitEnv()` in `lib/git.ts`, and the
  same two lines in `runner/worktree.ts`'s `git()`). This is the widest member of the class above,
  because `git worktree add` gives a task its own HEAD, index and files but **not** its own
  `.git/hooks/` — that is one shared copy behind the main checkout and every linked worktree, and
  nothing in it is tracked. Measured before the fix: `worktree add` runs `post-checkout`,
  `post-index-change` and `reference-transaction`; `checkout` runs `post-checkout`; `push` runs
  `pre-push`; `pull` runs `reference-transaction`. `ensureTaskWorktree` issues `worktree add` on
  **every parallel dispatch**, so a single plant from inside one task's worktree re-arms itself and
  keeps executing in the runner process.
  - **`-c core.hooksPath=/dev/null`**, and `-c` beats a `.git/config` that points `core.hooksPath`
    back at the planted directory — verified, or the fix would be one `git config` from undone.
    `/dev/null` rather than an empty value: empty works only as an implementation detail (git joins
    `<value>/<hook>`, so empty yields the absolute `/post-checkout`, resting the mitigation on `/`
    not being writable). A fixed name under `tmpdir()` is worse than both — `/tmp` is
    world-writable, so another local user could create it and *supply* the hooks.
  - **`GIT_CONFIG_NOSYSTEM=1` buys less than it appears to**, and the first spec written for it was
    dead: a system-level `core.hooksPath` is already beaten by `-c`, so that test passed with the
    env var deleted. It was caught only by reverting each half separately — do that for any spec
    added here. The real key is **`core.excludesFile`**, which nothing `-c`s away: a system-level
    ignore file makes `git status --untracked-files=all` omit matching paths, so the changes list
    silently under-reports and unsaved work renders as a clean tree. That is what the spec pins.
  - **`process.env` is spread, not replaced**, and `gitEnv()` is a function rather than a
    module-level constant. The spread keeps `PATH`, `HOME` and the container's `GIT_CONFIG_COUNT`
    gh-credential wiring, without which Push breaks while every hook spec still passes; the
    function keeps a spec's `process.env` change visible to the subprocess, without which an
    env-planting spec passes while testing nothing.
  - **Deliberate behavior change:** the UI's Push/Pull/Checkout/Create no longer run the project's
    own hooks, so a repo gating pushes on a `pre-push` test run is not gated when pushing from the
    dashboard. An agent's own `git` through its Bash tool still honors hooks, so `/swe:ship` and
    this repo's default-branch guard are unaffected — this is about what the *server process*
    executes on a user's behalf.
  - **git-lfs is the legitimate casualty.** The mitigation can't tell a planted hook from a wanted
    one, and git-lfs works *through* `post-checkout`/`post-merge`/`pre-push` — so an LFS repo gets
    pointer files rather than content in a parallel-run worktree, and a dashboard Push won't
    upload LFS objects. The agent's own Bash `git` still runs them, so it's a rough edge rather
    than data loss, but don't use the Push button on an LFS repo.
  - **What it does not close — two live RCEs in the same class, reproduced by the audit of this
    change and knowingly left.** `credential.helper` (generic or url-scoped, in the repo's
    `.git/config`) runs a shell command as soon as a remote answers 401 — i.e. on any real push;
    `core.sshCommand` runs for an `ssh://` remote, and an attacker can create one with `git remote
    set-url`. Both inherit the whole server env, so `SECRETS_MASTER_KEY`/`GH_TOKEN` leak too. The
    one-line pins are worse than the hole and both were measured: `-c credential.helper=` also
    clears the container's gh helper and any global one (Push breaks for everyone), and
    `-c core.sshCommand=ssh` overrides a legitimate global setting. A sound fix must decide which
    helpers are trusted and re-inject them — a change to how the app authenticates, not a flag.
    Filed in the backlog; details and the rejected alternatives are in `.swe/notes.md`.
    - **Don't read the dev container as protection.** Compose clears the host's osxkeychain helper
      with an empty `GIT_CONFIG_VALUE_0`, and an empty value resets git's helper list — so in the
      container a *generic* plant is already neutralized by accident. A **native install** (how
      releases run) has no `GIT_CONFIG_*` and is fully exposed, as is a url-scoped plant either way.
  - `POST /api/projects/[id]/git` still has no auth, so an agent can trigger checkout/pull on any
    project over loopback — it just can't make that trigger run a *hook* it planted. Same open
    design question as the unauthenticated backlog routes.
- **Two pre-existing CRITICAL holes are reproduced and *not* fixed (2026-08-18). Read this before
  trusting anything above.** Both were found by the security audit of the `-z` work; both are older
  than it; neither has a cheap sound fix, so they are documented rather than papered over.
  - **`filter.<driver>.clean` is arbitrary command execution in the web server process.** A clean
    filter is a shell command in `.git/config`, bound to a path by `.gitattributes` *or*
    `.git/info/attributes` — nothing needs committing, so none of it shows in a review or a clone.
    Measured: it runs on `git diff --numstat HEAD` (i.e. on **every project page render**) and on the
    submodule diff; not on `status` or `show`. `--no-ext-diff`/`--no-textconv` do **not** stop it, and
    there is no key to `-c` away because the driver name is attacker-chosen. `--attr-source` blocks a
    worktree `.gitattributes` but **not** `.git/info/attributes` — and this repo's git (2.39.5) rejects
    the flag anyway, so adding it would silently zero every line count. The sound fix is the same
    redesign the line-count won't-fix declined: stop letting git read tracked content out of the live
    tree. **RCE is a much stronger motivation than two integers, so treat that won't-fix as "not in
    that task" rather than settled.** Mitigated only by the `timeout` above, which bounds a hang, not
    the execution.
  - **A `.git` *file* redirects the entire repo, and `isGit` can't see it.** `isGit` is
    `existsSync(path/.git)` and never checks directory-vs-file, but a one-line `gitdir: <absolute
    path>` file is a valid redirect (the form linked worktrees use). Reproduced: with project A's
    `.git` replaced by a pointer at repo B, `git status` in A reported B's tracked files and
    `git show HEAD:<path>` returned **B's committed content** — which is what `trackedDiff` renders
    into the diff modal, so it is cross-repository *content* disclosure. `--git-dir` does not help
    (it follows the pointer), and `GET /api/projects` is unauthenticated, so every project's absolute
    path is readable. Unfixed because a linked worktree's `.git` legitimately *is* a file, so the
    guard must validate the resolved gitdir against allowed roots — a change to
    `lib/discovery/projects.ts` plus the worktree machinery, not a flag.
  - **`merge.<driver>.driver` is the same class on `git merge`, reproduced 2026-08-22 and *not*
    fixed** (found by the security audit of the feature merge-back work). A custom merge driver
    is a shell command in `.git/config`, bound to a path by `.gitattributes` *or* untracked
    `.git/info/attributes`, and git runs it for a conflicting file during **any** `git merge` —
    including the platform-issued `gitMerge` behind the feature merge-back and the merge sweep.
    Verified: a planted `merge.custom.driver` executed in the runner process during a real
    `gitMerge` (full `repoOpts`/`gitEnv` hardening applied). Like `filter.<driver>.clean` the
    driver name is attacker-chosen, so there is no key to `-c` away, and `.git/info/attributes`
    isn't reachable by `--attr-source`. **First introduced by the 2026-08-21 `gitMerge` (a merge
    only ran in a disposable temp worktree then); the merge-back honesty work made it materially
    worse and that is the part this note owns:** the merge can now also run in the project's
    **main checkout** (via `mergeInMainCheckout`), and it re-fires unattended from the boot
    sweep and `promoteNext`. Two of those three amplifiers were closed in the same task — the
    forged-worktree parser that let the main-checkout merge target an arbitrary branch (see
    `branchCheckoutDir`'s `-z` note above) and the missing subprocess timeout that made the
    driver a DoS as well as an RCE — so what remains is the base class: a *legitimately*
    checked-out feature branch's merge, or a temp-worktree merge, still runs a repo-defined
    driver. The sound fix is the same redesign owed for `filter.clean` (stop letting a
    platform-issued git command execute repo-defined driver config, or refuse to merge a repo
    whose resolved driver isn't git's default). Filed to the backlog; the `timeout` now bounds
    the hang, not the execution.
- **This is defence in depth, not a perimeter.** It needs write access to a project tree to
  exploit, and these routes still have no auth on the non-task path — the same gap documented
  under the backlog. What it removes is a confused deputy: the server no longer reads outside a
  root on behalf of a path that merely looks like it's inside.

## The agents ship with the app
The swe / fe / pm plugins are **vendored into this repo at `agents/<namespace>` and shipped in the
release tarball**, because a new device has neither the plugin directories nor the Claude Code
marketplace entries that point at them — so registry-only discovery gave a fresh install an empty
agent list and nothing to dispatch.
- **Nothing has to be installed through the `claude` CLI for an agent to run.** The runner loads
  a plugin by path (`plugins: [{ type: "local", path: agent.sourcePath }]` in
  `runner/session-manager.ts`), so the CLI's registry is only ever how an agent is *found*.
- **Discovery is registry-first, bundle-as-fallback** (`lib/discovery/agents.ts`): a plugin
  registered through the CLI wins over the bundled copy of the same namespace, so on a machine
  where these agents are being developed the live source directory is still what runs. Only the
  registry side is filtered to `swe`/`fe`/`pm` — anything in `agents/` was shipped deliberately.
  Bundled agents get id `<namespace>@bundled`, `scope: "bundled"`, and `sourcePath` inside the
  app directory. `PLATFORM_AGENTS_DIR` overrides where that directory is.
- **An agent that reappears under a different plugin id reuses its existing row.** `tasks.agent_id`
  is a foreign key with ON DELETE CASCADE, so `syncAgents()` adopts the row already holding that
  namespace rather than inserting a second one and stranding the history — that's what makes
  switching between a CLI install and the bundled copy safe in either direction.
- **`agents/` is a vendored copy, so it drifts.** `pnpm agents:sync` rsyncs it from the source
  checkouts (`../{swe,fe,pm}-agent`, or `CC_AGENT_SRC`); run it after changing an agent and commit
  the result, or releases ship a stale agent. The release workflow asserts the three
  `.claude-plugin/plugin.json` files are in the tarball — losing them is silent otherwise.
- Because `~/.control-center/app` is replaced wholesale on update, the agents are updated by
  `control-center update` along with everything else — and local edits to them are lost. Someone
  who wants to *edit* an agent should register it with `claude plugin marketplace add <dir>` +
  `claude plugin install <ns>@<marketplace>`; that entry then takes precedence over the bundle.

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

## The Mac app (native window) and the PWA
**Naming:** the product is **Agent Control Center**. It was renamed from "Control Center" because
macOS ships a system service by that name — which made `tell application "Control Center"` target
Apple's (answering `User canceled (-128)` while ours kept running) and put two hits in Spotlight.
Renamed: the bundle (`Agent Control Center.app`), its id (`dev.agentcontrolcenter.app`), its
executable (`AgentControlCenter`), and every user-visible string. **Not** renamed, deliberately:
the `control-center` CLI (published release notes tell people to run it, and a terminal command
has no collision to worry about) and `~/.control-center` (renaming it would orphan existing data).
`make-app-bundle.sh` deletes a pre-rename bundle it recognises by the old id, so an update doesn't
leave two apps behind; `uninstall` quits and removes both names and both ids.

`Agent Control Center.app` in `/Applications` is the front door: double-click it, no terminal. The
bundle is built by `infra/release/make-app-bundle.sh` — on first install, after **every** update,
and on demand via `control-center install-app`. It comes in two forms:
- **native** (whenever `swiftc` exists — Xcode Command Line Tools): `infra/native/ControlCenter.swift`
  compiled locally into the bundle. A real `NSApplication` + `WKWebView`, so **it owns the window
  and therefore the Dock icon** — the whole reason it exists, since a Chrome `--app=` window puts
  *Chrome* in the Dock. It starts the server itself (`control-center start`, which also applies
  updates and migrations), polls until the server answers, and opens external links in the real
  browser. Compiling locally means nothing is downloaded, so nothing is quarantined: no signing,
  no notarisation, no Gatekeeper prompt.
- **launcher** (fallback, no Swift): a shell script that starts the server and opens a browser
  window. Same Applications entry and icon; the *window* is Chrome's.

Gotchas worth keeping:
- **The bundle probes two ports (7373, then 3001) rather than insisting on one.** `update`
  rebuilds the bundle from the new source but only refreshes the `control-center` command on
  versions that know to, so for exactly one update the window and the server can disagree about
  the port — and a bundle that insisted would sit on "Starting…" while a healthy server answered
  next door. `CC_URL` pins it when you know better.
- **A `WKWebView` has no file chooser of its own.** `<input type="file">` does *nothing* — no
  dialog, no error, nowhere — unless the host app implements
  `WKUIDelegate.webView(_:runOpenPanelWith:initiatedByFrame:completionHandler:)`. It shipped
  without one, so "Attach files" was dead in the Mac app while working in a browser, and dropping
  a file on the composer was the only way to attach anything. Anything else WebKit delegates to
  the host (printing, JS `alert`/`confirm`, camera/mic permission) fails the same silent way, so
  add the delegate method rather than assuming browser behaviour. Its `completionHandler` must be
  called on every path or the input stays locked for the rest of the session.
- `infra/native/` **must stay in `pack.sh`'s allowlist** — without the Swift source an installed
  app can't rebuild its own bundle on update, and silently degrades to the launcher.
- The bundle is swapped with `mv`, never `rm -rf` in place: updates rebuild it while the app that
  triggered the update is running, and rename leaves the running inode alone.
- `CFBundleExecutable` is `ControlCenterApp`, not `ControlCenter` — macOS runs its own process by
  that name.
- `NSAppTransportSecurity` allows local networking; ATS blocks plain HTTP to localhost otherwise.
- The executable is unsigned. Fine while it's compiled on the machine that runs it; the day a
  prebuilt binary ships, it needs signing + notarisation or Gatekeeper will block it.

Separately, the *running* dashboard can also be installed from Chrome as a PWA — own window and
Dock icon, same server. `control-center start` prefers that bundle if it exists. Note the install
button lives in a **normal tab's** address bar; a `--app=` window has no menu for it.
- **Install:** open http://localhost:7373 in Chrome → install button in the address bar (or
  ⋮ → Cast, save, and share → Install page as app). That creates a real Mac app bundle under
  `~/Applications/Chrome Apps/` carrying the app's own icon — which is what puts Control Center
  in the Dock under its own logo. A bare `--app=` window is a Chrome window wearing Chrome's
  icon, so `control-center start` looks for that bundle and launches it in preference, nudging
  you once if it isn't there. `pnpm app` is the no-install path: it opens a Chrome window with
  `--app=` (`infra/launch/open-app.mjs`, falls back Chromium → Edge → Brave → default browser,
  and cross-platform).
- **Manifest:** `app/manifest.ts` → `/manifest.webmanifest`. Chromium's install criteria are
  `name`/`short_name`, a 192px **and** a 512px icon, `start_url`, `display`, and
  `prefer_related_applications` unset — over HTTPS or localhost.
- **No service worker, deliberately.** Chromium hasn't required one for installability for
  years, and its fetch handler would sit in front of the SSE task stream and dev HMR for no
  offline benefit on a local-only app. Don't add one without a concrete reason.
- **`proxy.ts` lets `/manifest.webmanifest` through signed out** — Chrome fetches it to decide
  installability, and a redirect to `/signin` makes the app un-installable.
- **Icons** are generated from the single brand mark in `app/icon.svg` by `pnpm icons`
  (`infra/icons/generate.mjs`): it composes the mark over the brand's dark radial background at
  three scales and rasterizes via macOS QuickLook (`qlmanage`) — there's no ImageMagick or
  librsvg here. Outputs are committed, so it only runs when the mark changes. Edit the mark,
  never the PNGs.
- **Trap — do not add `app/apple-icon.png`.** That Next file convention crashes metadata
  rendering on *every* page in this Next build (`ReferenceError: require is not defined`, a 500
  on `/signin` and everything else). The touch icon is declared by path instead, via
  `metadata.icons.apple` in `app/layout.tsx`. `app/icon.svg` (favicon) is fine.
- Per-scheme `<meta name="theme-color">` comes from the `viewport` export in `app/layout.tsx`.
  It follows the OS scheme, which can disagree with the in-app light/dark/system toggle — the
  standalone window chrome can't track that toggle.

## Is a turn's last message the report, or did the agent just stop?
`runner/completion.ts` (`classifyTurnEnd`) answers that for a turn ending with **no** report
gate, no `[[GATE:…]]` marker and no trailing `[[DONE]]` — the runner, not the SDK, decides when
a task is finished. A pause becomes a nudge; a final answer seals the task.
- **`IN_FLIGHT_RE` catches "my dispatched work hasn't come back", which `WAITING_RE` misses**
  because the sentence never mentions waiting: *"both review agents are still running"*, *"the
  audit hasn't returned"*. Measured on a real transcript that ended exactly that way and was
  accepted as a finished report — the task went `done` while its subagents kept writing to the
  transcript.
- **It is deliberately far narrower than `WAITING_RE`** — a named piece of dispatched work
  (reviewer / auditor / subagent) *and* an explicit statement that it hasn't finished — and the
  reason is load-bearing: **`WAITING_RE` matches "I'll wait for your approval to push" and
  "Waiting for your go-ahead", both of which are finished reports.** So `WAITING_RE` must never
  be consulted anywhere the answer *seals* a task. `runner/completion.test.ts` pins both
  directions: six in-flight phrasings pause, and six finished-report phrasings (including
  "Tests are still running in CI, but the change is complete") stay final.
- **What this does NOT fix, knowingly:** a `[[DONE]]`/`[[GATE:REPORT]]` marker skips
  `classifyTurnEnd` entirely, so an agent can still stamp `[[DONE]]` on a report that says its
  reviews are outstanding and seal the task — and background subagent events still land in the
  transcript after `finalize()` writes `end`. Filed (`bli_9119b0b6`, plus the agent-rules half
  `bli_dd973b87`) rather than patched, because the cheap patch — running `WAITING_RE` at the
  seal point — would nudge legitimate completions into a loop, per the bullet above.

## The report card, and offering a fix task
A change report can end with a "Create fix task" button that dispatches a fresh run against the
report's own text. `fixTaskReasons` (`lib/ui.ts`) decides whether that button exists; the card
in `components/TaskLiveView.tsx` renders it.
- **The button and its explanation come from one list, so it can never appear unexplained.**
  This replaced a boolean (`reportHasFindings`) that decided the same thing and could not say
  why — so the card showed a bare CTA beside a report that never stated what needed fixing, and
  the only honest reaction was "why do I need a fix task?". Now: no reasons → no button; reasons
  → a `warn`-toned callout that names each signal (**Findings section**, **Severity callout**,
  **Unfinished item**, **Recommendation**) and **quotes the line that fired it**. The button
  lives *inside* that callout — the two used to sit a whole report apart.
- **Quoted, never paraphrased.** A summary of a finding is a second thing that can be wrong.
  The evidence is the report's own line, markdown furniture stripped and cut **by code point**
  (`[...str]`, like `cleanTitle`) so a cap can't split a surrogate pair.
- **`evidenceOf` strips `\p{Cc}`/`\p{Cf}`, and that is a security control.** Report text is
  agent-authored and steerable by a file or page the agent read, and React escapes *markup*, not
  Unicode — so a `U+202E` RIGHT-TO-LEFT OVERRIDE survives and makes the quote **display as
  something other than what it says**. Trojan Source, aimed at the one panel designed to be
  believed before a click. Reproduced in a browser: the same planted line renders as "…the log
  **no security** in plain text" in the report body and "…the log **ytiruces on** in plain text"
  in the callout. Real whitespace (TAB, NBSP, U+2028/9) becomes a space *first*, or stripping
  glues words together; `dir="ltr"` on the span bounds anything left. **Write these as `\uXXXX`
  escapes, never literal bytes** — a literal U+2028 is a JS line terminator and broke the parse.
  The markdown-rendered report *body* still has this exposure; it is pre-existing and filed
  (`bli_81e3ed7c`).
- **Judged per line, which is what makes an all-clear readable.** The old version tested the
  whole blob, so "no outstanding issues" lit up `issues?` for the entire report. A line matching
  an all-clear phrase is now skipped — *unless* it carries an explicit severity tag, since
  `[Medium] looks good overall, but…` is a grading, not reassurance.
- **One row per kind, capped at four.** An audit lists twenty findings; twenty near-identical
  callout rows would be a second copy of the report where the job was to explain one button.
- **It is still a guess about prose, and that's the point of showing it.** A report describing
  bugs it already *fixed* ("## Bugs found beyond the reported symptoms") still matches — but the
  user can now see the matched line and dismiss it, instead of being handed a silent verdict.
  It had **no specs at all** before; `lib/ui.test.ts` now covers each signal, the all-clear
  suppression, the cap, the code-point cut, and that exact false positive.

## Skills, and attaching files to a live run
- **A command is called a *skill* in the UI** ("Workflow" until 2026-08-13). The code keeps
  `commands` — that's the plugin directory's own name for them (`agents/<ns>/commands/*.md`)
  and the DB column — so `AgentCommand` isn't renamed; only what a user reads.
- **`orderSkills` (`lib/ui.ts`) decides both the order and whether `onboard` is offered.**
  Discovery sorts commands by filename, which put `audit`/`onboard` ahead of `task`; the picker
  shows working order instead (fe: task, fix, audit, review, plan, ship · swe: task, fix,
  security, review, plan, ship, workspace). A skill missing from that table keeps its
  alphabetical place after the listed ones, so a new command still appears without a code
  change.
  - `onboard` **leads** the row until the agent is onboarded on that project, and is **dropped**
    from it once it is. Onboarding is a one-time step, and a permanent chip for it sat in front
    of the skills people actually came for.
  - Which makes `ONBOARD_MARKERS` (`lib/discovery/projects.ts`) load-bearing rather than
    cosmetic: a namespace with no marker reads as "always onboarded", so its onboard skill would
    never be offered. pm's marker (`.pm/notes.md`) was added for exactly that reason. **Add one
    whenever an agent gains an `onboard` command.**
  - A "Re-onboard /ns" link keeps it reachable, because CLAUDE.md and `.fe/design-system.md` go
    stale and re-running onboarding is a real need. It re-includes the skill and selects it.
- **Files can be attached to a gate answer, not only to a finished task.** The composer with
  the attach button renders only on a *terminal* task, so for a run that was live — the one
  moment the agent is actually listening — there was no way to send a screenshot at all.
  `POST /api/tasks/[id]/respond` now takes multipart as well as JSON: the files are saved under
  the task's own upload directory and `attachmentNote` appends their paths to the feedback the
  agent receives. **Only paths we just wrote are appended** — accepting a client-supplied path
  here would turn gate feedback into "ask the agent to read any file on the device".
  - **Files are only accepted while a gate is actually pending** (`awaiting_proposal` /
    `awaiting_report`). Without that check `respond` was a write primitive needing no agent turn
    and no state change — a loop of multipart posts against your own task fills the disk faster
    than the `continue` path, which at least demands a terminal task and starts a session. Found
    by the security review of this change. Answering a gate clears it, so writes are bounded to
    one batch per gate. A text-only answer is unaffected.
  - **`saveAttachments` takes the task's existing attachments, not just their names**, and
    enforces cumulative ceilings (`MAX_TASK_FILES` 30, `MAX_TASK_BYTES` 100 MB) on top of the
    per-request 10 × 25 MB. Per-request caps bound one upload, never a sequence of them, and a
    task accepts batches at dispatch, at every gate and on every follow-up. Over-cap files are
    skipped, not an error — the caller reports what it got back.
- **A route that reads multipart uses `readFormData` (`lib/uploads.ts`), never
  `request.formData()` directly.** Undici throws on a `multipart/form-data` request with no
  `boundary`, and an unhandled throw in a route handler is an HTML 500 — the composer can't read
  an error out of that, so it showed a bare "Failed to dispatch task". This install's log had
  seven of them and no way to tell what had been sent. The helper returns null (→ 400 with
  `BAD_MULTIPART`) and logs the content-type that caused it.
- **The client sends multipart only when there are files**, JSON otherwise. The plain
  "Continue" button used to post a completely empty `FormData`.
- **A rejected `fetch` must be caught in the composer.** `NewTaskForm` didn't, so a network
  error left the button spinning on "Dispatching…" for good with nothing said — from the user's
  side, indistinguishable from the app ignoring them.

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
- `components/FeatureManager.tsx` — The **Features** card on project detail: add, rename, close
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

## Code graph (graphify)
A queryable code knowledge graph lives at `graphify-out/graph.json`. To understand the
component tree or relationships (imports, where a token/style is used, how pages compose),
query it instead of brute-force reading/grepping (far fewer tokens):
- `graphify query "<question>"` · `graphify explain "<node>"` · `graphify path "<A>" "<B>"` ·
  `graphify affected "<component>"` (blast radius). Overview: `graphify-out/GRAPH_REPORT.md`.
- Refresh after structural changes: `graphify update .` (no LLM). Rebuild if missing:
  `graphify extract . --no-cluster`.
- **Caveat (found 2026-08-04):** a no-LLM `graphify update .` re-extracts structure but strips
  `community_name` from every node — the human-readable cluster names `query`/`explain` lean on.
  It backs the curated graph up to `graphify-out/<date>/` first. Either set `GEMINI_API_KEY`
  before refreshing, or accept a slightly stale graph rather than committing a de-named one.

## Conventions
- Component style: function components + hooks; `"use client"` only when needed; server components by default
- File naming: PascalCase for components (`TaskLiveView.tsx`), kebab for routes (`[id]/page.tsx`)
- Styling: Tailwind utility classes only — no inline hex, no CSS modules, no styled-components
- Token use: Tailwind semantic palette (neutral/emerald/red/amber/sky/violet); no custom tokens beyond `@theme` font vars
- Accessibility: WCAG AA aspiration; no formal a11y lint plugin configured; keyboard nav not verified
- Commit messages: conventional style (observed from git log)

## Agent operating rules
This project is worked on by the fe-agent (frontend specialist). For each request it follows
a workflow with two approval gates:
**investigate → plan & decompose 🚦(you approve) → build task-by-task (reuse + tokens + a11y, verify visually) → independent review (design + frontend audit) → report + test scenario 🚦(you approve) → commit**.
Pushing/opening a PR is separate (`/fe:ship`). Project-wide consistency sweeps: `/fe:audit`.

Core rules: 1. Onboard before acting. 2. Match the project's design language. 3. Reuse before
you build (no duplicate components; extract a shared base component when a raw pattern
repeats). 4. Use design tokens, never magic values. 4b. Prefer Tailwind + Lucide for new
styling, but match the project's existing system if it has one. 5. Standard, accessible
(WCAG AA), responsive by default. 6. Git is gated — commit only after you approve; never the
default branch. 7. Keep CLAUDE.md + `.fe/design-system.md` current. 8. Ask only when
genuinely blocked. 9. Be honest about scope/uncertainty. 10. Read/update `.fe/notes.md`.
11. Plan & decompose every request. 12. Verify — build, lint, and look. 13. Two review
lenses (`design-reviewer` + `frontend-auditor`). 14. Nutshell + `.fe/test-scenarios/` doc.
15. Project-wide consistency via `/fe:audit`. 16. Long-horizon work runs on a `.fe/epics/`
plan. 17. Use the `graphify` code graph (`graphify-out/`) to understand structure/
relationships instead of brute-force search; refresh with `graphify update .` after structural
changes.

<!-- fe:end -->
