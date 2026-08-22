# Test scenario: feature branch lifecycle and merge-back in the runner

_Task: each feature gets one real `feature/<slug>` branch; a feature-linked task's finished
work is merged into it deterministically, with conflicts surfaced as visible per-task state
(pm task `.pm/tasks/20260821-135656-feature-grouping-branches-parallel/02-services-feature-branch-merge-runner.md`)
· 2026-08-21_

There is still no UI for any of this (task 04). Everything below is `curl` + inspecting the
project's git repo directly. Steps 1–5 need no Anthropic token; steps 6+ need a real dispatch
(a signed-in user with a token configured under Settings), because the interesting behavior —
worktree creation, branch basing, the merge itself — only happens once an isolated run
actually reaches `done`.

## Setup / preconditions

- Dev container running (`pnpm dev`, app on http://localhost:3001), migration applied:
  ```sh
  pnpm db:migrate      # → "Applied 0005_sweet_magma" the first time, nothing after
  ```
- A registered **git** project that is not a workspace (parallel/isolation needs a plain repo).
  ```sh
  P=proj_f4dff8e9   # this repo, or any other registered git project you're OK branching in
  A=http://localhost:3001/api
  c() { curl -s -o /tmp/o -w '%{http_code} ' "$@"; head -c 300 /tmp/o; echo; }
  ```
- A feature to link tasks to:
  ```sh
  c -X POST "$A/projects/$P/features" -H 'content-type: application/json' \
    -d '{"name":"Merge-back smoke test"}'
  # note the returned id (F) and branch — should read feature/merge-back-smoke-test
  ```

## Without a token — what's observable from dispatch alone

1. **The token gate is checked before anything else — even before the `featureId` it's own
   check — so on an install with no token configured every dispatch answers `412` with no
   task row written at all, whatever else is in the body.** Verified on this install:
   ```sh
   c -X POST "$A/tasks" -H 'content-type: application/json' \
     -d "{\"projectId\":\"$P\",\"agentId\":\"swe@swe-agent-local\",\"command\":\"task\",\"requestText\":\"noop\",\"featureId\":\"$F\"}"
   # → 412 {"error":"Add your Anthropic token under Settings…","needsToken":true}, no taskId
   ```
   That means neither `mergeState: "pending"` on the row nor the cross-project `featureId`
   refusal (`400 featureId does not name a feature of this project`) can be observed over
   HTTP on an install with no token — both are behind the same gate. Both are pre-existing
   dispatch behavior this task didn't touch, and both are already covered directly by
   `lib/dispatch.test.ts` (which sets `ALLOW_SHARED_TOKEN_FALLBACK=1` to get past the gate
   without a real token, so the row-writing and validation order are exercised for real). If
   you have `ALLOW_SHARED_TOKEN_FALLBACK=1` set on a throwaway dev instance, the same two
   checks reproduce over HTTP the same way.

## With a token — the real lifecycle (needs a signed-in user with an Anthropic token)

3. **A feature-linked parallel run always isolates, even when the checkout is free.** Dispatch
   with `{"parallel": true, "featureId": "<F>"}` while nothing else is running against `$P`.
   - **Expected:** the task's live transcript shows `🌿 Running in an isolated git worktree
     (branch task/<id>)`, immediately — not only once you start a *second* concurrent run. This
     is the change from before task 02: previously the first of N parallel siblings against a
     free checkout ran directly in it, un-isolated.
   - In the project's repo on disk: `git branch --list 'feature/*'` should now show the
     feature's branch, created off the project's default branch. `git log --oneline
     feature/merge-back-smoke-test` should be identical to the default branch at the point the
     task started (nothing merged yet).
   - `git log --oneline task/<id>` should start from the **same commit** as the feature
     branch — not from whatever the checkout's HEAD happened to be when you dispatched. If you
     advance the default branch in between two feature-linked dispatches, both task branches
     should still share the *feature* branch's original base, not each other's or the
     checkout's later HEAD.
4. **Let the task reach `done` (approve its gates, or use a trivial `/swe:task` request that
   finishes quickly).**
   - **Expected in the transcript:** a `🔀 Merged task/<id> into feature/<slug>.` log line
     right before the worktree cleanup line.
   - **Expected on the task row:** `c "$A/tasks/<taskId>"` → `mergeState: "merged"`.
   - **Expected on disk:** `git log --oneline feature/merge-back-smoke-test` now includes the
     task's commits, in a merge commit (`--no-ff`, so even a trivially fast-forwardable first
     merge still leaves one). The project's own checkout is untouched — still on whatever
     branch it was on, no uncommitted changes introduced by the merge.
5. **A second feature-linked parallel task, based on the same feature branch, that edits the
   same line the first one did.** Dispatch another `{"parallel": true, "featureId": "<F>"}`
   task against the same feature, and have it commit a change that collides with what the
   first task merged in (e.g. ask it to edit the same file/line step 4's task touched).
   - **Expected in the transcript:** a `⚠️ Couldn't merge task/<id2> into feature/<slug> — left
     for manual resolution:` line, followed by the real `git merge` conflict output.
   - **Expected on the task row:** `mergeState: "conflict"`. Note the task's own `status` is
     still `"done"` — the agent's work finished; the *system's* merge of it didn't.
   - **Expected on disk:** the feature branch is exactly where the first merge left it (no
     partial/conflicted commit landed on it), and `task/<id2>` still holds the second task's
     own commits, untouched — `git log --oneline task/<id2>` shows its work is safe to merge by
     hand (`git checkout feature/merge-back-smoke-test && git merge task/<id2>`, resolve, commit).
   - **Expected:** no leftover worktree from the merge attempt. `git worktree list` should show
     only real task worktrees (and the main checkout) — never a `platform-merge-*` entry, and
     `ls data/worktrees` should not have grown from this step (the temp merge worktree lives
     under the OS tmpdir, not `data/worktrees`, and is removed either way before the task's own
     `finalize()` returns).
6. **A non-parallel feature-linked task (checkout run) gets the preamble, not a merge.**
   Dispatch `{"featureId": "<F>"}` with **no** `parallel` flag, on a project whose checkout is
   currently free.
   - **Expected:** the task runs directly in the project's checkout (no "isolated worktree" log
     line). Its dispatched prompt (visible as the first message in the transcript) ends with a
     line naming the feature and its branch and stating plainly that the platform will not
     merge this run's work automatically.
   - **Expected once it reaches `done`:** `mergeState` is still `"pending"` — forever, for this
     task. That's the honest answer: nothing here system-merges a checkout run.
7. **Continuing an isolated feature task re-sends nothing extra** (the preamble is only for
   non-isolated runs) but the merge step re-runs correctly on its *next* `done` if you continue
   it after a `failed`/`cancelled` state — verify `mergeState` updates the same way as step 4/5
   whichever way the continued run resolves.

## What's out of scope here (later tasks)

- No UI renders `mergeState` or the feature's branch chip anywhere yet — that's task 04.
- The backlog/pm-spec dispatch paths don't yet accept `parallel` in their request bodies —
  that's task 03. This scenario dispatches through `POST /api/tasks` directly for that reason.
