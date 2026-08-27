# log git hardening

Dated log of the `lib/git.ts` / `lib/safe-read.ts` hardening work — what was reproduced, what was fixed, and what is a deliberate won't-fix.

Part 1 of 2.

<!-- Split out of a single 232 KB `.swe/notes.md` on 2026-08-24, which was read in full at the start of every request (engineering rule 10). Entries are verbatim and in date order; only this header is new. -->

## 2026-08-16 — contained reads for the file/diff routes (`lib/safe-read.ts`)
Picked up the backlog item above. The bug was real; the item's diagnosis was half of it.
- **Measured the escapes before writing anything, which changed the design.** Three work, and
  no single check catches all three: a symlink as the final component (O_NOFOLLOW refuses it),
  a symlinked *intermediate directory* — `link/` → `/secrets` asked for as `link/id_rsa`, which
  **O_NOFOLLOW happily opens**, since it only inspects the last component — and a hard link,
  which realpath structurally cannot see because there is no target to resolve. So: realpath
  containment *plus* `nlink === 1`. Had I taken the filed item's word for it, the shipped fix
  would have missed the middle case, which is the easiest of the three to plant.
- **The diff route was exposed too** (the item asked me to check). Narrower than it looks and
  worth recording so nobody "simplifies" the guard away: `git diff --no-index` renders a plain
  symlink as mode 120000 whose content is the *target's path* — harmless. Only the
  symlinked-directory form emits real content. An exploration subagent asserted the git paths
  were safe; running the command printed the secret. Trust the terminal over the summary.
- **`O_NONBLOCK` is load-bearing and I got it wrong first.** `open` on a FIFO blocks until a
  writer arrives — *before* `fstat` can classify it — so the "refuse non-regular files" check
  can never run. My own FIFO spec caught it by hanging the suite; `backlog.ts` sidesteps this
  by classifying the dirent before opening, which is why the flag isn't in `readSpecFile`.
- **Deliberately allows symlinks that stay inside the root**, unlike `readSpecFile`, which
  refuses links outright. `README.md` → `docs/README.md` is ordinary in a repo and this is a
  viewer; a `.pm/tasks/` spec becomes an autonomous run's instruction text. Different policies,
  both correct — not merged, and `readSpecFile` was left alone rather than churned.
- `escapesOnDisk` answers **false for a path with nothing on disk**: `git diff HEAD --
  deleted.md` is a legitimate diff git serves from the object store. Getting this wrong would
  have broken every deleted-file diff, which is why there's a spec for it.
- Two smaller things found on the way, both in `gitChanges`' untracked line-count read: it
  followed links (leaking a target's *line count*) and was **unbounded**, so a huge untracked
  file was a memory-exhaustion primitive. Now capped at 2 MB; refusals count 0, as unreadable
  files already did.
- Severity, honestly: defence in depth. It needs write access to a registered project tree, and
  these routes still have **no auth on the non-task path** — the real gap, unchanged here and
  bigger than one task. What's removed is a confused deputy.
- **Both reviews came back CHANGES_REQUIRED, and they were right.** The first cut checked
  containment on a *path* and then opened that path string — check-then-use. I had even written a
  comment calling the residual window "accepted knowingly", which was the wrong call dressed up as
  candour. Reproduced: ~2 leaks per 640k attempts via `readFileInside`, and **9–15ms / <100
  attempts / 3-of-3 trials** via `gitFileDiff`, where the window is a whole subprocess spawn. Two
  lessons worth keeping:
  - *Documenting a hole is not closing it.* If the threat model names the attacker and the
    primitive defeats them, "disclosed in a comment" is not a mitigation.
  - *A green test is not evidence until it can fail.* I disabled the inode check and my own race
    test still passed — the residual window is far too narrow for a 3-second sample. The test
    stayed (it guards against a regression that *widens* the window) but its docstring now says
    plainly that it does not prove the fix; the soundness argument does. I also verified the
    submodule spec fails with the fix removed, which it does.
- Fixes: inode identity (`dev`+`ino` at the re-resolved contained path must equal the handle's,
  which `nlink === 1` makes conclusive); the untracked diff **synthesized** from a contained read
  so no worktree path reaches a subprocess at all; `escapesOnDisk` allows contained directories;
  and "refused" collapsed into 404 to kill an existence oracle the split status codes had created.
- **A second audit round found something bigger than the race, in the same line of code.** A repo
  can define what "diff" *means*: `diff.<name>.textconv` names a shell command git runs to render
  a file, the command living in `.git/config` and the binding available from
  `.git/info/attributes` — neither tracked, so neither appears in `git status`, a review, or a
  clone, and both are plain writes inside a repo, which a task's Bash tool has. Reproduced in a
  throwaway repo: `git diff HEAD -- <path>` **executed** it. `--no-ext-diff --no-textconv` stops
  it with the diff unchanged; both flags now go on every `git diff` here, with a spec that fails
  without them. Worth noting *why* it was missed twice: the first two reviews and I were all
  looking at the path argument, and the vulnerability was in the *configuration* the subprocess
  inherits. "Is this path safe to pass" is a smaller question than "is this subprocess safe to
  run".
  - The other half is **not** fixed and is not in these files: `.git/config`, `.git/hooks/` and
    `.git/info/attributes` are shared across all linked worktrees, so a hook planted from inside
    one task's "isolated" worktree fires in the main checkout — and `ensureTaskWorktree`'s own
    `git worktree add` re-triggers it on every future dispatch. That contradicts
    `runner/worktree.ts`'s docstring, which promises isolation of index/HEAD/build dir — true for
    those, false for the state that matters here. Backlog `bli_e0d5be33` (pm).
- **The audit's one unreproduced hypothesis was right, and cheap to close.** It suggested the
  post-open check compared `dev`/`ino` but not `nlink`, and couldn't demonstrate it. It is real:
  swap the directory so the open lands on an outside file (link count 1 *then*), restore the
  directory, and hard-link that same outside file to the contained path — identity matches and
  the content is served. The comparison now lives in `isSameSoleFile`, a pure function, precisely
  so it has a **deterministic** test: the race test cannot cover it (removing only the identity
  clause leaves every timing test passing — verified independently by two reviewers).
- **Residual, deliberately not fixed:** the *tracked* branch `git diff HEAD -- <path>` still lets
  git read the worktree, so the same directory-swap race applies to it. The audit re-attacked it
  at 66k attempts with zero leaks and found it structurally weak anyway — git's tracked-diff path
  reports a symlinked intermediate directory as "file deleted" rather than following it. Closing it soundly means
  diffing content we read ourselves (HEAD blob via `git show` + a contained read) instead of
  letting git touch the tree — a real change to how diffs are produced, and out of scope here.
  It is much narrower than the `--no-index` window that got removed, and needs an attacker with
  live code execution in the tree, who can already read those files directly. Filed to the backlog.
  - **Not verified end-to-end with a live agent** — `user_local` has no token on this install
    (the usual 412), so isolation semantics are pinned by `runner/worktree.test.ts` (14 specs
    against real repos) + `lib/git.test.ts` + dispatch specs; manual steps in
    `.swe/test-scenarios/parallel-worktree-runs.md`.

## 2026-08-17 — a file diff no longer lets git read the working tree (`gitFileDiff`)
Picked up the backlog item left by the 2026-08-16 work (the "residual, deliberately not fixed"
bullet above). The hole was real, bigger than filed, and **the item named the wrong attack
shape** — the second time in two tasks that a filed diagnosis has been half right, so the habit
of reproducing before designing paid for itself again.
- **Measured first, and it inverted the severity.** The item (and my own note above) said the
  tracked branch was narrow, citing an audit that attacked it at 66k attempts with zero leaks.
  That audit was attacking a **symlinked ancestor directory**, which git structurally refuses on
  this path: `git diff HEAD -- link/file` reports `deleted file mode 100644` rather than
  following it. Verified. The shape that *does* work is a **hard link** — no target to resolve,
  so it is an ordinary regular file to every check except `nlink`, and git diffs whatever inode
  the name holds. Against the old code: **3 leaks in 53 attempts, 20 ms**. Not narrow at all;
  the same order as the `--no-index` window that was treated as urgent.
- **And there was a second leak with no race in it, found while validating the design.**
  `escapesOnDisk` allows a contained *directory* — it has to, or every submodule diff breaks —
  so asking for `docs` instead of `docs/a.md` made `git diff HEAD -- docs` walk the directory
  and diff a hard link planted inside it. No timing, no retries, worked first try. A per-file
  containment check is worth nothing if the caller can name the parent instead.
- **The fix is "git never reads the working tree for file content", not "check harder".** Both
  sides come from somewhere the caller's path can't reach at read time: `git show HEAD:<path>`
  for the before side, `readBytesInside` (handle-based, inode-verified) for the after side. git
  still *renders* the diff — on two files in a private `mkdtemp` — so hunks, binary detection
  and `\ No newline at end of file` stay byte-identical instead of being reimplemented.
  Reusing `--no-index` here is safe for the reason it wasn't before: the paths are ones we just
  created, not ones an agent can point somewhere else.
- **Classification comes from `git ls-tree HEAD`** (the object store, the one thing a tree
  writer can't restate), into blob / symlink / gitlink / tree / absent. Each non-blob case
  exists because of something measured, not for symmetry:
  - **tree → nothing.** This route serves one file; see the raceless leak above.
  - **gitlink → the real `git diff`, output checked positionally.** A submodule diff says only
    which commit it points at, so there is no content for git to read — but HEAD saying
    "gitlink" doesn't bind the *worktree* to still be one, and a regular file there makes git
    render a typechange carrying its content. Everything from the first `@@` on must be a
    `Subproject commit` line. **This took three attempts and the two failures are the useful
    part:** allowlisting header *prefixes* let content through, because git prefixes added
    lines with one `+` and a file whose lines start with `++ ` renders as `+++ …`, which the
    `+++ b/…` header pattern accepted (the security audit reproduced it end to end); then
    matching headers *exactly against the path* blanked ordinary submodules, because git
    appends a trailing **tab** to `--- a/<path>` for a path with a space and C-quotes a
    non-ASCII path. I found that second one by testing my own fix against real repos rather
    than trusting it — the reviewer had warned that a false negative here is the same class as
    the bug that once hid every submodule in every project.
  - **`--submodule=short` belongs next to `--no-ext-diff --no-textconv`, for the same reason.**
    Re-review found that `diff.submodule` — ordinary `.git/config`, untracked, shared across
    linked worktrees, writable by a task's Bash tool — rewrites the output: `log` emits
    `Submodule sub aaa..bbb:` with **no `@@` line at all** (so a real pointer change rendered
    blank under the positional check), and `diff` emits the **contents of files inside the
    submodule** with no planted file needed. "A repository can define what diff means" turned
    out to have a third instance in the same function.
  - **committed symlink → its target is never read.** Deleted renders a deletion (from HEAD's
    blob, so nothing leaves the tree); still-present renders nothing. **This took three
    attempts and is the most instructive part of the task:**
    1. A contained *content* read follows the link, so it diffs the target's content against
       HEAD's stored path text — a bogus full diff for an untouched link.
    2. So I returned nothing for every symlink. Review rightly called that a regression: it
       also swallowed the diff of a link that really had been retargeted or deleted.
    3. So I used `readlink`, which reads no file — and **that leaked**. It follows the
       *directories above* the link, so an ancestor pointing outside the tree returns an
       outside link's target. I caught a raced variant myself (184 hits in 2 076 attempts) and
       "fixed" it by validating the returned target lexically; the security re-audit then broke
       *that* with a **deterministic** PoC — `escapesOnDisk` answers "safe" for a path with
       nothing on disk (correct, that is the deleted-file case), so a *dangling* link behind a
       swapped ancestor sails through, and a plain relative target like `secret-name` resolves
       inside the root on paper while having been read from outside it.
    - **There is no sound version of this in Node.** Closing it needs the link's parent held as
      a descriptor (`openat`/`O_PATH`); Node exposes neither, so every route to a symlink's own
      target is a path an attacker can re-point. The final answer is therefore to *not do it* —
      shipping the narrow-but-open race would have repeated the exact mistake this task exists
      to correct, and the 2026-08-16 entry's own lesson ("documenting a hole is not closing
      it") applies to a hole I would have introduced myself.
    - Lesson worth keeping: **"reads no file" is not the same as "is contained".** `readlink`,
      `lstat` and `realpath` all traverse directories, and directories are the part an attacker
      swaps.
- **A third bug fell out of proving the tests could fail.** The old code read an empty
  `git diff` as "not tracked" and fell through to the untracked branch — so **any unchanged
  tracked file** rendered as a brand-new file containing its whole content. Cosmetic, never
  reported, and it had been there the whole time. It only surfaced because the temporarily
  restored old implementation failed a spec I'd written for the symlink case.
- **`--literal-pathspecs` on both git calls.** `path` is a name, not a pattern: without it a
  leading `:` is pathspec magic (`:/` = repo root, `:(exclude)…`) and `*` globs, so one request
  could name a set of files no containment check ever looked at.
- **The specs can fail, and I checked rather than assuming.** Restoring the old one-liner turns
  four of them red (both leaks, the submodule typechange, the unchanged-file case) and they go
  green again on the rewrite. This is the lesson from 2026-08-16 applied up front: the race test
  there could *not* fail with its fix removed, and said so in its docstring. This one can.
- `readFileInside` is now a UTF-8 wrapper over `readBytesInside`. The undecoded read matters:
  two files differing only in bytes that don't map to UTF-8 both decode to the same replacement
  character, so a string-based diff would report an edited file as unchanged. There's a spec.
- **Almost everything that went wrong in this task was a silent blank diff, and that is the
  pattern to carry forward.** When the safe path can't render something, "return nothing" is
  the tempting answer, and it is usually wrong: `gitChanges` still lists the file as modified,
  so the user clicks a real change and is told there isn't one. Instances, all caught by review
  or by re-testing my own fixes: capping the *tracked* read at the untracked 2 MB (no diff for
  a one-line edit in a large file — hence the separate `TRACKED_READ_CAP`); refusing every
  committed symlink; exact-matching submodule headers against the path; and `diff.submodule=log`
  dropping the `@@` line. Each fix has a spec that fails without it — verified by reverting each
  one, not assumed.
- **Two rounds of review, and the second round mattered more than the first.** Round one found
  two blank-diff regressions; round two found that *my fixes for those* had introduced a real
  leak and two more blank-diff cases. A fix written under review pressure deserves the same
  adversarial treatment as the original code — re-running the suite is not that treatment.
- **Residuals, deliberately not fixed and reported at the gate:** `gitChanges` still takes its
  line counts from a whole-tree `git diff --numstat HEAD`, so the same plant can misreport an
  outside file's **line count** (one integer, no content) — fixing it means synthesizing the
  entire change summary. Clean filters / CRLF (`text=auto`, git-LFS) are not applied to the
  after side, so those repos get noisier diffs: running a repo-defined filter is exactly the
  command execution `--no-textconv` exists to prevent.
