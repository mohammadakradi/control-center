# Test scenario: run workspace tasks in parallel on different repos

_Task: a workspace task can be scoped to one member repo from the composer's **Repo** picker;
tasks on different repos run side by side, same-repo and whole-workspace tasks queue · 2026-10-01_

## Setup / preconditions
- A workspace project with at least two member repos that are each their own git repo, next to
  the workspace root — e.g. **Award Maven** (`portal`, `../portal-frontend`, `../am-workers`).
- An Anthropic token saved under **Settings** (each run bills it — use small, cheap requests
  such as `review` or a one-line `task`, and Effort **low**).
- Start the app: `pnpm app` (or `pnpm dev` → http://localhost:3001). The migration `0008`
  (`tasks.member`) is applied on start; for the dev DB run `docker exec platform pnpm db:migrate`.

## Happy path
1. Open the Award Maven project page.
   - **Expected:** under the prompt, a **Repo** row shows **Whole workspace** with the hint
     "pick one repo to run alongside tasks on the others". The dropdown lists Whole workspace,
     `portal`, `portal-frontend` and `am-workers`, each with its role underneath.
2. Pick **portal-frontend**, enter "List the top-level folders and stop", click **Run task**.
   - **Expected:** the task page opens with a **portal-frontend** chip next to the project chip,
     and the task goes to *running* (not *queued*).
   - **Expected:** the transcript's first prompt ends with "📁 This task is scoped to the
     `portal-frontend` repo (…)".
3. Without waiting, go back and dispatch a second task with Repo **portal**.
   - **Expected:** it also starts running immediately — two live tasks, two repos.
4. While both run, dispatch a third task with Repo **portal-frontend** again.
   - **Expected:** it shows *queued* ("waiting for another job on this project to finish") and
     starts automatically when the first portal-frontend task ends — not when the portal one does.

## Edge / failure cases
1. With a member-scoped task running, dispatch one with Repo **Whole workspace**.
   - **Expected:** it queues, and stays queued until **every** running task in the workspace has
     finished. A portal-frontend or am-workers task dispatched *after* it also waits behind it
     (no jumping the queue), then they start once it's done.
2. Ask a **portal** task to "create a file `NOTE.md` in ../portal-frontend using the Write tool".
   - **Expected:** the Write call is denied with "…belongs to another member of the workspace…",
     and the agent reports it needs a separate task on that repo. (A shell command could still
     write there — the guard covers the file tools only, by design.)
3. Queue a portal-frontend task behind a running one, then remove `../portal-frontend` from
   `portal/.swe/workspace.json` and reload the project page (it re-syncs members).
   - **Expected:** when the queued task's turn comes, it fails with "Couldn't start in the repo
     this task is scoped to: member does not name a repo declared in this workspace." — it never
     runs in the workspace root instead. Restore the file afterwards.
4. API refusal (the dev instance needs a token saved, or the token gate answers first):
   `curl -s -X POST localhost:3001/api/tasks -H 'content-type: application/json' -d '{"projectId":"proj_138b288b","agentId":"<swe agent id>","command":"review","member":"/etc"}'`
   - **Expected:** `400` with a message naming the problem (not declared / relative path), and no
     task row created.
5. Open a non-workspace project (e.g. Control Center).
   - **Expected:** no Repo row; the **Run isolated (in parallel)** checkbox behaves exactly as before.

## What success looks like
Two or more Award Maven tasks on different repos show *running* at the same time, while a second
task on the same repo — or a whole-workspace task — waits its turn.
