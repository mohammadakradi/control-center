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
- Build: `pnpm build`  (baseline: ❌ **pre-existing failure**, unrelated to app code —
  compiles and typechecks fine, then dies prerendering Next's own `/_global-error` page with
  `TypeError: Cannot read properties of null (reading 'useContext')`. Confirmed 2026-07-31 to
  reproduce on a clean tree with no uncommitted work, so don't treat it as a regression from
  your change. The honest gate is `pnpm test` + `pnpm lint` + `npx tsc --noEmit`.)
- **Host commands that need esbuild hop into the container automatically.** `pnpm dev` installs
  `node_modules` *inside* the Linux container and the named volume means the host sees that
  same Linux build, so `tsx` and `drizzle-kit` die on macOS with "You installed esbuild for
  another platform". `infra/dev/run-script.sh` wraps `db:*` and `cc:*`: it tries the host, falls
  back to the running container, and otherwise names the two fixes. Test/lint/typecheck are not
  wrapped — run those with `docker exec platform …`. Caveat: arguments pass through untouched,
  so a path argument must exist inside the container too (the repo and `~/Dev` are mounted).
- Lint: `pnpm lint`  (baseline: ✅ — no warnings)
- Test: `pnpm test`  (baseline: ✅ 122 tests — Node's built-in runner via `tsx`, no extra
  deps; specs live next to the code as `runner/*.test.ts`, `lib/*.test.ts` and
  `lib/discovery/*.test.ts`, fixtures in `runner/__fixtures__/`. Those globs are listed
  explicitly in the `test` script — a spec in a directory that isn't listed silently never
  runs. DB specs build a throwaway SQLite file from the real schema via `drizzle-kit push`
  and the `PLATFORM_DB` override — never `data/platform.db`.)
- Typecheck: `npx tsc --noEmit`
- **Schema changes: `pnpm db:generate` then `pnpm db:migrate`.** `db:generate` writes a
  versioned SQL file into `drizzle/` (review it — that file is what runs on every user's
  machine); `db:migrate` applies what's pending, snapshotting first. Commit the migration with
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
- **Projects and agents are deliberately shared**: a project is a folder on the device, an agent
  is an installed plugin. Tasks, transcripts and Anthropic tokens are the private part.
- `getCurrentUser()` never returns null now (it falls back to the local workspace);
  `getSignedInUser()` is the one that can, for UI that must tell the two apart.
- **This is app-level separation, not OS-level.** Anyone with filesystem access can read
  `~/.control-center/.env` and the vault. Separate macOS accounts get separate installs and are
  genuinely isolated; two people sharing one login are not.

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
  with three assets: `control-center-<version>.tar.gz`, `install.sh`, `SHA256SUMS`. No
  `pnpm build` — it fails upstream (see the build note above) and releases ship the dev server.
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
- **The app never updates itself.** `lib/updates.ts` + `components/UpdateBanner.tsx` only
  *report* that a release exists. Applying it means replacing the files of the running process,
  which is the launcher's job. This is also why there's no Docker socket anywhere.
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
- **`control-center` env:** `CC_PORT` (3001), `CC_HOME` (`~/.control-center`),
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
- **Install:** open http://localhost:3001 in Chrome → install button in the address bar (or
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

## UI architecture map
- `agents/` — the swe / fe / pm plugins, vendored and shipped in the release tarball (see
  "The agents ship with the app"); read by `lib/discovery/agents.ts`, never imported as code
- `app/` — Next.js App Router pages and API routes
- `app/page.tsx` — Dashboard (agent list, project list, recent tasks)
- `app/agents/` — Agent list + detail pages
- `app/projects/` — Project list + detail pages
- `app/tasks/[id]/` — Task live view (SSE + gate actions via the authenticated
  `/api/tasks/[id]/{stream,respond,reply,stop}` proxy routes — the browser never talks
  to the runner directly)
- `app/settings/` — Per-user settings (Anthropic token vault card)
- `app/usage/` — Per-user usage page: spend summary + Claude plan-limit bars. A top-level
  nav entry, not a Settings sub-section (moved out of Settings 2026-08-02)
- `app/api/` — API routes (projects, tasks, agents, git, fs, diff, file, settings/token)
- `app/api/fs/list/` — Signed-in-only directory listing behind the **Browse…** folder picker
  (`components/FolderPicker.tsx` + `lib/fs-browse.ts`). There is no native OS picker: the
  old `/api/fs/pick` shelled out to macOS `osascript`, which can never work in the Linux
  dev container, so it was removed (2026-08-04)
- `components/` — All reusable UI components (bespoke)
- `components/ui-cards.tsx` — Core primitives: `card`, `CardSection`, `PageHeader`,
  `EmptyState`, `Chip`, `Tile`, `Fact`
- `components/ui/` — Base primitives: `button.tsx`, `modal.tsx`, `select.tsx`
- `components/Sidebar.tsx` — Desktop primary nav (collapsible rail, `md+`)
- `components/MobileNav.tsx` — Mobile top bar + bottom tab bar (`< md`)
- `components/ThemeToggle.tsx` — Light/dark/system control (segmented + icon variants)
- `lib/` — Shared logic: db (Drizzle + SQLite), discovery, git, ui utils
- `lib/theme.ts` / `lib/sidebar.ts` — Pre-paint init scripts + external stores for the
  theme and sidebar state (both persisted in `localStorage`, applied to `<html>`)
- `lib/secrets.ts` — Encrypted per-user Anthropic token vault (`data/secrets/`, master
  key from `SECRETS_MASTER_KEY`; write-only API, tokens never leave the server)
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
- Tests: `runner/*.test.ts`, `lib/*.test.ts`, `lib/discovery/*.test.ts` (`pnpm test`)

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
