# Test scenario: the changes list reads paths git quotes

_Task: picked up the backlog item "gitChanges' line counts still read the working tree". The
reported line-count leak is a documented **won't-fix**; what ships is the parsing fix found while
investigating it — `gitChanges` now reads `-z` output, so a filename git would quote is no longer
mangled · 2026-08-18_

## Setup / preconditions
- No Anthropic token needed — nothing here dispatches a task. Everything is the project page and
  two read routes.
- A **plain git project** registered (not a workspace) whose working tree you can write to. This
  repo works; any checkout does.
- Start the app: `pnpm app` (or `pnpm dev` for foreground logs).
- Get the project's id once, for the curl steps:
  `curl -s localhost:7373/api/projects | python3 -m json.tool | grep -B2 '<your path>'`

## Happy path — a non-ASCII filename
1. In the project's working tree, create a file with a non-ASCII name and three lines:
   ```sh
   printf 'alpha\nbeta\ngamma\n' > '検証.md'
   ```
   Use a **CJK** name rather than an accented one if you are on macOS: `ü` has two spellings
   (NFC/NFD) and macOS stores the decomposed one, which makes an accented name a bad test of
   anything but Unicode normalisation.
2. Open the project page and find the **uncommitted changes** list.
   - **Expected:** a row reading `untracked  検証.md  +3  −0`.
   - **Before this change** it read `"\346\244\234\350\250\274.md"` — git's octal quoting shown
     literally — with `+0`.
3. Click that row.
   - **Expected:** the diff modal opens with `new file mode 100644` and `+alpha / +beta / +gamma`.
   - **Before this change** the modal opened **empty**: the file was listed as changed and its
     diff was blank, because the quoted spelling matched nothing on disk.
4. `git add '検証.md' && git commit -m 'add it'`, then edit it (`printf 'delta\n' >> '検証.md'`)
   and reload the project page.
   - **Expected:** the row now reads `modified  検証.md  +1  −0`, and the diff shows `+delta`.
   - **Before this change** the `+1` was already correct here — a *tracked* non-ASCII file kept its
     counts, because git quoted the name on both sides of the lookup and they matched. It was the
     **path** that was broken (escaped, and undiffable). The `+0` in step 2 is specific to
     *untracked* files, whose line count came from a read using the quoted name.
5. Clean up: `git reset --hard HEAD~1` (or `rm '検証.md'` if you never committed it).

## Happy path — a renamed file
1. In a project with a committed file, rename it and edit it in the same breath:
   ```sh
   git mv notes.md notes-renamed.md && printf 'one more line\n' >> notes-renamed.md
   ```
2. Reload the project page.
   - **Expected:** **one** row, `renamed  notes-renamed.md  +1  −0`. The line counts are real.
   - **Before this change** the row showed `+0 −0` (git writes a rename as `old => new` in
     `--numstat`, which matched no status path — and `diff.renames` is on by default, so this was
     the ordinary case for any moved file, not an exotic one).
   - There must be **no** second row for the old name `notes.md`.
3. Clean up: `git mv notes-renamed.md notes.md && git checkout notes.md`.

## Edge cases
1. **A name containing a double quote or a tab** (skip on Windows filesystems):
   ```sh
   printf 'x\n' > 'quo"te.md'; git add -A; git commit -m q
   printf 'y\n' >> 'quo"te.md'
   ```
   - **Expected:** the row shows `modified  quo"te.md  +1  −0`. Previously `+0 −0`: *both* commands
     quoted the name, but the old code unquoted only the status side (and `JSON.parse` succeeds on
     `\"` and `\t`), so the counts lookup missed.
   - Note the two names differ in what you get from *clicking*: `quo"te.md` opens its diff, a
     tab-named file does not — a tab is a control character, so the routes refuse it per case 4
     below. Both get correct counts either way, which is what this fix is about.
2. **A name containing ` -> `** — `printf 'x\n' > 'arrow -> name.md'`.
   - **Expected:** it appears as the single untracked file `arrow -> name.md`, not misread as a
     rename of `arrow` to `name.md`.
3. **`core.quotePath` no longer matters.** With the non-ASCII file in the tree, run
   `git config core.quotePath false`, reload, then `git config core.quotePath true` and reload.
   - **Expected:** identical rows both times. The old parse behaved differently under the two
     settings, which is repo config an agent with Bash can flip.
4. **A name with a control character** — `printf 'x\n' > "$(printf 'ctrl\ttab-and-\001.md')"`.
   - **Expected:** the file is **listed** (honestly — it is a changed file), but clicking it does
     not open a diff: the file/diff routes refuse control characters in a path
     (`isUsableRelPath`, HTTP 400). Listing it and failing to diff it is the intended behaviour;
     silently hiding a changed file is not.
5. **The list still bounds itself.** In a scratch repo, create 250 untracked files and load the
   page. **Expected:** 200 rows plus "…and 50 more" — unchanged by this task.

## Repo config can no longer change what git does (added after the security review)
These two were found by the security audit as unverified hypotheses and both reproduced immediately.
`.git/config` is untracked, shared across every linked worktree, and an ordinary write for a task's
Bash tool — so run these in a **scratch** repo, not a real one.

1. **`core.fsmonitor` must not execute.** In a scratch repo with one modified tracked file:
   ```sh
   printf '#!/bin/sh\ntouch /tmp/FSMONITOR_RAN\nexit 1\n' > hook.sh && chmod +x hook.sh
   git config core.fsmonitor "$PWD/hook.sh"
   ```
   Register that repo as a project and load its page (and open a file's diff).
   - **Expected:** `/tmp/FSMONITOR_RAN` is **never created**, and the changes list and diff are
     completely normal. Before the fix that script ran — inside the web server process — for
     whoever loaded the page, which could be a different user.
2. **`core.worktree` must not redirect the walk.** In a scratch repo beside a directory holding a
   couple of files:
   ```sh
   git config core.worktree /tmp/some-other-directory
   ```
   - **Expected:** the changes list shows only this repo's real changes. Before the fix it listed
     the *other* directory's filenames as untracked files of this project — an arbitrary directory
     listing, with no race and nothing planted in the tree. (No file *contents* leaked either way.)
   - Also confirm a project that is a **linked worktree** (a parallel task's `data/worktrees/<id>`)
     still shows its own changes correctly — that is the case the `--work-tree` pin had to not break.
3. **`status.renames` must not change the numbers.** With a renamed-and-edited file present, run
   `git config status.renames false`, reload, then `git config --unset status.renames` and reload.
   - **Expected:** identical rows and identical `+/−` totals both times.

## The residual this task deliberately did NOT fix
`gitChanges` gets its tracked line counts from a whole-tree `git diff --numstat HEAD`, and that
command reads the working tree. So a tracked path replaced by a **hard link** to a file outside the
project still reports that outside file's line count. To see it:

```sh
cd "$(mktemp -d)" && mkdir repo outside && cd repo
git init -q -b main && git config user.email t@t && git config user.name t
python3 -c "open('../outside/id_rsa','w').write('SECRET\n'*137)"
printf 'one\n' > tracked.md && git add -A && git commit -qm init
rm tracked.md && ln ../outside/id_rsa tracked.md
git diff --numstat HEAD          # -> 137  1  tracked.md
```

- **Expected, and accepted:** registering that repo and loading its project page shows
  `modified  tracked.md  +137  −1`… i.e. the outside file's line count. **No file content ever
  appears** — the row is a path, a status word and two integers, which is the bound the decision
  rests on and is pinned by `lib/git.test.ts` ("the change summary reports counts, never file
  content").
- Why it is not fixed, and why the obvious fix is not one, is in CLAUDE.md's "Reading files out of
  a project tree" section and the 2026-08-18 entry in `.swe/notes.md`. Short version: containing it
  means producing every changed file's diff ourselves, and post-filtering with `escapesOnDisk` does
  nothing because that helper answers "safe" for a path with nothing on disk — so the plant is just
  deleted after `numstat` has read it.

## Automated coverage
`docker exec platform env -u RUNNER_HOST npx tsx --test lib/git.test.ts` — 35 specs. The two added
here are:
- `gitChanges reads paths git quotes: non-ASCII, quotes, tabs, renames` — verified to **fail**
  before the change (`日本語.md is missing from the changes list`).
- `the change summary reports counts, never file content` — pins the residual's bound, and
  characterises the `+137 −1` leak so that closing it later shows up as a failing test rather than
  a stale note.

Full suite: `docker exec platform env -u RUNNER_HOST pnpm test` — 378 passing (370 before).

## The `--work-tree` pin must never touch a subdirectory (added after round-two review)
This is the regression round-two review caught, and it is destructive rather than a leak — worth
running by hand once in a **scratch** repo.

1. Make a repo with a subfolder tracked on two branches:
   ```sh
   cd "$(mktemp -d)" && git init -q -b main && git config user.email t@t && git config user.name t
   mkdir sub && printf 'root main\n' > root.md && printf 'sub v1\n' > sub/f.md
   git add -A && git commit -qm init
   git checkout -q -b feature
   printf 'root FEATURE\n' > root.md && printf 'sub v2\n' > sub/f.md
   git add -A && git commit -qm feat && git checkout -q main
   ```
2. Register it as a **workspace** project whose `.swe/workspace.json` declares `sub` as a member
   (a member that is just a folder of the parent repo — an ordinary monorepo layout, no attacker).
3. Use the member's source-control controls to switch it to `feature`.
   - **Expected:** `root.md` becomes `root FEATURE`, `sub/f.md` becomes `sub v2`, and the working
     tree is clean afterwards.
   - **The bug this guards:** with `--work-tree` sent unconditionally, git reported success
     (`Switched to branch 'feature'`) while leaving both real files stale and writing phantom
     `sub/root.md` and `sub/sub/f.md`. `git status` then showed every real file modified plus two
     untracked phantoms.
4. Also confirm the protected case still works: in a **normal** project (`.git` at its root), plant
   `git config core.worktree /tmp/somewhere-else`, reload, and check the changes list still shows
   only that project's real changes.

## Known-unfixed, documented in CLAUDE.md — do NOT treat these as passing
Two pre-existing critical holes were reproduced during this task and deliberately left:
- **`filter.<driver>.clean` runs a shell command on every project page render.** To see it (scratch
  repo only): `git config filter.evil.clean "sh -c 'touch /tmp/RAN; cat'"` and
  `echo '*.md filter=evil' > .gitattributes`, then load the project page — `/tmp/RAN` appears. The
  `timeout` added here only stops a *hanging* filter from wedging the server; it does not stop the
  execution.
- **A `.git` file redirects the whole repo.** `rm -rf .git && echo "gitdir: /path/to/other/.git" >
  .git` makes the changes list and diffs show the *other* repo's paths and committed content.
