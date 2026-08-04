# Test scenario — Releases, native install, and self-update

**Change:** the app can be installed from a GitHub release and updates itself on launch.
- `.github/workflows/release.yml` — on a `v*` tag: gates, tarball, checksums, GitHub Release.
- `infra/release/pack.sh` — builds `dist/control-center-<version>.tar.gz` from an **allowlist**.
- `infra/release/install.sh` — Node 22+ only; no Docker, no clone, no compiler.
- `infra/release/control-center.sh` — `start|stop|restart|update|status|logs|version`; checks
  GitHub Releases on `start` and updates before launching.
- `lib/updates.ts` + `app/api/updates` + `components/UpdateBanner.tsx` — in-app *reporting*.
- `PLATFORM_DATA_DIR` (`lib/config.ts`, `lib/db`, `drizzle.config.ts`) — data outside `app/`.
- `lib/db/migrate.ts` + `runner/migrate.ts` (`pnpm db:migrate`) + `drizzle/` — versioned
  migrations, run by install.sh and by every `control-center start`.

Distribution is native on purpose. Docker stays the dev runtime; there is no release image.

## 1. Packaging (no release needed)
1. `pnpm release:pack` → prints the tarball path, ~6 MB.
2. `tar -tzf dist/control-center-*.tar.gz | grep -E '(^|/)(data|\.env|\.git)(/|$)'` → **no
   matches**. This is the one that matters: the repo keeps a live database, an encrypted token
   vault and `.env` beside the source.
3. Rename a listed path (e.g. `mv proxy.ts proxy.ts.bak`) and re-run → pack.sh **fails loudly**
   instead of shipping an app missing a file. Undo.

## 2. Native install, end to end (verified 2026-08-04)
Do it in a throwaway home so your real install isn't touched:
```sh
export CC_HOME=/tmp/cc-test CC_PORT=3101 CC_RUNNER_PORT=4419
mkdir -p $CC_HOME/app $CC_HOME/data
tar -xzf dist/control-center-*.tar.gz -C $CC_HOME/app --strip-components=1
cd $CC_HOME/app && npx --yes pnpm@9.12.1 install --frozen-lockfile
```
1. `file node_modules/better-sqlite3/build/Release/better_sqlite3.node` → a **native binary for
   your platform** (`Mach-O 64-bit bundle arm64` on Apple silicon), downloaded prebuilt. No
   compiler was involved — this is the claim the whole "no Docker" path rests on.
2. `printf 'SECRETS_MASTER_KEY=%s\n' "$(openssl rand -base64 32)" > $CC_HOME/.env`, then
   `PLATFORM_DATA_DIR=$CC_HOME/data ./node_modules/.bin/tsx runner/migrate.ts` — the exact
   command install.sh runs. Expect `Applied 0000_init` and 7 tables (`users projects agents
   tasks task_events project_agents sessions`). Not `db:push`: that's the dev-only path.
3. `CC_SKIP_UPDATE_CHECK=1 CC_NO_OPEN=1 sh infra/release/control-center.sh start` → "Running
   (v0.1.0)". Then `status` reports the version, URL and web pid.
4. `curl -o /dev/null -w '%{http_code}' localhost:3101/signin` → **200**; `/` → **307**
   (redirect to signin, correct); `/manifest.webmanifest` → **200**.
5. Sign up through the API (or the UI) and confirm the row lands in
   **`$CC_HOME/data/platform.db`**, and that `$CC_HOME/app/data` stays empty. If a user shows up
   inside `app/`, `PLATFORM_DATA_DIR` isn't being honoured and the next update will eat the data.
6. `control-center stop` → port closed, `pgrep -f "$CC_HOME/app/node_modules"` finds nothing
   (no orphaned `next dev` or `tsx` processes).

## 3. Update check in the app
1. On the install from §2, signed in: `curl -b <cookies> localhost:3101/api/updates` →
   `{"current":"0.1.0","packaged":true,…,"unavailable":"no-releases"}` while the repo has no
   releases. `packaged: true` proves the CLI exported `APP_VERSION`.
2. In a dev checkout (`pnpm dev`), the same endpoint returns `packaged: false` → the banner
   never renders, because `control-center update` can't update a git checkout.
3. Force the banner: publish a release with a version above `package.json`, or temporarily
   start with `APP_VERSION=0.0.1`. Expect a slim info bar above the content with the new
   version, a **Release notes** link, and a dismiss ✕.
4. Dismiss it → gone, and still gone after a reload (`localStorage` `cc:update-dismissed`).
   Bump the release version again → it comes back.
5. Pull the network and reload → **no banner, no error toast, no console noise**; the endpoint
   reports `unavailable: "offline"` with a 200.

## 4. Update flow (needs two releases)
1. Install release N, then publish N+1. Run `control-center start`.
2. Expect, in order: "Checking for updates", download, "Checksum OK", dependency install, DB
   backup line, "Updated to N+1", then the app starts and the window opens.
3. `~/.control-center/data/backup/platform-N-<timestamp>.db` exists, and `app.old` holds the
   previous version.
4. Your projects, tasks and stored Anthropic token are all still there afterwards — that's the
   real assertion. Data lives in `data/`, which the swap never touches.
5. Break it on purpose: point `CC_REPO` at a repo whose release has a bad `SHA256SUMS` → the
   CLI refuses to install and the working version keeps running.
6. Offline `start` → "Couldn't reach GitHub Releases — continuing on N" and it starts anyway.

## 5. Migrations (the part that can destroy data)
`runner/migrate.test.ts` covers this at the unit level; these are the checks worth doing by hand
against a real install.
1. Fresh install → `Applied 0000_init`, `Created …/platform.db`, and `data/backup/` is **absent**
   (nothing existed to snapshot).
2. Run `pnpm db:migrate` again → "Schema is up to date", and still no new snapshot. This matters:
   `start` migrates on every launch, so an unconditional snapshot would fill the disk.
3. Sign up in the app, then stage a fake next release: append an entry to
   `drizzle/meta/_journal.json` and drop a matching `0001_*.sql` (e.g.
   `ALTER TABLE \`projects\` ADD \`note\` text;`). Run `pnpm db:migrate`. Expect: a snapshot line,
   `Applied 0001_…`, the new column present, **your user row still there**, and 2 rows in
   `__drizzle_migrations`. (Verified 2026-08-04.)
4. **Adoption** — the upgrade path for anyone who ran the old `db:push` flow, including this
   repo's own `data/platform.db`. Build a database with
   `npx drizzle-kit push --url=/tmp/legacy.db …`, insert a row, then
   `PLATFORM_DB=/tmp/legacy.db pnpm db:migrate`. Expect "Adopting an existing database", a
   snapshot, **no** migrations applied (they're recorded, not replayed), and the row intact.
5. **Refusal** — create a database with a deliberately incomplete `users` table and migrate it.
   It must fail with "doesn't match the schema", name the missing column, and point at
   `pnpm db:push`. It must NOT start the app.
6. `control-center start` on a database it can't migrate exits non-zero and starts nothing —
   the failure has to be louder than a broken page.

## 6. Shell-portability of the shipped scripts (regression: v0.1.0)
1. `sh infra/release/pack.sh` must pass. Now break it on purpose — change `${REPO}…` back to
   `$REPO…` in install.sh — and re-run: it must **refuse** with a message naming the file and
   line. Restore.
2. Why it matters: macOS `/bin/sh` is bash 3.2 and reads `$REPO…` as one variable name, so
   under `set -u` the installer died on its third line with `REPO…: unbound variable`. Linux
   shells parse it fine, so no CI job catches it.
3. Sanity-check the guard itself with `sh -c "LC_ALL=C grep -nE '...' file"` — under `/bin/sh`,
   `grep -P` exits 2 (BSD grep has no PCRE) and an `if` treats that as "no match".

## 7. Release workflow (first real tag)
1. Bump `package.json` to `0.2.0`, tag `v0.2.0`, push the tag.
2. The workflow fails fast if the tag and `package.json` disagree — try `v9.9.9` once to see it.
2b. Change `lib/db/schema.ts` without running `pnpm db:generate` and push a tag → the
   "Check migrations cover the schema" step fails before anything is published.
3. On success the release page carries exactly three assets (tarball, `install.sh`,
   `SHA256SUMS`) and notes that lead with the install instructions.
4. `curl -fsSL .../releases/latest/download/install.sh -o install.sh && sh install.sh` on a
   **clean machine** (or a fresh `CC_HOME`) is the real acceptance test for the install path —
   the download half can't be exercised until a release exists.
