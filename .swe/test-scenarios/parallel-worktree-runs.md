# Test scenario: opt-in parallel task runs via git worktree isolation

_Task: a second task on a busy git project can run concurrently in its own git worktree +
branch instead of queueing; queueing stays the default · 2026-08-16_

## Setup / preconditions
- A signed-in user with an Anthropic token saved under **Settings** (dispatch answers 412
  without one).
- A **plain git project** registered (not a workspace, e.g. this repo or Lumii) — the
  checkbox never appears for non-git projects or workspaces.
- Start the app: `pnpm app` (or `pnpm dev` for foreground logs).

## Happy path
1. Open the project page and dispatch a first, reasonably long task (e.g.
   `/swe:task` with any small request). Leave it running.
2. Reload the project page while that task is live.
   - **Expected:** below the prompt box a new checkbox appears: **"Run in parallel"**, with
     copy explaining the isolated worktree/branch. (With no task running, it's absent.)
3. Tick it, describe a second task that touches different files, press **Run task**.
   - **Expected:** the second task goes straight to *running* — no "Queued — waiting for
     another job" line. Its transcript starts with
     `🌿 Running in an isolated git worktree (branch task/<id>) …`.
4. Check the task page header of the second task.
   - **Expected:** a branch chip showing `task/<id>`.
5. On disk: `ls data/worktrees/` (checkout) or `~/.control-center/data/worktrees/` (install).
   - **Expected:** a directory named after the second task's id — a full checkout of the
     project on that branch. `git -C <project> branch` lists `task/<id>`.
6. Let both tasks finish (approve their gates). After the second task reaches **Done**:
   - **Expected:** its transcript ends with `🧹 Cleaned up the isolated worktree — branch
     task/<id> keeps the commits.`, the `data/worktrees/<taskId>` dir is gone, and
     `git -C <project> log task/<id>` still shows the task's commits.
7. In the done task's report, click the linked test-scenario file.
   - **Expected:** the file opens in the modal even though the worktree is gone — it's read
     from the task's branch (`git show`), not the project checkout.
8. Dispatch a third task **without** the checkbox while a task is running.
   - **Expected:** it queues exactly as before ("Queued — waiting for another job…"), and
     starts when the checkout frees up.

## Edge / failure cases
1. Dispatch with `parallel` against a non-git project (curl:
   `curl -X POST localhost:7373/api/tasks -H 'content-type: application/json' -d
   '{"projectId":"<nonGitId>","agentId":"<id>","command":"task","parallel":true}'`).
   - **Expected:** HTTP 400, `"Parallel runs need a git repository…"`, and no task row is
     created. A workspace project answers 400 with the workspace wording.
2. Stop (or let fail) a parallel task mid-run, before it commits.
   - **Expected:** its worktree **stays** in `data/worktrees/<taskId>` — uncommitted work is
     never deleted. Pressing **Continue** on the task resumes in that same tree.
3. Continue a *done* parallel task (whose worktree was cleaned up).
   - **Expected:** the worktree is recreated at the same path from the surviving
     `task/<id>` branch; committed files are back, and the session resumes there.
4. Restart the runner while a parallel task runs (`pnpm stop && pnpm dev`, or edit a
   runner file in dev).
   - **Expected:** the task is failed by boot reconciliation as usual, but its worktree
     survives the boot sweep (only worktrees with no task row, or clean trees of *done*
     tasks, are swept — the log prints `swept N stale task worktree(s)` when any go).
5. Open another user's parallel task id via the file API:
   `curl "localhost:7373/api/projects/<pid>/file?path=CLAUDE.md&task=<theirTaskId>"`.
   - **Expected:** 404 `{"error":"not found"}` — indistinguishable from a nonexistent id.
6. (Optional, destructive-ish) With 16 directories already under `data/worktrees/`, dispatch
   another parallel task.
   - **Expected:** the task fails immediately with "refusing to create another isolated
     worktree: 16 already exist … (cap 16)" — a loud refusal, never a silent queue, and no
     17th directory appears.

## What success looks like
Two agent sessions genuinely run at the same time on one project without touching each
other's files, index, or HEAD; the parallel run's work survives on its own branch; and
nothing about the default queue-first behavior changed for anyone who doesn't tick the box.
