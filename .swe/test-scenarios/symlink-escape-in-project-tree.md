# Test scenario: file/diff routes refuse reads that escape the project tree

_Task: a symlink or hard link planted in a project tree (or in a task's agent-written
worktree) can no longer be used to make the server read a file outside it · 2026-08-16_

## Setup / preconditions
- The app running (`pnpm app`, or `pnpm dev` for foreground logs).
- A **git project registered** in the app that you're willing to litter with a few throwaway
  files — a scratch clone is ideal. Its path is referred to below as `$P`.
- A file outside that project standing in for a secret. **Do not use your real
  `~/.ssh/id_rsa`** — there's no reason to move a real key around to test this:

  ```sh
  mkdir -p /tmp/cc-secret && printf 'PRIVATE-KEY-BODY\nsecond-line\n' > /tmp/cc-secret/id_rsa
  ```

## Plant the three escapes
Run in `$P` (all three are what an agent with Bash could create in a worktree):

```sh
cd "$P"
ln -s /tmp/cc-secret/id_rsa leak-file.md   # symlink, final component
ln -s /tmp/cc-secret        leak-dir       # symlink to a directory
ln    /tmp/cc-secret/id_rsa leak-hard.md   # hard link (same filesystem only)
ln -s "$P/README.md"        inside-link.md # legitimate: stays inside the repo
```

## Happy path — the escapes are refused
Substitute your project's id for `<id>` (visible in the URL of the project page).

1. `curl -s -w ' [%{http_code}]\n' 'http://localhost:7373/api/projects/<id>/file?path=leak-file.md'`
   - **Expected:** `{"error":"file not found"}`, HTTP **404**. **Not** the file's contents.
   - The 404 is deliberate: a refused path and a missing one must be indistinguishable. A
     distinct "invalid path" code turned a single planted symlink into an existence oracle
     for any absolute path on the host — point it somewhere, read the status code, learn
     whether that path exists. Same reasoning as `lib/task-access`'s "not yours ≡ doesn't
     exist".
2. `curl -s 'http://localhost:7373/api/projects/<id>/file?path=leak-dir/id_rsa'`
   - **Expected:** same 404. This is the one an `O_NOFOLLOW`-only fix would have missed —
     the symlink is an *intermediate directory*, not the final component.
3. `curl -s 'http://localhost:7373/api/projects/<id>/file?path=leak-hard.md'`
   - **Expected:** same 404. A hard link resolves to a path inside the repo, so only the
     link count gives it away.
4. `curl -s 'http://localhost:7373/api/projects/<id>/diff?path=leak-dir/id_rsa'`
   - **Expected:** `{"path":"leak-dir/id_rsa","diff":""}` — an empty diff, no content.
   - Sanity check the same request before the fix leaked it:
     `git -C "$P" diff --no-index /dev/null leak-dir/id_rsa` still prints `PRIVATE-KEY-BODY`
     directly. That's git behaving normally; the point is the *route* no longer asks it to.
5. In the UI, open the project page and look at the changed-files list.
   - **Expected:** `leak-file.md` and `leak-hard.md` appear (they are untracked files, and
     hiding them would be its own lie) but show **0 added lines** — the line count is no
     longer taken by following the link. `PRIVATE-KEY-BODY` appears nowhere in the page.

## Nothing legitimate broke
6. `curl -s 'http://localhost:7373/api/projects/<id>/file?path=README.md'`
   - **Expected:** the file's real contents.
7. `curl -s 'http://localhost:7373/api/projects/<id>/file?path=inside-link.md'`
   - **Expected:** the contents of `README.md`. A symlink that stays inside the repo is
     deliberately still followed — repos contain those legitimately.
8. Edit a tracked file in `$P`, then click it in the project's changed-files list.
   - **Expected:** its diff renders exactly as before.
9. `git -C "$P" rm --cached` (or just delete) a tracked file, then click it in the list.
   - **Expected:** the deletion diff renders (`-` lines). This is the case that would break
     if the guard treated "nothing on disk" as an escape — git serves it from the object
     store.
10. Open a task's transcript that links a file (e.g. a report linking a test scenario) and
    click it.
    - **Expected:** opens as before, for a normal run and for a finished parallel run whose
      worktree was cleaned up.

## Edge cases
11. A named pipe — this one hangs the request if the fix regresses.

    > ⚠️ **Do not run this step against a project under `/Users` or `/Volumes` while the dev
    > container is up.** Those are bind-mounted, and creating a FIFO under a bind mount has
    > wedged OrbStack's file-sharing layer on this machine before — taking every container
    > down with it (see `.swe/notes.md`, 2026-08-11). Skip it in the dev container, or run it
    > against a project on a path that isn't mounted. The automated spec covers this case
    > safely, in the container's own `/tmp`:
    > `docker exec platform env -u RUNNER_HOST node_modules/.bin/tsx --test lib/safe-read.test.ts`

    ```sh
    mkfifo "$P/pipe"
    curl -s --max-time 10 'http://localhost:7373/api/projects/<id>/file?path=pipe'
    ```
    - **Expected:** returns **immediately** with `{"error":"file not found"}`. If curl sits
      until the 10s timeout, `O_NONBLOCK` has been dropped from the open in
      `lib/safe-read.ts` — a plain `O_RDONLY` open on a FIFO blocks until a writer arrives,
      before `fstat` ever gets to classify it.
    - Also reload the **project page** with the FIFO present: the changed-files list must
      still render (that read is on the same path).
12. Traversal spellings. These answer **400** — unlike the cases above, they are refused on
    the spelling alone, before anything is looked up, so they reveal nothing about the disk:
    ```sh
    for p in '../../etc/hosts' 'a/../../etc/hosts' '/etc/hosts'; do
      curl -s "http://localhost:7373/api/projects/<id>/file?path=$p"; echo
    done
    ```
13. A file that simply isn't there, and a directory:
    ```sh
    for p in nope.md lib; do
      curl -s -o /dev/null -w "$p -> %{http_code}\n" "http://localhost:7373/api/projects/<id>/file?path=$p"
    done
    ```
    - **Expected:** both `404` — the same answer the escapes give, which is the point.

## Cleanup
```sh
cd "$P" && rm -f leak-file.md leak-dir leak-hard.md inside-link.md pipe
rm -rf /tmp/cc-secret
```

## Notes
- This is defence in depth, not a perimeter: it takes write access to a registered project
  tree to exploit, and these routes still have no auth on the non-task path (a known gap,
  documented in CLAUDE.md under the backlog). What changed is that the server no longer
  reads *outside* a root on behalf of a path that merely looks like it's inside.
- The equivalent defence for `.pm/tasks/` specs (`readSpecFile` in `lib/backlog.ts`) is
  deliberately stricter — it refuses links of any kind, because a spec becomes the
  instruction text of an autonomous run. The two were not merged.
