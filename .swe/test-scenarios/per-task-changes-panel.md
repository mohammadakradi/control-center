# Test scenario: a task page shows what that run changed

_Task: new **Changes** card on `/tasks/[id]`, backed by `GET /api/tasks/:id/changes` — resolves
the root the run actually used (project checkout, or the isolated git worktree a parallel run
executed in) and lets you click through to each file's diff · 2026-08-19_

## Setup / preconditions
- The app running (`pnpm app`, or `pnpm dev` for foreground logs). URLs below use the dev port
  `3001`; an installed app is `7373`.
- A **git project registered** in the app, not a workspace. Its path is `$P`, its id `<pid>`
  (from the project page URL).
- **You must own the tasks you look at.** Task visibility is per-owner: if you created tasks
  while signed in, browse signed in as that account. Opening the app signed out makes you the
  *local workspace*, which sees only its own tasks.
- If you use the dev container and the Changes card never appears, restart it once — a **newly
  created route directory isn't hot-reloaded** over the macOS bind mount, and
  `/api/tasks/:id/changes` is new (`pnpm stop && pnpm dev`).

## Happy path A — a task that ran in the project checkout
1. Make sure the checkout has some uncommitted work: `cd "$P" && echo "scratch" > scratch.md`.
2. Dispatch any task on that project (or open an existing finished one), and open its page.
   - **Expected:** a **Changes** card between the task header and the transcript, showing a
     summary like `3 files · +12 −0`, and **collapsed** behind a `Show` toggle.
   - **Expected:** a line reading *"This run worked directly in the project checkout, so these
     are that tree's uncommitted changes — not necessarily all from this task."* That wording is
     the point: the checkout is shared, so the card must not claim the list is only this run's.
3. Click **Show**.
   - **Expected:** the per-file list — status word, path, `+added −deleted` — capped to a
     scrolling area, the same rows the project page's Source control card uses.
4. Click any file.
   - **Expected:** the diff modal opens with that file's unified diff.
5. Edit a file in `$P`, then click the **refresh** icon in the card header.
   - **Expected:** the list updates. It does **not** poll — each load costs two git subprocesses
     in the process that also serves the live task streams, so refreshing is explicit.

## Happy path B — a parallel run, whose changes live in its own worktree
This is the case the project page cannot show at all.

1. Dispatch a task with **Run in parallel** ticked while the checkout is busy, so it gets an
   isolated worktree. (Or point an existing task row at one — see "Faking it" below.)
2. Open the task page.
   - **Expected:** the Changes card is **expanded** by default, and lists only files the run
     touched inside its worktree — *not* the checkout's uncommitted files. Expanded-by-default is
     deliberate: this tree belongs exclusively to this run.
   - **Expected:** the branch chip in the task header shows the run's branch.
3. Click a file that exists only in the worktree.
   - **Expected:** its diff renders (a new file shows as `new file mode …` with `+` lines).
4. Compare against the project-level view: open `/projects/<pid>` and look at Source control.
   - **Expected:** the worktree's files are **absent** there. The two lists are different trees,
     which is the whole reason this card exists.

### Faking it without waiting for a real parallel run
```sh
# a real linked worktree, named after the task id or the runner's boot sweep will delete it
git -C "$P" worktree add -b tmp/scenario "$P/data/worktrees/<taskId>"
echo "only in the worktree" > "$P/data/worktrees/<taskId>/only-here.md"
```
Then set that task's `workdir` to the absolute worktree path and `branch` to `tmp/scenario`
(the runner does this for you on a real parallel dispatch). Clean up afterwards:
```sh
git -C "$P" worktree remove --force "$P/data/worktrees/<taskId>" && git -C "$P" branch -D tmp/scenario
```

## Edge / failure cases
1. **Someone else's task.** Ask for a task id you don't own:
   `curl -s -o /dev/null -w '%{http_code}\n' "http://localhost:3001/api/tasks/<otherOwnersTaskId>/changes"`
   - **Expected:** `404` — and byte-identical to a task id that doesn't exist at all
     (`…/api/tasks/task_nope/changes`). "Not yours" and "doesn't exist" must be
     indistinguishable, or task ids become an enumeration oracle.
2. **A finished parallel run whose worktree was cleaned up.** Remove the worktree directory
   (`git -C "$P" worktree remove …`) and reload the task page.
   - **Expected:** *"This run's isolated worktree was cleaned up after it finished, so there is
     no working tree left to compare"*, naming the branch its commits are on.
   - **Expected — the important part:** it does **not** fall back to showing the project
     checkout's uncommitted changes. Those belong to whatever is running there now; crediting
     them to this finished run would be a lie.
3. **A leftover directory git no longer recognises.** With a worktree in place, hide its `.git`
   pointer and reload:
   ```sh
   W="$P/data/worktrees/<taskId>"
   mv "$W/.git" "$W/.git-off"
   ```
   - **Expected:** the same "worktree was cleaned up" message — an **empty** list.
   - **Expected:** specifically *not* a list of the enclosing repository's files. In a dev
     checkout `data/worktrees/` sits inside the platform's own repo, so git would otherwise walk
     up and report that repo's entire change set under this task's name. Restore with
     `mv "$W/.git-off" "$W/.git"`.
4. **The three disguises a `.git` can wear.** Each of these was reproduced by the security audit
   against an earlier version of the guard, and each must now be refused. Run them one at a time,
   reloading the task page after each, and restore in between.
   ```sh
   W="$P/data/worktrees/<taskId>"; cp "$W/.git" /tmp/gitptr.bak
   mv "$W/.git" "$W/.git.real" && mkdir "$W/.git"          # (a) an empty directory named .git
   rmdir "$W/.git" && mv "$W/.git.real" "$W/.git"           #     restore
   rm "$W/.git" && ln -s /some/other/repo/.git "$W/.git"    # (b) a symlink
   rm "$W/.git" && cp /tmp/gitptr.bak "$W/.git"             #     restore
   printf 'gitdir: /some/other/repo/.git\n' > "$W/.git"     # (c) a pointer at another repo
   cp /tmp/gitptr.bak "$W/.git" && rm /tmp/gitptr.bak       #     restore
   ```
   - **Expected, all three:** "worktree was cleaned up", empty list. (a) and (b) would otherwise
     make git walk up into the enclosing repo; (c) would report *another repository's* files and
     line counts under this task's name.
   - **Expected after each restore:** the run's own files are listed again — the guard has no
     false negative on a real worktree.
5. **A failed refresh keeps what you were looking at.** With the list showing, stop the server
   (or pull the network) and click the refresh icon.
   - **Expected:** an error line appears *above* the list, and the list stays. A transient fetch
     failure shouldn't throw away a view that was true when it was read.
6. **A non-git project, or a workspace.** Open a task belonging to one.
   - **Expected:** no Changes card at all — not an empty card. A workspace's per-member source
     control lives on the project page.

## What success looks like
Opening a task tells you what it changed without leaving the page: a checkout run shows the
tree's changes with an honest caveat about sharing it, a parallel run shows exactly its own
worktree, and a finished-and-cleaned-up run says so instead of borrowing someone else's diff.
Clicking any file gives you the same hardened diff view the project page uses.
