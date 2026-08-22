# Test scenario: the parallel option on the backlog and pm-spec dispatch paths

_Task: running a backlog item or a pm spec can opt into git-worktree isolation exactly like a
manual dispatch — same offer conditions, same refusals (pm task
`.pm/tasks/20260821-135656-feature-grouping-branches-parallel/03-fullstack-parallel-backlog-spec-dispatch.md`)
· 2026-08-21_

Before this, only the project composer (`NewTaskForm`) could ask for a parallel run: the
backlog's run route read no request body at all, so a planned item always queued behind a busy
checkout. Steps 1–6 need no Anthropic token (they test the contract of the route and the
rendering of the offer); steps 7+ need a real dispatch, because worktree isolation only actually
happens once a run launches.

## Setup / preconditions

- Dev container running (`pnpm dev`, app on http://localhost:3001).
- A registered **git, non-workspace** project with at least one open backlog item. This repo
  qualifies.
  ```sh
  curl -s localhost:3001/api/projects | python3 -m json.tool | grep -E '"id"|"name"|"isGit"|"isWorkspace"'
  P=proj_xxxxxxxx                     # a git project that is not a workspace
  W=proj_yyyyyyyy                     # a workspace project, for the refusal steps
  B=http://localhost:3001/api/projects/$P/backlog
  I=$(curl -s $B | python3 -c "import json,sys; print(json.load(sys.stdin)['items'][0]['id'])")
  c() { curl -s -o /tmp/o -w '%{http_code} ' "$@"; head -c 200 /tmp/o; echo; }
  ```
- For steps 7+: signed in as a user with a token saved under Settings, passing that session
  cookie (`COOKIE="session=<value>"`). Without it every dispatch answers **412** — which is
  itself useful, because a 412 means the request got all the way past the parse and the guards.

## The route's contract (no token needed)

1. **A body-less run still works.** This is the historical caller — the Run button and the file
   modal both sent no body until this change.
   ```sh
   c -X POST $B/$I/run
   ```
   - **Expected:** exactly what it answered before this task — `201` with `{item, task}` if you
     have a token, `412` if you don't. **Not** a 400 and **not** a 500.
2. **An explicit choice is accepted, both ways.**
   ```sh
   c -X POST $B/$I/run -H 'content-type: application/json' -d '{"parallel":true}'
   c -X POST $B/$I/run -H 'content-type: application/json' -d '{"parallel":false}'
   c -X POST $B/$I/run -H 'content-type: application/json' -d '{}'
   ```
   - **Expected:** the same status as step 1 for all three. With a token, check the created
     task's row: `"parallel": true` for the first, `false` for the other two
     (`curl -s localhost:3001/api/tasks | python3 -m json.tool | grep -A2 parallel`).
3. **A non-boolean `parallel` is refused, not coerced.**
   ```sh
   for v in '"1"' '"true"' '"false"' 1 0 null '{}' '[]'; do
     c -X POST $B/$I/run -H 'content-type: application/json' -d "{\"parallel\":$v}"
   done
   ```
   - **Expected:** `400 {"error":"parallel must be a boolean"}` every time, and **no task
     created**. The point: coercing would queue a run someone asked to isolate, and the user
     could not tell — the run would look exactly like one nobody asked to isolate.
4. **A malformed body is not a 500.** An unhandled throw in a route handler renders an HTML
   error page, which the UI cannot read a message out of.
   ```sh
   c -X POST $B/$I/run -H 'content-type: application/json' -d 'not json at all'
   c -X POST $B/$I/run -H 'content-type: text/plain' -d 'hello'
   c -X POST $B/$I/run -H 'content-type: multipart/form-data' -d 'x'
   ```
   - **Expected:** the step-1 status (412 or 201) for each — an unreadable body means "run it
     normally", like no body at all. Never `500`, never an HTML response.
5. **The body cannot set anything but `parallel`.** Everything about *what* runs comes off the
   item's own row.
   ```sh
   c -X POST $B/$I/run -H 'content-type: application/json' \
     -d '{"parallel":true,"featureId":"f_somewhere_else","title":"pwn","source":"manual","userId":"someone"}'
   ```
   - **Expected:** the step-1 status, and (with a token) a task whose `title` is the **item's**
     title, whose `featureId` is the **item's** feature (or null), and whose `userId` is you.
     The extra keys are ignored, not applied and not an error.
6. **An unknown item still 404s before the body matters.**
   ```sh
   c -X POST $B/bli_nope/run -H 'content-type: application/json' -d '{"parallel":"yes"}'
   ```
   - **Expected:** `404 {"error":"not found"}` — the bad body does not turn a missing id into a
     400, so the two answers can't be used to tell whether an id exists.

## The offer in the UI

The checkbox is only shown while the offer holds: **the project's checkout is busy, it's a
plain git repo, and it isn't a workspace.** That is the same condition the composer has always
used (`parallelOffer` in `lib/dispatch.ts`, shared by all three pages now).

7. **Nothing is offered on a free checkout.** With no run in progress, open
   `/backlog?project=$P`.
   - **Expected:** no "Parallel" checkbox on any row. Correct: there is nothing to run in
     parallel *with*, and a plain dispatch will take the checkout immediately.
8. **Start a long-running task** in that project (the composer, any skill — `/swe:task` with
   "count slowly to a hundred" is enough), let it reach `running`, then reload
   `/backlog?project=$P`.
   - **Expected:** every **runnable** row now shows a small `Parallel` checkbox between its
     status control and its Run button. Hovering it explains that another task is using the
     checkout. Rows that are **done** or **already running** show none — their Run button
     can't dispatch anything, so the choice would be meaningless.
   - Screen-reader check: each checkbox's accessible name is `Run in parallel — <item title>`,
     not a wall of identical "Parallel" labels.
9. **Run one with the box ticked.**
   - **Expected:** it navigates to the new task, which does **not** sit at `queued` waiting for
     the other one. The task page's branch chip shows `task/<id>` (or whatever branch the agent
     switched to) and the run's files land under `data/worktrees/<taskId>/`, not in the project
     checkout. `curl -s localhost:3001/api/tasks | grep workdir` shows a non-null `workdir` for
     it and null for the run holding the checkout.
10. **Run another with the box clear** (while both of the above are still going).
    - **Expected:** `queued`, `workdir: null` — it waits for the checkout, exactly as before
      this change. The choice is per row, per run.
11. **A workspace never offers it.** Open `/backlog?project=$W` while that workspace has a run
    going.
    - **Expected:** no checkbox. And the route refuses the flag outright if you send it by
      hand: `c -X POST http://localhost:3001/api/projects/$W/backlog/<item>/run -H
      'content-type: application/json' -d '{"parallel":true}'` → **400** naming the workspace,
      with **no task row created**. Same for a non-git project (400 naming git). This is
      `createAndStartTask`'s own refusal — the run route inherits it rather than re-deciding.
12. **The pm-spec path offers the same choice.** Open a task page for a run whose transcript
    links a `.pm/tasks/.../NN-something.md` spec (a `/pm:plan` run has these) while that
    project's checkout is busy, and click the file link.
    - **Expected:** the file modal's header row shows a `Parallel` checkbox beside
      "Create task". Tick it and press Create task.
    - **Expected:** the same 201 → navigation as the backlog's Run button, and the item the
      spec belongs to moves to `in_progress` with `linkedTaskId` set (this path dispatches
      *through* the backlog item, which is what keeps the backlog's status honest), with the new
      task's `parallel` true.
    - The fallback path is worth one check too: for a spec the backlog cannot hold (a
      **workspace member's** spec, `?member=…`), the same tick must reach `POST /api/tasks` —
      the task is created directly with `parallel: true` and no backlog item is linked.

## Known limitations (expected, not bugs)

- **The offer is a page-load snapshot.** The *first* dispatch against a free checkout never
  sees the checkbox, and a checkout that becomes busy after the page painted doesn't grow one
  until you reload. This is exactly how the composer's checkbox has always behaved. If the run
  holding the checkout finishes before your dispatch lands, the flag simply runs the task
  normally — the runner re-decides at launch (`launchMode` in `runner/worktree.ts`).
- So **fanning out a batch** is: dispatch the first item normally, reload the backlog, then tick
  Parallel on the rest.
- Feature-linked runs are the exception once task 02 is in: those isolate whether or not the
  checkout is busy, so their behaviour here doesn't depend on this snapshot at all.
- Worktree creation is capped at `MAX_WORKTREES` (16) in `runner/worktree.ts`; the 17th parallel
  run fails with the reason rather than filling the disk. Nothing in this task changes that
  ceiling — it just makes the flag reachable from two more buttons.
