# Test scenario: per-project backlog (data model, API, pm-spec sync, run dispatch)

_Task: each project now has a durable backlog in the database — the pm agent's `.pm/tasks/`
specs sync into it, items carry a status, and an item can be dispatched as a real task ·
2026-08-11_

## Setup / preconditions

- Dev container running: `pnpm dev` (app on http://localhost:3001). **If you added these
  routes and get a 404, restart the container** — a newly created route *directory* isn't
  hot-reloaded over the macOS bind mount (`docker restart platform`).
- The migration is applied: `pnpm db:migrate` (says `Applied 0002_backlog_items`, or
  "nothing to migrate" if you already ran it).
- Pick a project that has `.pm/tasks/` folders — this repo itself does. Get its id:
  ```sh
  curl -s localhost:3001/api/projects | python3 -m json.tool | grep -E '"id"|"path"'
  P=proj_xxxxxxxx   # the one whose path is your project
  B=http://localhost:3001/api/projects/$P/backlog
  ```
- For the **run** step only: you must be signed in as a user who has saved an Anthropic token
  under Settings, and pass that session cookie (`COOKIE="session=<value>"` from dev tools →
  Application → Cookies). Without it the run step correctly refuses with 412.

## Happy path

1. **First load imports the specs.** `curl -s $B | python3 -m json.tool | head -40`
   - **Expected:** `synced` reports `{"added": <n>, "updated": 0}` with `n` = the number of
     `.md` files under `.pm/tasks/*/` excluding `index.md`. Every item has `"status": "todo"`,
     `"source": "pm-sync"`, a `sourcePath` like
     `.pm/tasks/20260811-113836-tasks-backlog-activity/03-backend-backlog-model-api.md`, and
     `title`/`assignee`/`priority` taken from the spec's frontmatter — a `stack: frontend`
     spec with no explicit `assignee` shows `"assignee": "fe"`, everything else `"swe"`.
     `description` is the whole file.
2. **Loading again changes nothing.** Run the same command.
   - **Expected:** `{"added": 0, "updated": 0}` and the same number of items. This is the
     property that lets the list endpoint sync on every load.
3. **An edited spec refreshes.** Change a `title:` in one of the spec files, reload.
   - **Expected:** `{"added": 0, "updated": 1}` and that item's new title. Same row id.
4. **A new plan appears by itself.** Create `.pm/tasks/29990101-000000-scratch/01-thing.md`
   containing `# A scratch item`, reload.
   - **Expected:** `{"added": 1}`, title `A scratch item`, assignee `swe` (no frontmatter),
     and it sits at the **top** of the list (newest into the backlog first).
5. **Add an item by hand.**
   ```sh
   curl -s -X POST $B -H 'content-type: application/json' \
     -d '{"title":"Tidy the logging","description":"too chatty","assignee":"swe"}'
   ```
   - **Expected:** `201` and the row: `"source": "manual"`, `"sourcePath": null`,
     `"status": "todo"`, `"statusOverride": false`. Do it twice — two null-`sourcePath` rows
     coexist happily (the unique index only constrains real paths).
6. **Change a status.** With `I=bli_xxxxxxxx` from step 5:
   `curl -s -X PATCH $B/$I -H 'content-type: application/json' -d '{"status":"done"}'`
   - **Expected:** `"status": "done"` and `"statusOverride": true`. Reload the list — it stays
     done.
7. **Run an item** (needs the token cookie):
   ```sh
   curl -s -X POST -H "Cookie: $COOKIE" $B/$I/run | python3 -m json.tool
   ```
   - **Expected:** `201` with `{item, task}`. The task is `"command": "task"`, `"status":
     "queued"`, `userId` = you, and its `requestText` is the item's title + description (for a
     **synced** item it's `Implement this task spec (source: <path>):` followed by the file —
     the same wording the file-modal button uses). The item now has `linkedTaskId` set.
   - Open `http://localhost:3001/tasks/<task id>` — the run is live. (Stop it if you don't
     want it to actually do the work.)
8. **The list shows what happened to it.** Reload `$B`.
   - **Expected:** that item carries `"linkedTask": {"id": "task_…", "status": "…"}`. Once the
     task reaches `done`, the item flips to `"done"` on the next load — unless you had set its
     status by hand (step 6), in which case your choice stands. That's the rule: a person
     always outranks the machine.

## Edge / failure cases

1. **A spec file's fields are read-only through the API.** On a `pm-sync` item:
   `curl -s -X PATCH $B/<synced item id> -d '{"title":"Hijacked"}' -H 'content-type: application/json'`
   - **Expected:** `409`, naming the file: "title is read from .pm/tasks/… — edit the spec file
     instead. Only status can be changed here." A `{"status":…}` PATCH on the same item works.
2. **Forged fields are dropped.** POST an item with
   `{"title":"x","sourcePath":".pm/tasks/fake/01.md","source":"pm-sync","linkedTaskId":"task_someone_else","statusOverride":true}`.
   - **Expected:** `201` with `sourcePath: null`, `source: "manual"`, `linkedTaskId: null`,
     `statusOverride: false`. None of those are client-settable.
3. **Validation.** Each of these is a `400` with a specific message: `{}` (title is required),
   `{"title":"   "}` (empty), `{"title":"x","assignee":"pm"}`, `{"status":"finished"}`, a
   title over 200 chars, a description over 20 000 chars. A PATCH with `{}` → `400`
   "nothing to update". Past 1 000 items in one project, POST answers `409`.
4. **Unknown ids all read the same.** `GET`/`POST` on `/api/projects/proj_nope/backlog`,
   `PATCH`/`run` on `$B/bli_nope`, and an item id belonging to a *different* project → all
   `404 {"error":"not found"}`. (Cross-project ids must be indistinguishable from missing
   ones.)
5. **No token, no dispatch.** Repeat step 7 with **no** cookie (the local workspace, which has
   no token on a fresh install).
   - **Expected:** `412` with `needsToken: true` and the "Add your Anthropic token under
     Settings" message. Then reload the list: the item's `status` and `linkedTaskId` are
     **unchanged** and no task was created — a refused dispatch leaves no debris.
6. **No double-running.** While a run from step 7 is still going, POST `/run` again.
   - **Expected:** `409` "This item is already running as task task_… (building)." Once that
     task is done/failed/cancelled, `/run` is allowed again (re-running is legitimate).
7. **Neither a symlink nor a hard link is a spec.** Inside a `.pm/tasks/<request>/` folder:
   ```sh
   ln -s /etc/hosts 99-symlinked.md          # symlink
   ln 03-something.md 98-hardlinked.md       # hard link to a real spec
   ```
   then reload `$B`.
   - **Expected:** neither is imported, no foreign content appears anywhere in the response, and
     `synced.skipped` counts them with a `warnings` entry explaining why — a refusal must never
     be silent. Point the symlink at `~/.ssh/id_rsa` if you want the real threat: the backlog is
     shared with every user on the install, and its contents travel in export archives.
   - **Also expected, and worth understanding:** `skipped` will be **3**, not 2. Hard-linking a
     spec raises the *inode's* link count, so the legitimate original is refused too. Remove both
     files and reload — `skipped` returns to 0 and the original reads again.
   - **Do not test this with a FIFO on a bind-mounted path** (`mkfifo` under `/Users`): it wedges
     the container runtime's file sharing. The unit specs cover the FIFO case inside the
     container's own `/tmp`.
8. **A deleted spec keeps its item.** Delete one of the spec files, reload.
   - **Expected:** the item is still listed with its status and linked task intact — status and
     history aren't recoverable from a file, so the row outlives it. (`added: 0, updated: 0`.)
9. **A missing project folder doesn't break the page.** Temporarily rename the project's
   directory on disk and reload `$B`.
   - **Expected:** `200` — the already-imported items still list, `synced` may be `null` and
     `warning` explains the folder couldn't be read. Rename it back.
10. **Deleting a project takes its backlog with it.** `DELETE /api/projects/<a scratch
    project>` then `GET` its backlog → `404`, and no orphan rows remain.
11. **A huge plan folder is clipped, and says so.** Only if you want to see the DoS budget work:
    create a request folder holding ~12 files of 250 KB each, then reload `$B`.
    - **Expected:** `synced.truncated` is `true` with a `warnings` entry saying the oldest request
      folders aren't shown, and the response stays a couple of MB rather than 100+. The scan
      reads newest-folder-first, so newly planned work is what survives the clip — the opposite
      of the first implementation, which silently ignored every *new* spec once a project got big.

## What success looks like

Planned work is no longer trapped in files: every project has a queue with real statuses that
survives restarts, the pm agent's specs arrive in it without anyone importing them, and one
POST turns an item into a running task that reports back. The status rules hold in the
directions that matter — a re-sync never un-does progress, a finished run marks its item done,
and a human's explicit call beats both.

## Cleanup

```sh
rm -rf <project>/.pm/tasks/29990101-000000-scratch      # step 4
# hand-added items (steps 5–7) can be marked cancelled, or removed via
# docker exec platform node -e "…delete from backlog_items where id='bli_…'…"
```
Nothing else to undo: the sync is derived from files, so re-running it rebuilds the rest.
