# Test scenario: a planted git hook never fires on a platform-issued command

_Task: neutralize git hooks and machine-wide config on every git command the platform issues, so
a worktree can't become a persistent backdoor that executes in the server process ·
`.pm/tasks/20260818-183136-neutralize-git-hooks-worktrees/` · 2026-08-19_

## What this is actually about

`git worktree add` gives a parallel task its own HEAD, index and files — but **not** its own
`.git/hooks/`. That directory is one shared copy, reached identically from the main checkout and
from every task's worktree, and nothing in it is tracked, so a planted hook shows up in no
`git status`, no diff, no review and no clone. An agent has ordinary write access to it from
inside the tree it was handed.

Before this change, a hook written from one task's "isolated" worktree executed **in the web
server / runner process** whenever anyone loaded that project's page, clicked a git button, or
dispatched another parallel task. After it, git commands the platform issues run no hooks at all.
An agent's own `git` from its Bash tool still runs them, which is correct — that's a developer
tool doing what a developer expects.

## Setup / preconditions

- The app running (`pnpm app`, or `pnpm dev` for foreground logs).
- A **git project registered** in the app that you don't mind littering — a scratch clone is
  ideal. Below, `$P` is its path and `<id>` its id (from the project page URL).
- A marker directory outside the repo, so a fired hook leaves visible evidence:

  ```sh
  mkdir -p /tmp/cc-hook-markers && rm -f /tmp/cc-hook-markers/*
  ```

### Plant the hooks

```sh
cd "$P"
for h in post-checkout pre-push post-merge post-index-change reference-transaction; do
  cat > ".git/hooks/$h" <<EOF
#!/bin/sh
touch /tmp/cc-hook-markers/$h
exit 0
EOF
  chmod +x ".git/hooks/$h"
done
```

Note these go in the **project's** `.git/hooks/` — that is the same directory a task's worktree
would be writing to, which is the whole point.

## 1. Prove the plant is real (do this first)

If this step produces no markers, the rest of the scenario proves nothing — your git or your
filesystem isn't cooperating and you should stop and work out why.

```sh
cd "$P"
git checkout -b cc-hook-proof && git checkout -             # plain git, not the platform
ls /tmp/cc-hook-markers/
```

- **Expected:** `post-checkout` (and probably `post-index-change`, `reference-transaction`).
- Clean up before continuing: `rm -f /tmp/cc-hook-markers/* && git branch -D cc-hook-proof`

## 2. The git controls (checkout / create / pull / push)

In the app, open the project page and use the git controls:

1. **Create** a branch (any name, e.g. `cc-hook-test`).
2. **Checkout** back to your main branch.
3. **Pull** (if the project has a remote).
4. **Push** (if you have somewhere safe to push — skip if not).

Then:

```sh
ls /tmp/cc-hook-markers/
```

- **Expected:** empty. Not one marker.
- **Before the fix:** `post-checkout` after steps 1–2, `pre-push` after step 4.
- **And the commands must have actually worked** — check the branch really changed in the UI and
  on disk (`git -C "$P" branch --show-current`). "No hooks fired" is trivially satisfiable by a
  git command that failed, so a working result is half the assertion.

The same is reachable without the UI, which is worth doing because it's the path an injected
agent would use (the route has no auth):

```sh
curl -s -X POST "http://localhost:7373/api/projects/<id>/git" \
  -H 'content-type: application/json' -d '{"action":"create","branch":"cc-hook-test2"}'
ls /tmp/cc-hook-markers/     # still empty
```

## 3. The parallel-worktree path (the automatic re-trigger)

This is the one that made a plant self-sustaining: `ensureTaskWorktree` runs `git worktree add`
on **every** parallel dispatch, and that command runs `post-checkout`.

1. Dispatch a task against `$P` and let it start (so the checkout is busy).
2. Dispatch a **second** task against the same project with **parallel / "run alongside"** turned
   on, so it gets its own worktree.
3. `ls /tmp/cc-hook-markers/`

- **Expected:** empty, and the second task starts normally in `data/worktrees/<taskId>`.
- **Before the fix:** `post-checkout` appeared on every such dispatch, forever, with the hook
  running as the runner process.

## 4. The read paths (project page, file viewer, diff modal)

1. Load the project page (renders the changes list).
2. Open a changed file's **diff**.
3. For a finished parallel task, open a file from its transcript (that read goes through
   `git show` against the branch).

- **Expected:** no markers, and all three render normally.

## 5. Machine-wide config can't quietly change the answer

The other half of the change is `GIT_CONFIG_NOSYSTEM=1`. The visible consequence isn't hooks
(a `-c` flag already outranks system config for the keys we pin) — it's that a system-level
ignore file can make the changes list **silently under-report**, which looks exactly like a clean
tree. You can only test this if you can write `/etc/gitconfig`, so it's optional:

```sh
sudo sh -c 'printf "[core]\n\texcludesFile = /tmp/cc-excludes\n" >> /etc/gitconfig'
printf '*.md\n' > /tmp/cc-excludes
cd "$P" && echo "unsaved work" > scratch-note.md
```

- Load the project page. **Expected:** `scratch-note.md` is listed as untracked.
- Without the fix it would be missing from the list entirely, with no error anywhere.
- Undo: remove those two lines from `/etc/gitconfig`, `rm /tmp/cc-excludes $P/scratch-note.md`.

## 6. Confirm the agent's own git is untouched

Hooks must still work for the agent, or `/swe:ship` and this repo's own default-branch guard stop
working.

- Dispatch a task against `$P` and ask it to run `git checkout -b hook-sanity` in its Bash tool.
- **Expected:** `/tmp/cc-hook-markers/post-checkout` **does** appear. The neutralization is about
  what the *server* executes on your behalf, not about crippling git for the agent.

## Cleanup

```sh
cd "$P"
rm -f .git/hooks/post-checkout .git/hooks/pre-push .git/hooks/post-merge \
      .git/hooks/post-index-change .git/hooks/reference-transaction
git branch -D cc-hook-test cc-hook-test2 hook-sanity 2>/dev/null
rm -rf /tmp/cc-hook-markers
```

## Known limits — what this scenario does *not* show

- **The git route still has no auth.** Step 2's `curl` needed no credentials, and neither does
  `POST /api/tasks`. An injected agent can still *trigger* a checkout or pull on any project; what
  it can no longer do is have that trigger run a program it planted. Adding auth collides with the
  deliberately cookie-less local-workspace mode and is a separate design question — the same one
  the unauthenticated backlog routes raise.
- **Two RCEs in the same class are still live on Pull/Push**, found by the security audit of this
  very change and deliberately not fixed here. A repo-level `credential.helper` runs a shell
  command as soon as a remote answers 401 (any real push), and `core.sshCommand` runs for an
  `ssh://` remote — which an attacker can create with `git remote set-url`. Both inherit the
  server's environment, so `SECRETS_MASTER_KEY` and `GH_TOKEN` are exposed. If you want to see it:

  ```sh
  cd "$P"
  git config credential.helper '!f() { touch /tmp/cc-cred-fired; echo username=x; echo password=y; }; f'
  # then click Push in the UI against a remote that requires auth
  ls /tmp/cc-cred-fired      # exists → the planted command ran
  git config --unset credential.helper
  ```

  The one-line pins were measured and are worse than the hole (`-c credential.helper=` also clears
  the gh helper and breaks Push for everyone). See `.swe/notes.md`. Note the dev container happens
  to be immune to the *generic* form — its gh wiring resets the helper list as a side effect — so
  test this on a native install if you want the honest result.
- **`filter.<driver>.clean` remains arbitrary command execution** on `git diff --numstat HEAD`
  (i.e. on every project page render). It is bound by `.git/info/attributes`, which is untracked
  and unaffected by `--attr-source`, and the driver name is attacker-chosen so there is no key to
  `-c` away. Documented in `.swe/notes.md` and CLAUDE.md; unchanged by this task, and only bounded
  by the 30s subprocess timeout.
- **A `.git` *file* still redirects the whole repo** (`isGit` can't tell a directory from a
  `gitdir:` pointer). Also pre-existing and documented.
