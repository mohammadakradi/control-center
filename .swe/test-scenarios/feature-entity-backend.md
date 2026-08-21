# Test scenario: the feature entity (schema, backlog sync, API)

_Task: a durable `features` entity that backlog items and tasks link to — auto-derived per
`.pm/tasks/<request>/` folder, creatable by hand, and carried through dispatch (pm task
`.pm/tasks/20260821-135656-feature-grouping-branches-parallel/01-backend-feature-entity-schema-sync-api.md`)
· 2026-08-21_

There is no UI for this yet — grouped views are task 04, and the git branch this reserves is
created for real by task 02. Everything below is `curl`. Nothing here spends Anthropic tokens
and nothing dispatches a run.

## Setup / preconditions

- Dev container running (`pnpm dev`, app on http://localhost:3001), and the migration applied:
  ```sh
  pnpm db:migrate      # → "Applied 0004_pretty_vapor" the first time, nothing after
  ```
- **`app/api/projects/[id]/features/` is a new route directory, and so is its `[featureId]`
  child — both 404 until the dev server restarts.** File watching over the macOS bind mount
  misses newly *created* directories, and touching a file does not help. `docker restart
  platform`, wait ~10 s. I hit this twice in one session: the parent route registered and the
  nested one did not, which looks like a routing bug and is not one.
  ```sh
  P=proj_f4dff8e9    # this repo; `curl -s localhost:3001/api/projects` for the real ids
  Q=proj_61316853    # any *other* project — needed for the cross-project checks
  curl -s -o /dev/null -w '%{http_code}\n' "http://localhost:3001/api/projects/$P/features"  # → 200
  ```
- Helpers:
  ```sh
  A=http://localhost:3001/api
  c() { curl -s -o /tmp/o -w '%{http_code} ' "$@"; head -c 200 /tmp/o; echo; }
  ```

## Happy path — features arrive for free from pm's own folders

1. **Loading the backlog derives one feature per request folder.** This is the whole point: the
   grouping already existed on disk as the `.pm/tasks/<request>/` folder, and nobody has to
   re-state it.
   ```sh
   curl -s "$A/projects/$P/backlog" | python3 -c "
   import json,sys; d=json.load(sys.stdin)
   print('items',len(d['items']),'features',len(d['features']),
         'ungrouped',sum(1 for i in d['items'] if not i['feature']))
   for f in d['features'][:3]: print(' ',f['name'],'->',f['branch'],'|',f['sourceDir'])"
   ```
   - **Expected:** one feature per request folder that holds at least one spec, and **0
     ungrouped** pm-synced items. On this repo that is 11 features over 34 items.
   - **Expected:** each `name` is the request's `index.md` **heading** ("Beat T3 Code on UI/UX"),
     not the folder name and not the word "index".
   - **Expected:** each `branch` is `feature/<slug>` — lowercase, `[a-z0-9-]` only, cut at a
     **word** boundary if long (`feature/fix-the-in-app-update-now-button-so-it-reliably-updates-the`,
     never `…-updates-the-a`).
2. **Loading it again changes nothing.** Run the same command twice.
   - **Expected:** the same feature ids and the same count; `synced.added` and `synced.updated`
     both `0` on the second call. The sync runs on every load, so a second run must be a no-op.
3. **An existing install gets grouped retroactively.** Clear the links by hand, then load:
   ```sh
   # in the container: null out this project's item→feature links and delete its derived features
   ```
   - **Expected:** the next backlog load re-creates the features and re-links every item
     (`synced.updated` = the item count). This is the path every install that predates the
     migration takes, so it must not need a manual step. Verified: 11 features, 34 items,
     0 ungrouped.
4. **A folder with an `index.md` but no specs is not a feature.** An empty request folder is a
   folder.
5. **A feature a spec's item belongs to travels with the item.** Any item in the list:
   - **Expected:** `item.feature` is `{ id, name, branch, status }` — joined in, so a grouped
     list costs one query. An unassigned item has `feature: null`, not a missing key.

## Making and closing features by hand

6. **Create one.** `c -X POST "$A/projects/$P/features" -H 'content-type: application/json' -d '{"name":"Checkout flow, revised!"}'`
   - **Expected:** `201`, `branch: "feature/checkout-flow-revised"`, `status: "active"`,
     `sourceDir: null`.
7. **The same name twice gets a distinct branch.** Repeat step 6.
   - **Expected:** `feature/checkout-flow-revised-2`. Two features sharing a ref would merge each
     other's work. The *name* is not disambiguated — only the branch.
8. **`branch` and `sourceDir` cannot be supplied.**
   ```sh
   c -X POST "$A/projects/$P/features" -H 'content-type: application/json' \
     -d '{"name":"Forger","branch":"feature/../../etc","sourceDir":".pm/tasks/20260821-135656-feature-grouping-branches-parallel"}'
   ```
   - **Expected:** `201` with `branch: "feature/forger"` and `sourceDir: null` — both dropped. A
     forged `sourceDir` would park a feature on a folder the sync then treats as already derived;
     a forged branch is a git ref someone else's `git` will run.
9. **Close a feature out.** `c -X PATCH "$A/projects/$P/features/<id>" -d '{"status":"done"}'` (with
   the JSON content-type header).
   - **Expected:** `200`, `status: "done"`, and **the same `branch` as before**.
10. **Rename a hand-made feature.** `-d '{"name":"Renamed by hand"}'`
    - **Expected:** `200`, new name, **branch unchanged**. The branch is a ref task 02 may already
      have created; renaming must never orphan it.
11. **Renaming a *pm-derived* feature is refused.** Use an id whose `sourceDir` is set.
    - **Expected:** `409` naming `<sourceDir>/index.md` — "change it there instead". The next
      backlog load re-reads that file, so accepting the edit would be a lie. Its **status** is
      still editable (step 9 on the same id → `200`), because no file owns that.

## The refusals that matter

12. **A synced item's feature cannot be reassigned.**
    `c -X PATCH "$A/projects/$P/backlog/<syncedItemId>" -d '{"featureId":"<any>"}'`
    - **Expected:** `409` naming the spec file and the request folder holding it. Same stance as
      its title/description/assignee/priority: the folder owns the grouping.
13. **A hand-added item can be assigned, unassigned, and filed straight into a feature.**
    - **Expected:** `200` for `{"featureId":"<id>"}`, `200` for `{"featureId":null}` (and `""`
      means the same, since a form cannot send null), `201` for a `POST` carrying `featureId`.
14. **A feature id from another project is refused everywhere it can be supplied.** Take a real
    feature id from `$Q` and try it against `$P`:
    ```sh
    c -X PATCH "$A/projects/$P/backlog/<manualItemId>" -H 'content-type: application/json' -d '{"featureId":"<Q-feature-id>"}'
    c -X POST  "$A/projects/$P/backlog" -H 'content-type: application/json' -d '{"title":"x","featureId":"<Q-feature-id>"}'
    c -X PATCH "$A/tasks/<yourTaskId>" -H 'content-type: application/json' -d '{"featureId":"<Q-feature-id>"}'
    ```
    - **Expected:** `400 featureId does not name a feature of this project` in all three. It is a
      *real* id — that is the point. Silently dropping it would hide the work from every grouped
      view; storing it would put this project's work on another repo's feature branch once task 02
      starts merging.
15. **A feature id addressed through the wrong project reads as missing, not forbidden.**
    `c -X PATCH "$A/projects/$Q/features/<P-feature-id>" -d '{"status":"done"}'`
    - **Expected:** `404 not found` — the same "not yours ≡ doesn't exist" rule
      `lib/task-access.ts` uses, so ids can't be probed across projects.
16. **Input validation.** Against a hand-made feature:
    - `{"status":"archived"}` → `400 status must be one of active, done, cancelled`
    - `{}` → `400 nothing to update`
    - a 201-character name → `400 name must be 200 characters or fewer` (**refused, not
      truncated** — a client must never be told one name and given another)
17. **Task assignment is owner-scoped.** `c -X PATCH "$A/tasks/task_deadbeef" -d '{"featureId":null}'`
    - **Expected:** `404` — and the same `404` for a task that exists but belongs to another
      account. Ownership is checked **before** the body, so a malformed body on someone else's
      task still answers `404` rather than `400` (which would confirm the task exists).
    - On a task that *is* yours, a body with no `featureId` key → `400 featureId is required`.
      Nothing else about a task is writable here.

## Security checks worth repeating

18. **A symlinked `index.md` can never name a feature after a file outside the project.** In a
    scratch project: `ln -s ~/.ssh/id_rsa .pm/tasks/20260821-000000-x/index.md`, put one real spec
    beside it, load the backlog.
    - **Expected:** the folder still becomes a feature (it holds work), and its name falls back to
      the folder name with the timestamp stripped ("X"). The link is refused by `readSpecFile`
      (`O_NOFOLLOW`), so the target's contents can never become a feature name — which would land
      them in a row every workspace on the install can read, and in export archives. A **hard
      link** is refused by the same helper's `nlink === 1` check, and a **FIFO** is skipped without
      being opened (opening one to read would hang the request forever).
19. **A newline in a feature name cannot forge a line.** Names are flattened to one line and cut
    by code point. Task 02 will interpolate this name into the preamble handed to an autonomous
    agent, so it is the same class of hazard as a backlog title.
20. **Every branch this mints is one git accepts.** `lib/features.test.ts` runs
    `git check-ref-format --branch` over the hostile cases (`--upload-pack=…`, `../../etc/passwd`,
    `a..b`, `head.lock`, `trailing.`, `ref~1^{}`, a newline) — the slug is an allowlist, so a
    leading `-` (which git would read as an option) cannot survive it.

## Not covered here / known limits

- **A successful dispatch carrying a `featureId` was not exercised over HTTP.** `user_local` has
  no Anthropic token on this install and `ALLOW_SHARED_TOKEN_FALLBACK` is unset, so
  `POST …/backlog/<item>/run` answers `412` before dispatching. What *was* verified over HTTP is
  that the refused run leaves the item at `todo`, unlinked, and still grouped. The storing of
  `featureId` on the task row, and the cross-project refusal happening **before** any row is
  created, are covered by `lib/dispatch.test.ts` against a runner pointed at a dead port.
- **The git branch is only reserved, never created.** `features.branch` is a name; task 02 owns
  creating it, basing task worktrees on it, and merging into it. Nothing in this task runs `git`.
- `GET /api/search` does not return features yet — filed separately.
- The project-scoped feature routes have **no auth**, like every other project-scoped route in
  this app (documented in CLAUDE.md's backlog section). Task assignment is the only owner-scoped
  one. Not introduced here, and not fixed here.
