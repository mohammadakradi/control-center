# Test scenario: a file diff is never built by letting git read the working tree

_Task: close the check-then-use gap on tracked-file diffs — `gitFileDiff` no longer lets git
open a path out of the project tree, so a hard link swapped in mid-request (or planted inside a
tracked directory) can't put outside content in a diff · 2026-08-17_

## Setup / preconditions
- The app running (`pnpm app`, or `pnpm dev` for foreground logs).
- A **git project registered** in the app that you're willing to litter with throwaway files —
  a scratch clone is ideal. Its path is `$P` below, its id `<id>` (from the project page URL).
- A stand-in secret **outside** that project. Don't use a real key:

  ```sh
  mkdir -p /tmp/cc-secret && printf 'PRIVATE-KEY-BODY\nsecond-line\n' > /tmp/cc-secret/id_rsa
  ```
- The hard links below need the secret and the project on the **same filesystem**. If
  `/tmp` isn't, put `cc-secret` somewhere that is (e.g. `$P/../cc-secret`).

## The raceless one — a hard link inside a tracked directory
This is the sharper of the two: no timing involved, it worked on the first try before the fix.

```sh
cd "$P"
D=$(git ls-files | head -1 | xargs dirname)      # any tracked directory, e.g. "lib"
F=$(git ls-files "$D" | head -1)                 # a tracked file inside it
cp "$F" /tmp/cc-restore                          # keep the original
rm "$F" && ln /tmp/cc-secret/id_rsa "$F"         # the plant
```

1. Ask for the diff of the **directory**, not the file:
   ```sh
   curl -s "http://localhost:7373/api/projects/<id>/diff?path=$D"
   ```
   - **Expected:** `{"path":"...","diff":""}` — empty, and no `PRIVATE-KEY-BODY` anywhere.
   - Before the fix this returned the planted file's contents. `escapesOnDisk` allows a
     contained *directory* (it must — a submodule is one, and refusing them silently broke
     every submodule diff), and `git diff HEAD -- <dir>` then walked the directory and diffed
     a file the caller never named.
2. Ask for the file directly: `curl -s "http://localhost:7373/api/projects/<id>/diff?path=$F"`
   - **Expected:** also empty. A hard link is refused on its link count.
3. Restore: `cp /tmp/cc-restore "$F"` (as a plain copy, not a link).

## The raced one — a tracked file swapped for a hard link mid-request
```sh
cd "$P"
F=$(git ls-files | head -1)
cp "$F" /tmp/cc-restore
# flip the file between an honest modification and a hard link to the secret
while :; do
  rm -f "$F"; ln /tmp/cc-secret/id_rsa "$F"
  rm -f "$F"; { cat /tmp/cc-restore; echo "a local edit"; } > "$F"
done &
FLIP=$!
```
4. Hammer the diff route for a few seconds and grep for the secret:
   ```sh
   for i in $(seq 1 300); do
     curl -s "http://localhost:7373/api/projects/<id>/diff?path=$F"
   done | grep -c 'PRIVATE-KEY-BODY'
   ```
   - **Expected:** `0`.
   - Measured against the previous implementation with the same shape: **3 leaks in 53
     attempts, 20 ms**. The window was an entire process spawn, so if this regresses it
     regresses loudly — you won't need 300 requests to see it.
   - Some responses will be empty diffs (the moments the file is a hard link) and some will
     show `+a local edit`. Both are correct; only the secret matters.
5. `kill $FLIP; cp /tmp/cc-restore "$F"`

## Nothing legitimate broke
This replaces how **every** diff in the app is produced, so this half matters as much as the
attack half. In the UI, open the project page and click through the changed-files list.

6. A **modified tracked file** — diff renders as before, `-`/`+` lines coloured, same hunks.
7. A **deleted** tracked file (`rm` a tracked file) — renders the `-` lines. Served from the
   object store; there is no file on disk to read.
8. An **untracked** new file — renders as `new file mode`, every line an addition.
9. A **staged but uncommitted** file (`git add` a new file) — same "new file" rendering.
10. A **binary** file (change any image, or `printf 'A\0B' > bin.dat && git add bin.dat`) —
    `Binary files a/… and b/… differ`, not a wall of bytes.
11. A **chmod-only** change (`chmod +x` a tracked file) — the file appears as modified in the
    list *and* opens a diff showing `old mode 100644` / `new mode 100755`. If it opens blank,
    the mode lines regressed.
12. A **submodule** whose pointer moved (if the project has one) — `Subproject commit <sha>`
    lines, exactly as before. Two variants are worth trying, because both broke earlier
    versions of the guard:
    - a submodule whose path has a **space or a non-ASCII character** (git formats those
      headers differently — a trailing tab, or the whole path C-quoted);
    - with `git -C "$P" config diff.submodule log` set, then `diff` (undo with
      `git config --unset diff.submodule`). The diff must render identically in all three
      cases; `log` used to blank it and `diff` used to show the submodule's file contents.
13. A file with **no trailing newline** — the diff ends with `\ No newline at end of file`.
14. A **large** diff — still truncated with `… (diff truncated)` at 200 KB.
15. Open a **task** transcript's file/diff links (including a finished parallel run whose
    worktree was cleaned up) — unchanged.

## Edge cases worth a look
16. An **unchanged** tracked file: `curl -s ".../diff?path=<any unmodified tracked file>"`
    - **Expected:** `{"diff":""}`. Before the fix this rendered the file as a brand-new file
      with its entire content — the old code read an empty `git diff` as "not tracked" and
      fell through to the untracked branch. Cosmetic, but it was wrong on every unchanged file.
17. A **committed symlink** (`git ls-files -s | grep ^120000`):
    - Unchanged, or retargeted → `{"diff":""}`. The empty answer for a retarget is deliberate,
      not a bug: reading a symlink's target means `readlink`, which follows the *directories*
      above the link, and that was demonstrably exploitable. Node can't hold a directory handle
      (`openat`/`O_PATH`), so there is no safe way to render it — see `symlinkDiff`.
    - Deleted (`rm thelink`) → a deletion diff showing the old target. This one is safe because
      it is built entirely from git's committed copy.
18. A **large** tracked file (>2 MB) with a one-line edit → the small hunk for that line, not
    an empty diff. Tracked reads are capped at 16 MB; only *untracked* files use the 2 MB cap,
    since their diff is the whole file.

## Cleanup
```sh
cd "$P" && git checkout -- . && git status   # confirm nothing planted is left
rm -rf /tmp/cc-secret /tmp/cc-restore
```

## Notes
- **The filed backlog item named the wrong attack shape.** It said a symlinked *ancestor
  directory* leaks on the tracked path; it doesn't — git reports such a path as
  `deleted file mode 100644` rather than following it, which is why an earlier audit attacked
  this at 66k attempts and found nothing. The shape that works is a **hard link**: no target to
  resolve, so it looks like an ordinary file to everything except its link count.
- Still defence in depth, not a perimeter. It takes write access inside a registered project
  tree, and these routes have no auth on the non-task path (the standing gap in CLAUDE.md).
  What's removed is a confused deputy — the server no longer reads outside a root because a
  path looked like it was inside one.
- Residual, deliberately unfixed: `gitChanges` still gets its line counts from a whole-tree
  `git diff --numstat HEAD`, so the same plant can misreport an outside file's **line count**
  (one integer, no content).
