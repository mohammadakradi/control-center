# build and environment

The full build/run/test reference: every command, the Docker dev notes, the host-command container hop, and the war stories behind each (why `pnpm build` broke, why a new route dir isn't hot-reloaded, how Claude auth is per-user).

<!-- Moved out of CLAUDE.md on 2026-08-24 to bring it inside its 20 KB budget (engineering rule 7). Content is verbatim; only the heading level and this header are new. -->

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
