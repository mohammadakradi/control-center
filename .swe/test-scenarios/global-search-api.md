# Test scenario: global search API (`GET /api/search`)

_Task: one endpoint that answers a short query with matching tasks, projects, agents and backlog
items, fast enough to drive an as-you-type command palette (pm task
`.pm/tasks/20260819-222248-beat-t3-ui-ux/04-backend-global-search-api.md`) · 2026-08-20_

There is no UI for this yet — the command palette is the paired frontend task (05). Everything
below is `curl`, and all of it is read-only: this endpoint only ever runs `SELECT`s.

## Setup / preconditions

- Dev container running: `pnpm dev` (app on http://localhost:3001).
- **`app/api/search/` is a new route directory, so it will 404 until the dev server restarts** —
  file watching over the macOS bind mount misses newly *created* directories. If you get a 404,
  `docker restart platform` (not a file touch) and wait ~10s.
  ```sh
  curl -s -o /dev/null -w '%{http_code}\n' 'http://localhost:3001/api/search?q=up'   # → 200
  ```
- No Anthropic token needed and nothing is dispatched: no tokens are spent by any step here.
- A helper for readable output:
  ```sh
  S='http://localhost:3001/api/search'
  q() { curl -s "$S?q=$1${2:+&limit=$2}" | python3 -m json.tool; }
  ```

## Happy path

1. **A query answers all four types at once.** `q update`
   - **Expected:** a single JSON object with `q`, `limit`, `tooShort: false`, and four groups —
     `tasks`, `projects`, `agents`, `backlog` — each `{ "items": [...], "hasMore": bool }`.
   - Every item carries a `type` field (`"task"`, `"project"`, `"agent"`, `"backlog"`) so the
     palette can flatten the groups into one list and still know how to render each row.
2. **The fields are the ones a palette row needs.** Look at a `backlog` item.
   - **Expected:** `id`, `title`, `status`, `priority`, `assignee`, `projectId`, `projectName`.
   - **Expected: no `description` field at all.** Bodies run to 20 000 characters and are matched
     but never returned (see step 8).
3. **Search a project by its path, not just its name.** `q Dev/`
   - **Expected:** projects whose `path` contains it, each with `id`, `name`, `path`, `isGit`,
     `isWorkspace`.
4. **Prefix matches rank first.** Pick a word that starts one project/task title and appears
   mid-string in another (on this install, `q update` works).
   - **Expected:** the title *starting* with the query comes before the one that merely contains
     it; within a rank, tasks are newest-first.
5. **Caps and `hasMore`.** `q the 1` then `q the 25`
   - **Expected:** at `limit=1` each group has at most one item and `hasMore: true` wherever more
     matched; at `limit=25` the same query returns more items and `hasMore` flips to `false` for
     any group with fewer than 25 matches.
   - `hasMore` is derived by over-fetching one row, so it should never disagree with the item
     count (a group with `hasMore: true` always has exactly `limit` items).

## Ownership — the one real boundary

Tasks are private (`lib/task-access.ts`); projects, agents and backlogs are shared install-wide
by design. **This is the part worth checking by hand.**

6. **Signed out, another account's tasks are invisible.** With no session cookie (a fresh
   incognito window, or plain `curl` as above), search a word you know appears in a signed-in
   account's task titles.
   ```sh
   # How many tasks actually match, regardless of owner — read-only, via the container:
   docker exec platform node -e 'const D=require("better-sqlite3");
     const db=new D("data/platform.db",{readonly:true});
     console.log(db.prepare("select user_id, count(*) c from tasks where title like ? group by user_id").all("%update%"));
     db.close()'
   curl -s "$S?q=update" | python3 -c 'import sys,json; d=json.load(sys.stdin); print("tasks returned:", len(d["tasks"]["items"]))'
   ```
   - **Expected:** the DB reports matching tasks owned by some account; the unauthenticated
     search returns **0** of them — while `backlog` and `projects` still return hits. Both halves
     matter: zero everywhere would just mean "nothing matched".
   - On this install all 106 tasks belong to one signed-in account, so signed out you should see
     `tasks: 0` for every query.
7. **Signed in, you see your own and only your own.** Sign in, repeat the same query in the
   browser (`http://localhost:3001/api/search?q=update`).
   - **Expected:** your own matching tasks now appear, with `status`, `command`, `projectName`
     and an ISO `createdAt`. The count should equal what `/api/tasks` shows for you — search must
     never surface a task the task list hides.
   - An untitled task should be findable by its **request text**, and its `requestText` comes
     back truncated to 200 characters with a trailing `…` (it is the palette's title fallback,
     not something to read).

## Edge cases

8. **A backlog item is findable by its body but its body doesn't come back.** Find an item whose
   *title* doesn't contain the query but whose description does (on this install,
   `q __` matches four items via `__tests__` / `__KEY__` in their bodies).
   - **Expected:** the item is returned, and there is still no `description` field.
9. **`LIKE` wildcards are inert.** `q %25%25` (that's `%%` URL-encoded) and `q __`
   - **Expected:** neither behaves like "match everything". `%%` should return **0** results on
     this install; `__` should return only the handful of rows containing two literal
     underscores — *not* 25 of everything, which is what an unescaped `_` (LIKE's
     any-single-character wildcard) would produce.
   - This is the single easiest thing to regress: check the counts, not just that it returned 200.
10. **Short queries are not an error.** `q u`, `q ''`, and the URL with no `q` at all.
    - **Expected:** `200`, `tooShort: true`, four empty groups, and **`q` echoing what you typed**
      (`"u"`, not `""`). The palette shows "keep typing" from this, so a `400` here would flash an
      error on every first keystroke — and blanking `q` would break the usual client staleness
      guard (`if (res.q !== input) discard`) by discarding this very response.
    - Whitespace-only (`?q=%20%20`) behaves the same way — not a match-everything query — and
      echoes `q: ""`, since that is what it trims to.
11. **Malformed input is refused explicitly, not clamped.**
    ```sh
    curl -s "$S?q=$(python3 -c 'print("u"*201)')"        # → 400 "Search for 200 characters or fewer."
    curl -s "$S?q=$(python3 -c 'print("u"*200)')"        # → 200 (exactly at the cap is fine)
    for L in 0 26 abc 1.5 ' 8' 1e3 Infinity; do curl -s "$S?q=agent&limit=$L"; echo; done
    ```
    - **Expected:** every bad `limit` is `400 "limit must be a whole number between 1 and 25."`;
      `?limit=` (empty) falls back to the default 8. Refusing rather than clamping is deliberate —
      results must never silently answer a different question than the one asked.
12. **No SQL injection, and nothing odd from punctuation.** `curl -s "$S?q=%27%20OR%201%3D1%20--"`
    - **Expected:** `200`, treated as literal text (0 results here), no 500 and no error body.
      The pattern is always a bound parameter.
13. **Case-insensitivity, and its documented limit.** `q UPDATE` matches the same rows as
    `q update`.
    - **Expected:** identical results for ASCII. **Known limitation:** SQLite folds case for
      ASCII only, so a query of `Ü` will *not* match `ü`. That is not a bug to file — `lower()`
      has the same limitation and fixing it needs an ICU build.

## Performance (it has to survive a keystroke per character)

14. **Time it against the real database** (106 tasks, 76 backlog items here):
    ```sh
    for i in $(seq 1 10); do curl -s -o /dev/null -w '%{time_total} ' "$S?q=update"; done; echo
    for i in 1 2 3; do curl -s -o /dev/null -w '%{time_total} ' "$S?q=th&limit=25"; done; echo
    ```
    - **Expected:** ~10–25 ms end to end, including the worst case of a two-letter query at the
      maximum limit. A palette debounces on top of this, so anything in this range is ample.
    - It queries four small tables and never touches `task_events` (tens of thousands of rows),
      which is why a long history doesn't slow it down.

## Regression watch

- The endpoint must stay consistent with the task lists: if `GET /api/tasks` and
  `GET /api/search?q=…` ever disagree about which tasks you can see, the search side is wrong.
- `lib/search.test.ts` (21 specs, `docker exec platform env -u RUNNER_HOST pnpm test`) pins the
  two load-bearing properties — owner scoping and wildcard escaping. Both were verified to fail
  when their guard is removed, so a regression in either turns the suite red rather than passing
  quietly.
