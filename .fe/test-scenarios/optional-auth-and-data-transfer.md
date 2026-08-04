# Test scenario — Optional sign-in, per-owner data, export/import

**Change:** signing in is no longer required; it's how you keep your tasks and token private
from others using the same install. Plus `cc:export` / `control-center import` to move an
install's data, and `control-center start` launching the installed app bundle when there is one.

- `lib/auth.ts` — `getCurrentUser()` never returns null (falls back to the local workspace);
  `getSignedInUser()` is the nullable one. `lib/identity.ts` holds `LOCAL_USER_ID` with no deps.
- `lib/task-access.ts` — `ownedBy` / `findOwnedTask`, applied to all 13 task reads.
- `proxy.ts` — keeps only "signed-in visitors don't need /signin".
- `drizzle/0001_local_workspace.sql` + `ensureDataInvariants()` — the local identity, and
  ownerless tasks re-homed to the only account.
- `lib/data-transfer.ts`, `runner/export.ts`, `runner/import.ts`.

## 1. The app opens without an account
1. Sign out (or use a fresh profile). Every page — `/`, `/projects`, `/agents`, `/usage`,
   `/settings` — returns **200**. Nothing redirects to `/signin`.
2. The sidebar footer says **Local workspace** with a **Sign in** link (icon-only in the rail,
   and in the mobile top bar).
3. Add a project, paste an Anthropic token under Settings, dispatch a task. It all works with
   no account. The task appears on the dashboard.

## 2. Signing in separates data (the part that must not regress)
1. While signed **out**, note the dashboard task list. Sign in as an account that has history.
2. Expect a *different* list: yours. The local workspace's tasks are gone from view, and vice
   versa after signing out.
3. Copy a task id belonging to the signed-in account. Sign out, then as the local workspace:
   ```sh
   curl -o /dev/null -w '%{http_code}\n' localhost:3001/api/tasks/<id>
   curl -o /dev/null -w '%{http_code}\n' localhost:3001/api/tasks/<id>/stream
   curl -o /dev/null -w '%{http_code}\n' -X POST localhost:3001/api/tasks/<id>/stop
   curl -o /dev/null -w '%{http_code}\n' -X POST -H 'content-type: application/json' \
     -d '{"text":"x"}' localhost:3001/api/tasks/<id>/reply
   ```
   All four must be **404** — not 403, not 200. Before this change `stop` and `reply` had no
   ownership check at all and would have gone through.
4. `curl localhost:3001/api/tasks` as the local workspace → `[]`, not everyone's tasks.
5. Projects and agents *are* still shared — both workspaces see the same project list. That's
   deliberate: a project is a folder on the device.
6. Usage (`/usage`) shows only your own spend in each workspace.

## 3. Upgrading an existing install
1. On a database that predates this change, `pnpm db:migrate` reports "created the local
   workspace identity" and "gave N ownerless task(s) to the only account".
2. Those tasks are now behind the account: signed out you see none of them; signed in you see
   them all. (On the live database: 106 tasks, all under `admin@email.com`.)
3. Run it again → no changes, no snapshot. Idempotent.
4. **Regression guard:** this must work on an *adopted* database too. Adoption records
   migrations without running them, which silently skipped both steps the first time — that's
   why they live in `ensureDataInvariants`, not only in the migration.

## 4. Export
1. `pnpm cc:export` → `dist/control-center-data-<stamp>.tar.gz`, mode **0600**, with a per-table
   row count printed.
2. `tar -xzOf <archive> */manifest.json` → app, version, migrations, per-table counts,
   `includesTokens: false`, and any warnings.
3. Usage survives: the exported `tasks` rows keep `usage_input_tokens`, `usage_output_tokens`
   and `usage_cost_usd`, and `task_events` travels (usage can be recomputed from it).
4. `--include-tokens` adds `tokens.json` with **decrypted** tokens and says so loudly. Without
   the flag there is no such file — check with `tar -tzf`.
5. Sessions are never in the archive, flag or no flag.
6. **Damaged source:** if a table can't be read, the export still completes; the rows are
   counted as skipped and named in the manifest warnings. (Verified against the live database,
   which recovered all 59,305 transcript rows with none skipped.)

## 5. Import
1. Into a fresh install: `control-center import <archive>` → counts, then "Tasks now belong
   to: <email>: N". Sign in with that account to see them.
2. `--claim-as-local` instead → everything owned by the local workspace, visible with no
   sign-in.
3. Into an install that already has tasks → **refuses**, telling you to pass `--force`. With
   `--force` it snapshots to `data/backup/platform-pre-import-*.db` first.
4. While the app is running, `control-center import` stops it first and says so.
5. An archive from a newer app (edit `migrations` in the manifest to add a fake tag) → refused
   by name, with "Update first".
6. Attachments land in `data/uploads/` and open from their tasks.

## 6. Dock icon
1. With no installed app bundle, `control-center start` opens a `--app=` window and prints the
   one-time tip about installing it (once — the marker is `~/.control-center/.install-hint-shown`).
2. Install it from Chrome, then `control-center start` again → it launches
   `~/Applications/Chrome Apps/Control Center.app`, whose Dock icon is the ring/C logo rather
   than Chrome's, and which appears in Launchpad, Spotlight and ⌘Tab.
