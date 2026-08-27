# file reads and git

Reading a file a project tree *claims* to contain (`lib/safe-read.ts`), and every hardening decision in `lib/git.ts` — including the two CRITICAL holes reproduced and knowingly left open.

<!-- Moved out of CLAUDE.md on 2026-08-24 to bring it inside its 20 KB budget (engineering rule 7). Content is verbatim; only the heading level and this header are new. -->

## Reading files out of a project tree
`GET /api/projects/[id]/{file,diff}` take a caller-supplied relative path and read it under a
root the user registered — `project.path`, a workspace member, or a task's git worktree, which
for a parallel run is **written by an agent with Bash**. Their old guard (reject a leading `/`
or a `..` segment, then `resolve()`) is purely lexical, so it proved nothing about what the
path lands on. `lib/safe-read.ts` is the containment check; the routes keep the lexical gate
only as a cheap pre-filter.
- **Three escapes exist and no single check catches all three.** Measured, not assumed:

  | planted in the tree | `O_NOFOLLOW` | realpath containment |
  |---|---|---|
  | `docs.md` → `/etc/passwd` | refuses | refuses |
  | `link/` → `/secrets`, read as `link/id_rsa` | **opens it** | refuses |
  | `docs.md` hard-linked to a file outside | opens (only `nlink` sees it) | **contained** |

  `O_NOFOLLOW` only refuses a symlink as the *final* component, so a symlinked intermediate
  directory walks through it; a hard link has no target to resolve, so realpath reports it as
  living exactly where it appears. Hence both, plus `nlink === 1`.
- **A symlink that stays inside the root is allowed**, unlike `readSpecFile` in `lib/backlog.ts`,
  which refuses links outright. `README.md → docs/README.md` is ordinary in a repo and this is a
  file viewer; a `.pm/tasks/` spec becomes the instruction text of an autonomous run, so the
  stricter rule is right where it is. Escaping the root is what both refuse. The two are
  deliberately **not** merged.
- **Containment is decided on the inode, not by resolving the path twice.** `realpath` then
  `open` is check-then-use, and `O_NOFOLLOW` only guards the *last* component — so swapping a
  **directory** along the path for a symlink mid-flight gets followed. Both reviews reproduced
  that with a shell loop. After opening, `readFileInside` therefore re-resolves and requires the
  file at that contained path to be the very inode the handle holds (`dev` + `ino`); with
  `nlink === 1` that is airtight, since the open file then has exactly one name and that name was
  just seen inside the root. Re-checking the *path* alone is not enough — an attacker can put the
  directory back and pass a second path check.
- **`O_NONBLOCK` on the open is load-bearing, not tidiness.** `open` on a FIFO blocks until a
  writer arrives, and that happens *before* `fstat` can classify it — so a named pipe left in a
  tree hangs the request forever and no check afterwards helps. Found by the FIFO spec hanging
  the suite. Regular files ignore the flag.
- **No worktree path is handed to a subprocess any more.** A Node-side check followed by
  `execFileSync` is check-then-use with a whole *process spawn* in the window — the audit leaked
  a planted secret through `git diff --no-index` in 9–15ms, under 100 attempts, 3 times out of 3.
  So an untracked file's diff is now **synthesized** in `untrackedDiff` (`lib/git.ts`) from a
  contained read: same shape git produced (`--- /dev/null`, `@@ -0,0 +1,N @@`, `+` lines, binary
  and no-trailing-newline cases included), close enough for `components/DiffModal.tsx`, which
  colours by prefix. Keep it that way — reintroducing `--no-index` on a worktree path reopens the
  race that the remaining `escapesOnDisk` pre-check cannot close.
- **git is not allowed to read the working tree for a file's content at all** (2026-08-17), and
  that — not `escapesOnDisk` — is what makes `gitFileDiff` safe. The tracked branch used to run
  `git diff HEAD -- <path>` after the check, and git resolves the path *again*, on its own: a
  tracked file swapped for a **hard link** to an outside file mid-request leaked it at **3 hits
  in 53 attempts, 20 ms**. Now `git ls-tree HEAD` classifies the path from the object store, the
  before side comes from `git show HEAD:<path>` and the after side from `readBytesInside`; git
  renders the diff from those two, written into a private `mkdtemp` (which is why `--no-index`
  is safe *there* and not on a worktree path). Keep any new diff work on that side of the line.
  - **The filed item blamed the wrong shape, and so did the note it came from.** A symlinked
    *ancestor directory* does **not** leak on the tracked path — git answers `deleted file mode
    100644` instead of following it, which is why an audit at 66k attempts found nothing and
    called the window narrow. A hard link has no target to resolve, so only `nlink` sees it.
  - **A tracked *directory* path leaked with no race at all.** `escapesOnDisk` allows a contained
    directory (below), so `git diff HEAD -- docs` walked it and diffed a hard link planted at
    `docs/a.md` — a file the caller never named and no check ever looked at. A `tree` entry now
    returns nothing: this route serves one file.
  - **`--submodule=short` is as load-bearing as `--no-ext-diff --no-textconv`.** `diff.submodule`
    is ordinary `.git/config` — untracked, shared across linked worktrees, writable by a task's
    Bash tool — and it changes the output wholesale: `log` drops the `@@` line entirely (so a
    real pointer change rendered blank), `diff` prints the *contents of files inside the
    submodule*. Pinning the format means neither depends on how a repo is configured.
  - **A submodule keeps the real `git diff`, with its output checked positionally.** HEAD saying
    "gitlink" doesn't bind the worktree to still be one, and a regular file there makes git
    render a typechange carrying that file's content. `isSubmoduleDiff` requires every line from
    the first `@@` onward to be a `Subproject commit` line; a typechange puts a second
    `diff --git` block there, so it fails whatever the planted file holds. Both earlier attempts
    were wrong and each failed a different way, so don't "simplify" this back:
    - matching header *prefixes* let content through — git prefixes added lines with one `+`,
      so a file whose lines start with `++ ` renders as `+++ …` and passes as the `+++ b/…`
      header (found by the security audit, reproduced end to end);
    - matching header lines *exactly against the path* blanked real submodules — git appends a
      trailing **tab** to `--- a/<path>` when the path has a space, and C-quotes the path when
      it isn't ASCII. Specs cover `my sub` and `üni sub`.
  - **A committed symlink's target is never read.** A *deleted* one still renders its deletion
    (built purely from HEAD's committed blob, so nothing comes out of the tree); one that is
    still there renders nothing. Both alternatives were tried and both leak or lie:
    - a contained *content* read follows the link, so it diffs the target's content against
      HEAD's stored path text — a large bogus diff for a link nobody touched;
    - **`readlink` follows the directories above the link**, so pointing an ancestor outside
      the tree returns an outside link's target. The security re-audit proved this, including
      a variant with **no race at all**: `escapesOnDisk` answers "safe" for a path with nothing
      on disk (deliberately — that is how a deleted file's diff works), which is exactly a
      *dangling* link behind a swapped ancestor. Validating the returned target lexically does
      not save it: a plain relative target resolves inside the root on paper while having been
      read from outside it.
    There is no sound version in Node — it needs the parent held as a descriptor
    (`openat`/`O_PATH`), which Node doesn't expose. The cost is that a *retargeted* committed
    symlink shows no diff; the file list still reports it as modified.
  - Fixed on the way: the old code read an empty `git diff` as "not tracked" and fell through to
    `untrackedDiff`, so **every unchanged tracked file** rendered as a brand-new file containing
    its whole content.
  - Both git calls carry **`--literal-pathspecs`**: the path is a name, not a pattern, and
    without it a leading `:` is pathspec magic (`:/`, `:(exclude)…`) and `*` globs.
  - **A tracked diff's read cap is 16 MB, not the untracked 2 MB**, and the difference is
    load-bearing: an untracked file's diff *is* its whole content, but a one-line edit inside a
    4 MB tracked file is a five-line hunk. Reusing the small cap returned no diff at all for it
    (caught in review). The cap bounds memory, not what is worth showing.
- **`escapesOnDisk` allows a contained *directory*.** It's the containment question, not "is this
  a plain file". Refusing every non-regular path silently returned an empty diff for **every git
  submodule in every project** — `git diff HEAD -- <submodule>` is an ordinary "Subproject commit"
  diff. Caught in review; there's a spec for it now. A path with **nothing on disk answers false**
  too: `git diff HEAD -- deleted.md` is served from the object store, so there is no filesystem
  read to escape through. It is now a **pre-filter, not the containment guarantee** — every
  branch of `gitFileDiff` is sound without it.
- **The diff route's exposure was narrower than it looks, which is why it had to be tested.**
  `git diff --no-index` renders a plain symlink as mode 120000 whose content is the *target's
  path* — harmless. Only the symlinked-directory form leaked real content.
- **`readFileInside` is a UTF-8 wrapper over `readBytesInside`.** The diff path needs the bytes
  undecoded: two files differing only in bytes that don't map to UTF-8 decode to the same
  replacement character, so a string-based diff reports an edited file as unchanged. `mode` comes
  off the open handle (`fstat`), not a second `stat` of the path, which is what lets a
  mode-only change (`chmod +x`) still render its `old mode`/`new mode` lines.
- **Every `git diff` here carries `--no-ext-diff --no-textconv`.** A repository can define what
  "diff" *means*: `diff.<name>.textconv` / `.command` name a shell command git runs to render a
  file, with the command in `.git/config` and the binding available from `.git/info/attributes`
  — neither tracked, so neither shows in `git status`, a review, or a clone, and both are
  ordinary writes inside a repo, which a task's Bash tool has. Verified: without the flags a
  planted driver **executes** on `git diff HEAD -- <path>`; with them it doesn't and the diff is
  unchanged. There's a spec for it. The shared-`.git` half (backlog `bli_e0d5be33`) is now
  **partly** closed: hooks and config are still shared across all linked worktrees, but as of
  2026-08-19 no *platform-issued* git command executes them — see the `NO_HOOKS` entry below.
  Still open from that item: `filter.<driver>.clean`, which has no `-c` key to pin.
- **A refused path and a missing one answer identically** (404), like `lib/task-access`'s "not
  yours ≡ doesn't exist". A separate "invalid path" status turned one planted symlink into an
  existence oracle for arbitrary absolute paths on the host — no race, no auth, repeatable. Only
  a *lexically* bad path (leading `/`, a `..` segment, control chars) still answers 400, since
  that is decided before anything is looked up and reveals nothing.
- **`gitChanges` reads untracked files just to count lines**, and `git status` lists an untracked
  symlink like any other entry — so that read leaked a target's line count, and would have hung
  on a FIFO. It now goes through the same helper, capped (it was unbounded, so a huge untracked
  file was a memory-exhaustion primitive); anything refused counts 0, as unreadable files already did.
  Its *tracked* counts still come from a whole-tree `git diff --numstat HEAD`, which does read the
  worktree — the same plant can misreport an outside file's **line count**.
  - **Re-examined 2026-08-18 and deliberately closed as won't-fix**, with the leak reproduced
    (a tracked path hard-linked to a 137-line outside file reports `+137 −1`). Two shortcuts were
    measured and rejected, and both are worth knowing before reopening this:
    - *Post-filtering the numstat map with `escapesOnDisk`* is not a fix. That helper answers
      "safe" for a path with nothing on disk — deliberately, since that is how a deleted file's
      diff is served — so the plant is simply removed after numstat has read it and the check
      passes. No timing skill needed; it would be a disclaimer, not a boundary.
    - *Synthesizing the summary* is the sound direction, and the review improved the cost estimate
      worth recording: it is **not** a subprocess per file. `git archive HEAD -- <changed paths>`
      into a private `mkdtemp` gives the whole "before" tree in **one** spawn, `readBytesInside`
      gives the "after" side with no spawn at all, and a single `git diff --no-index --numstat -z`
      over the two directories keeps git as the thing computing the numbers (so they can't disagree
      with git's) — two subprocesses total. What still makes it a real project rather than a patch:
      it materialises every changed file's bytes twice on disk, `--no-index` across two trees does
      not reproduce `diff.renames` so renames have to be re-paired from the status entries by hand,
      and added/deleted/one-sided paths each need their own case. Sounder, not cheap.
    Added/deleted are *diff* quantities rather than line counts, so any honest accounting of the
    working tree has to read the working tree. Severity is bounded by the attacker being an agent
    with Bash running as the **same uid as the server** — it can already read the file directly, so
    this is a confused deputy, not an information gain.
    - **Don't read "two integers" as the size of the leak, only its shape** (the audit's fair
      objection): the attacker also controls HEAD's blob for that path and can re-trigger the
      render freely over the unauthenticated loopback routes, so what it really has is a
      chosen-plaintext *diff-distance* oracle — a content-extraction primitive in kind, just a slow
      and coarse one. Nobody has built it, and the same-uid argument above is what keeps it
      non-blocking, not the output shape.
    - The audit also **falsified the bound as originally written**, via `core.worktree` putting
      outside *filenames* in the list. That is fixed (see `repoOpts` below), which is what restores
      it. `lib/git.test.ts` pins it: the summary is a path, a status word and two integers, and
      never any of the file's bytes.
- **Every git command in `gitChanges` carries `-z`, and that is correctness, not tidiness.** git
  *quotes* a path it can't print plainly — C-style, **named** escapes for `\n \t \" \\` etc. and
  **octal** for everything else, non-ASCII included. The old parse undid that with `JSON.parse` (a
  different format) and applied it **only to the status path, never to the `--numstat` key**. The
  two resulting failures are not the same failure, which is worth keeping straight:
  - a name with `"` or a tab is quoted by *both* commands and `JSON.parse` **succeeds**, so the
    status side became raw while the numstat key stayed quoted → lookup missed → `+0 −0`;
  - a **non-ASCII** name is quoted by both too, but `JSON.parse` **throws** on `\3`, so both sides
    stayed quoted and *matched* — counts were correct, but the path was displayed as
    `"\346\227\245…"` and clicking it returned an **empty diff** (verified end to end). Untracked
    non-ASCII files did read `+0`, because the contained line-count read got the quoted name.
  - every renamed file read `+0 −0` too: `diff.renames` defaults to on and numstat writes a rename
    as the unmatchable `old => new`.

  Under `-z` both commands emit raw, NUL-terminated, never-quoted paths, so nothing needs
  unquoting and nothing depends on `core.quotePath` — ordinary repo config, the same "a repo gets a
  say in the output format" class as `--literal-pathspecs` and `--submodule=short`. Note the record
  shapes differ: a rename is `new\0old` from `status` and an empty path field followed by
  `old\0new` from `--numstat`; the extra field is consumed **by position**, so an old name that
  looks like a status record (a file really called `?? evil.md`) can't forge a row.
- **`repoOpts` pins three config keys on *every* git call in `lib/git.ts`** — the same "a
  repository decides what git does" class as `--no-ext-diff --no-textconv`, and both leaks below
  were found by the security audit as unverified hypotheses and reproduced on the first try:
  - **`core.fsmonitor` names a program git executes.** Measured: it ran on `git status
    --porcelain`, on `git diff --numstat HEAD` and on the submodule `git diff` (not on `ls-tree`,
    `show` or `rev-parse`). `.git/config` is untracked and shared across every linked worktree, so
    a plant from inside one task's "isolated" worktree executes **in the web server process** when
    anyone — including another user — loads that project's page. `-c core.fsmonitor=` disables it.
  - **`core.worktree` redirects the working tree.** A planted absolute path made `git status
    --untracked-files=all` enumerate that directory and report *its* filenames as this project's
    untracked changes — arbitrary directory listings, no race, nothing planted in the tree.
    `-c core.worktree=…` does **not** override it (git resolves the worktree during setup, before
    `-c` is layered); **`--work-tree=<cwd>` does**. On `runGit` the same flag guards a *write*:
    `checkout` would otherwise materialise a branch into the attacker's directory.
    - **It is sent only when `cwd` is a worktree root, and that condition is load-bearing.**
      `--work-tree` pointed at a *subdirectory* corrupts the repo instead of failing: HEAD moves,
      the branch's files are written rebased into that subdirectory, and the real tracked files stay
      stale — exit 0 and a "Switched to branch" message. Reachable with no attacker, because
      `memberPath()` (lib/workspace.ts) doesn't check that a workspace member is its own repo, and
      the git-actions route feeds it straight to `checkout`/`pull`. Caught by round-two review after
      my own testing only ever used correctly-rooted directories. `repoOpts` therefore gates the flag
      on `existsSync(cwd/.git)` — the same test `isGit` uses.
  - **Every `execFileSync` here carries a `timeout`** (30 s local, 120 s for `runGit`, since
    `pull`/`push` are network calls). A repository can make a git command *never return* — see the
    `filter.<driver>.clean` note below — and these are synchronous, so a blocking filter wedges the
    event loop that also serves the SSE task streams until someone restarts the process.
  - **`diff.renames` / `status.renames` are pinned to `true`** so the two commands can't be made
    to describe one change differently (with `status.renames=false` a move is add+delete on one
    side and a single rename record on the other, so the deleted name lost its lines and the
    totals came out short). Wrong numbers, not a leak.
- **No platform-issued git command runs a hook** (`NO_HOOKS` / `gitEnv()` in `lib/git.ts`, and the
  same two lines in `runner/worktree.ts`'s `git()`). This is the widest member of the class above,
  because `git worktree add` gives a task its own HEAD, index and files but **not** its own
  `.git/hooks/` — that is one shared copy behind the main checkout and every linked worktree, and
  nothing in it is tracked. Measured before the fix: `worktree add` runs `post-checkout`,
  `post-index-change` and `reference-transaction`; `checkout` runs `post-checkout`; `push` runs
  `pre-push`; `pull` runs `reference-transaction`. `ensureTaskWorktree` issues `worktree add` on
  **every parallel dispatch**, so a single plant from inside one task's worktree re-arms itself and
  keeps executing in the runner process.
  - **`-c core.hooksPath=/dev/null`**, and `-c` beats a `.git/config` that points `core.hooksPath`
    back at the planted directory — verified, or the fix would be one `git config` from undone.
    `/dev/null` rather than an empty value: empty works only as an implementation detail (git joins
    `<value>/<hook>`, so empty yields the absolute `/post-checkout`, resting the mitigation on `/`
    not being writable). A fixed name under `tmpdir()` is worse than both — `/tmp` is
    world-writable, so another local user could create it and *supply* the hooks.
  - **`GIT_CONFIG_NOSYSTEM=1` buys less than it appears to**, and the first spec written for it was
    dead: a system-level `core.hooksPath` is already beaten by `-c`, so that test passed with the
    env var deleted. It was caught only by reverting each half separately — do that for any spec
    added here. The real key is **`core.excludesFile`**, which nothing `-c`s away: a system-level
    ignore file makes `git status --untracked-files=all` omit matching paths, so the changes list
    silently under-reports and unsaved work renders as a clean tree. That is what the spec pins.
  - **`process.env` is spread, not replaced**, and `gitEnv()` is a function rather than a
    module-level constant. The spread keeps `PATH`, `HOME` and the container's `GIT_CONFIG_COUNT`
    gh-credential wiring, without which Push breaks while every hook spec still passes; the
    function keeps a spec's `process.env` change visible to the subprocess, without which an
    env-planting spec passes while testing nothing.
  - **Deliberate behavior change:** the UI's Push/Pull/Checkout/Create no longer run the project's
    own hooks, so a repo gating pushes on a `pre-push` test run is not gated when pushing from the
    dashboard. An agent's own `git` through its Bash tool still honors hooks, so `/swe:ship` and
    this repo's default-branch guard are unaffected — this is about what the *server process*
    executes on a user's behalf.
  - **git-lfs is the legitimate casualty.** The mitigation can't tell a planted hook from a wanted
    one, and git-lfs works *through* `post-checkout`/`post-merge`/`pre-push` — so an LFS repo gets
    pointer files rather than content in a parallel-run worktree, and a dashboard Push won't
    upload LFS objects. The agent's own Bash `git` still runs them, so it's a rough edge rather
    than data loss, but don't use the Push button on an LFS repo.
  - **What it does not close — two live RCEs in the same class, reproduced by the audit of this
    change and knowingly left.** `credential.helper` (generic or url-scoped, in the repo's
    `.git/config`) runs a shell command as soon as a remote answers 401 — i.e. on any real push;
    `core.sshCommand` runs for an `ssh://` remote, and an attacker can create one with `git remote
    set-url`. Both inherit the whole server env, so `SECRETS_MASTER_KEY`/`GH_TOKEN` leak too. The
    one-line pins are worse than the hole and both were measured: `-c credential.helper=` also
    clears the container's gh helper and any global one (Push breaks for everyone), and
    `-c core.sshCommand=ssh` overrides a legitimate global setting. A sound fix must decide which
    helpers are trusted and re-inject them — a change to how the app authenticates, not a flag.
    Filed in the backlog; details and the rejected alternatives are in `.swe/notes.md`.
    - **Don't read the dev container as protection.** Compose clears the host's osxkeychain helper
      with an empty `GIT_CONFIG_VALUE_0`, and an empty value resets git's helper list — so in the
      container a *generic* plant is already neutralized by accident. A **native install** (how
      releases run) has no `GIT_CONFIG_*` and is fully exposed, as is a url-scoped plant either way.
  - `POST /api/projects/[id]/git` still has no auth, so an agent can trigger checkout/pull on any
    project over loopback — it just can't make that trigger run a *hook* it planted. Same open
    design question as the unauthenticated backlog routes.
- **Two pre-existing CRITICAL holes are reproduced and *not* fixed (2026-08-18). Read this before
  trusting anything above.** Both were found by the security audit of the `-z` work; both are older
  than it; neither has a cheap sound fix, so they are documented rather than papered over.
  - **`filter.<driver>.clean` is arbitrary command execution in the web server process.** A clean
    filter is a shell command in `.git/config`, bound to a path by `.gitattributes` *or*
    `.git/info/attributes` — nothing needs committing, so none of it shows in a review or a clone.
    Measured: it runs on `git diff --numstat HEAD` (i.e. on **every project page render**) and on the
    submodule diff; not on `status` or `show`. `--no-ext-diff`/`--no-textconv` do **not** stop it, and
    there is no key to `-c` away because the driver name is attacker-chosen. `--attr-source` blocks a
    worktree `.gitattributes` but **not** `.git/info/attributes` — and this repo's git (2.39.5) rejects
    the flag anyway, so adding it would silently zero every line count. The sound fix is the same
    redesign the line-count won't-fix declined: stop letting git read tracked content out of the live
    tree. **RCE is a much stronger motivation than two integers, so treat that won't-fix as "not in
    that task" rather than settled.** Mitigated only by the `timeout` above, which bounds a hang, not
    the execution.
  - **A `.git` *file* redirects the entire repo, and `isGit` can't see it.** `isGit` is
    `existsSync(path/.git)` and never checks directory-vs-file, but a one-line `gitdir: <absolute
    path>` file is a valid redirect (the form linked worktrees use). Reproduced: with project A's
    `.git` replaced by a pointer at repo B, `git status` in A reported B's tracked files and
    `git show HEAD:<path>` returned **B's committed content** — which is what `trackedDiff` renders
    into the diff modal, so it is cross-repository *content* disclosure. `--git-dir` does not help
    (it follows the pointer), and `GET /api/projects` is unauthenticated, so every project's absolute
    path is readable. Unfixed because a linked worktree's `.git` legitimately *is* a file, so the
    guard must validate the resolved gitdir against allowed roots — a change to
    `lib/discovery/projects.ts` plus the worktree machinery, not a flag.
  - **`merge.<driver>.driver` is the same class on `git merge`, reproduced 2026-08-22 and *not*
    fixed** (found by the security audit of the feature merge-back work). A custom merge driver
    is a shell command in `.git/config`, bound to a path by `.gitattributes` *or* untracked
    `.git/info/attributes`, and git runs it for a conflicting file during **any** `git merge` —
    including the platform-issued `gitMerge` behind the feature merge-back and the merge sweep.
    Verified: a planted `merge.custom.driver` executed in the runner process during a real
    `gitMerge` (full `repoOpts`/`gitEnv` hardening applied). Like `filter.<driver>.clean` the
    driver name is attacker-chosen, so there is no key to `-c` away, and `.git/info/attributes`
    isn't reachable by `--attr-source`. **First introduced by the 2026-08-21 `gitMerge` (a merge
    only ran in a disposable temp worktree then); the merge-back honesty work made it materially
    worse and that is the part this note owns:** the merge can now also run in the project's
    **main checkout** (via `mergeInMainCheckout`), and it re-fires unattended from the boot
    sweep and `promoteNext`. Two of those three amplifiers were closed in the same task — the
    forged-worktree parser that let the main-checkout merge target an arbitrary branch (see
    `branchCheckoutDir`'s `-z` note above) and the missing subprocess timeout that made the
    driver a DoS as well as an RCE — so what remains is the base class: a *legitimately*
    checked-out feature branch's merge, or a temp-worktree merge, still runs a repo-defined
    driver. The sound fix is the same redesign owed for `filter.clean` (stop letting a
    platform-issued git command execute repo-defined driver config, or refuse to merge a repo
    whose resolved driver isn't git's default). Filed to the backlog; the `timeout` now bounds
    the hang, not the execution.
- **This is defence in depth, not a perimeter.** It needs write access to a project tree to
  exploit, and these routes still have no auth on the non-task path — the same gap documented
  under the backlog. What it removes is a confused deputy: the server no longer reads outside a
  root on behalf of a path that merely looks like it's inside.
