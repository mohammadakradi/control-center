# log git hardening

Dated log of the `lib/git.ts` / `lib/safe-read.ts` hardening work — what was reproduced, what was fixed, and what is a deliberate won't-fix.

Part 2 of 2.

<!-- Split out of a single 232 KB `.swe/notes.md` on 2026-08-24, which was read in full at the start of every request (engineering rule 10). Entries are verbatim and in date order; only this header is new. -->

## 2026-08-18 — `gitChanges`' line counts: the leak is real, the fix is worse (won't-fix), and a default-config bug next to it
Picked up the backlog item left by the 2026-08-17 work (its "Residuals" bullet above). **The
outcome is a deliberate won't-fix on the security residual plus a real correctness fix in the same
twenty lines.** Recording the reasoning at length because the next person to read that bullet will
otherwise repeat the investigation.
- **Reproduced first, as usual.** A tracked path replaced by a hard link to a 137-line file
  outside the repo makes `git diff --numstat HEAD` report `137  1  tracked.md` — the outside
  file's line count, exactly as filed. No race needed; the plant just sits there.
- **The obvious cheap fix is not a fix, and this is the part worth keeping.** Post-filtering the
  numstat map with `escapesOnDisk` looks like a two-line containment win. It is worthless:
  `escapesOnDisk` answers **false for a path with nothing on disk** — deliberately, because that
  is how a deleted file's diff is served from the object store — so the attacker plants the link,
  lets numstat read it, and deletes it. The check then passes on a path that no longer exists. No
  timing skill, no retries. Shipping it would have been precisely the "documenting a hole is not
  closing it" mistake the 2026-08-16 entry exists to warn about, dressed up as a fix.
- **The sound fix costs more than the bug.** added/deleted are *diff* quantities, not line counts,
  so containing them means producing the diff ourselves for every changed path: a `git show`
  subprocess per file, on a page that renders on every project view and that `lib/workspace.ts`
  calls **once per workspace member**. Avoiding the spawns means hand-rolling a line-diff in Node,
  and then the counts every user sees on every project disagree with git's. That is a worse
  product outcome than one integer under a contrived plant — and "subtly wrong for everyone" is
  the failure mode this file has already shipped twice (the blank-diff family).
- **Severity, stated honestly rather than hedged:** the attacker is an agent with Bash running as
  the **same uid as the server** in every deployment shape (dev container and native install
  both), so it can already `cat` the file it is trying to learn the line count of. There is no
  privilege gain here at all; what remains is a confused deputy, and the value is 1–2 integers.
- **So the deliverable is a bound, not a fix.** `lib/git.test.ts` now pins what the decision rests
  on: the summary is a path, a status word and two integers, and never any of the file's bytes.
  It asserts the `+137 −1` leak as a *characterisation*, so if anyone closes it the suite says so
  rather than staying green on a stale note. If the changes list ever gains a content preview, the
  residual stops being two integers and that spec fails.
- **Two errors in the filed item**, both the same class as the last two tasks — a filed diagnosis
  is a lead, not a finding: it cited `linkTargetInside` as a primitive in `lib/safe-read.ts`
  (**no such function exists**), and it implied the numstat call needs the same hardening as the
  other `git diff` calls. Measured: `diff.submodule` = log / diff / short all produce an identical
  `1  1  sub` numstat record, so `--submodule=short` would be cargo cult here and was **not**
  added. Third task in a row where reproducing before designing changed the answer.

**The bug found while investigating, which is the part that actually ships.** `gitChanges` parsed
git's *default*, quoted output, and that parse was wrong on default config. **The correctness review
corrected my first description of the mechanism and it was right — the version below is the measured
one.** git C-quotes with **named** escapes for `\a \b \f \n \r \t \v \" \\` and **octal** for
everything else; the old `unquote()` used `JSON.parse` (a different format) and — the actual defect —
applied it **only to the status path, never to the `--numstat` key**. So there were two *different*
failures, not one:
- A name containing `"` or a tab is quoted by **both** commands, and `JSON.parse` **succeeds** on
  those escapes. So the status side became the raw name while the numstat key stayed quoted, the
  lookup missed, and the file showed `+0 −0`.
- A **non-ASCII** name is quoted by both as well, but `JSON.parse` **throws** on `\3`, so the quoted
  string survived on *both* sides, they matched, and the counts were **correct**. What broke was the
  path: verified end to end against the running app, the changes list rendered
  `"\346\244\234…-non-ascii.md"` and clicking it returned **`{"diff":""}`** — a file listed as
  changed whose diff is empty, the exact silent-blank failure the 2026-08-17 entry calls "the
  pattern to carry forward". An *untracked* non-ASCII file did read `+0`, because the contained
  line-count read was handed the quoted name.
  - I had written this up as "every non-ASCII filename lost its counts", which was wrong in both
    directions. Worth noting *how* it was wrong: I measured that the two sides disagreed for a name
    with a **space** (status quotes, numstat doesn't) and generalised from it — but that is the one
    case `JSON.parse` handles, so it was the case that *worked*. Measuring one example and
    extrapolating the mechanism is not measuring the mechanism.
- Every **renamed** file showed `+0 −0` too: `diff.renames` defaults to on, so numstat writes a
  rename as `old => new`, matching no status path. Not exotic — an ordinary `git mv` plus an edit.
- A file literally named `a -> b.md` was mis-parsed as a rename by the `" -> "` split.
- And the non-ASCII half depended on `core.quotePath`, ordinary repo config.
Fix: `-z` on both commands and `unquote()` deleted. Both then emit raw, NUL-terminated,
never-quoted paths, so there is nothing to unquote and nothing that varies with how a repo is
configured — the same reason `--literal-pathspecs` and `--submodule=short` are pinned on the diff
calls. Watch the record shapes, they are **not** symmetrical: `status -z` writes a rename as
`new\0old`, `--numstat -z` writes an *empty* path field followed by `old\0new`. Consuming the
extra field is what stops the old name appearing as a phantom row of its own.
- **The spec uses a CJK name, not an accented one, on purpose.** `ü` has both an NFC and an NFD
  spelling and macOS stores the decomposed form, so a spec built on it passes in the Linux
  container and fails on a host checkout for a reason unrelated to the code. `日本語.md` has no
  decomposition. (Same trap the existing "tracked paths with spaces or non-ASCII" spec sits next
  to.)
- Verified the new spec **fails before the change** (`日本語.md is missing from the changes list`)
  and passes after, per the 2026-08-16 lesson that a green test is not evidence until it can fail.
  Then confirmed in the real app rather than only in specs: dropped a CJK-named file into this
  repo's tree, loaded the project page, and checked all 15 rendered paths are unquoted and the
  diff route answers 200 with real hunks — while the old octal-quoted spelling still answers with
  an empty diff.
- **Residual, unchanged and now deliberate:** with `-z` a filename containing a control character
  arrives *unescaped* where it used to be quoted. It cannot break the parse (records are
  NUL-separated — that is the point), and `isUsableRelPath` already refuses control characters at
  the file/diff routes, so such a file stays listed and its diff won't open. Listing it is the
  honest answer; hiding a changed file is the antipattern above.

**The security audit's two unverified hypotheses were both real, and both were bigger than the item
I was sent to look at.** It flagged them as "analysis only, not reproduced" and said so plainly;
each reproduced on the first attempt. Neither is a regression — both predate everything here — but
both live in the function I was already changing and both cost one flag, so they are fixed rather
than filed. They are the **third and fourth** instances of "a repository decides what git does" in
this one file, after `diff.<n>.textconv` and `diff.submodule`.
- **`core.fsmonitor` names a program git executes.** Planted as a script, it ran on
  `git status --porcelain`, on `git diff --numstat HEAD`, and on the submodule `git diff` — not on
  `ls-tree`, `show` or `rev-parse` (I probed each). `.git/config` is untracked and shared across
  every linked worktree, so this is code execution **in the web server process**, triggered by
  whoever loads a project page, plantable from inside a task's supposedly isolated worktree, and
  persisting after that task ends. `-c core.fsmonitor=` disables it at no cost beyond a repo
  legitimately using the fsmonitor daemon doing a full scan.
- **`core.worktree` redirects the working tree**, and this one **falsified the bound my own
  won't-fix rests on**: with an absolute path planted there, `git status --untracked-files=all`
  enumerated that directory and reported *its* filenames as this project's untracked changes. Not
  two integers — arbitrary directory listings for any path on the host, no race, nothing planted in
  the tree. The non-obvious part: **`-c core.worktree=…` does not override it**, because git
  resolves the worktree during setup before `-c` config is layered; `--work-tree=<cwd>` does
  (measured all three of `-c`, `--work-tree` and `GIT_WORK_TREE`). Content was never exposed —
  `readFileInside` is anchored to the *caller's* cwd, not git's idea of the worktree — so this was
  names only.
  - Safe to pin because `isGit` is `existsSync(path/.git)`, so `gitChanges`/`gitFileDiff` only ever
    run against a checkout or linked-worktree root, never a subdirectory of one. Verified
    byte-identical output for both kinds, with and without the flag.
  - On `runGit` the same flag guards a **write**: `git checkout` under a planted `core.worktree`
    materialises the branch into the attacker's directory.
- Both pins, plus `diff.renames`/`status.renames` (a wrong-numbers issue the audit also found: set
  to disagree, a move is add+delete on one side and one rename record on the other, so the deleted
  name lost its lines and the totals came out short), now live in **`repoOpts`, applied inside the
  two shared helpers** rather than per call site. That placement is the lesson from this file's own
  history: `--no-ext-diff`, `--submodule=short` and `--literal-pathspecs` were each added per-call
  and each had to be added again to the next command someone wrote, and re-review caught a miss
  every time.
- Both new specs were verified to **fail with `repoOpts` neutered** and pass with it restored.
- **The pins were then attacked rather than assumed.** All blocked: `core.fsmonitor` as a plain hook
  path, as a **whitespace-padded** path, as `=true` (the built-in daemon), and the deprecated
  `core.useBuiltinFSMonitor=true`; `core.worktree` set in local config *and* as a per-worktree
  `config.worktree` under `extensions.worktreeConfig`; and `GIT_WORK_TREE` exported into the
  server's own environment (the flag wins over the env, which is the ordering this depends on).
- **The mutating commands were exercised too, since `repoOpts` now covers `runGit`.** `checkout -b`,
  `checkout <branch>` (worktree correctly rewritten), `pull --ff-only` against an advanced upstream
  (fast-forward applied, files updated), `worktree add`, and `checkout -b` *inside* a linked
  worktree all behave normally. `push` needs no coverage on this axis — it never touches the working
  tree — and the repo's own commit hook blocks scripting it anyway.
- Verified in the live app rather than only in specs: the project page's branch chip, branch list and
  ahead/behind match raw `git` exactly, and a real 3-member workspace project (members given as
  *relative* paths like `../portal-frontend`) still renders all three change summaries.

**Round two of review found that my `--work-tree` fix silently corrupted repositories, and it was
right.** Both reviewers came back CHANGES_REQUIRED. This is the third task running where round two
mattered more than round one, and the failure mode is identical to the one the 2026-08-17 entry
already names: *a fix written under review pressure deserves the same adversarial treatment as the
original code.* I even wrote in the round-one notes that I had "exercised" the mutating commands —
and every case I exercised was the correctly-rooted one, which is precisely the case that works.
- **The bug.** `--work-tree=<cwd>` is only correct when `cwd` *is* the working-tree root. Point it at
  a **subdirectory** and git does not fail — it succeeds destructively: HEAD moves, the branch's
  files are written *rebased into that subdirectory* (`sub/root.md`, `sub/sub/f.md`), and the real
  tracked files keep their old content. Exit 0, `Switched to branch 'feature'`, and afterwards
  `git status` reports every real file as modified with a set of phantom untracked duplicates beside
  it. `pull --ff-only` does the same while printing `Fast-forward`. Reproduced.
- **It was reachable, and needs no attacker.** `memberPath()` (lib/workspace.ts) resolves a workspace
  member and — unlike `resolveMembers()`, which checks `existsSync(path/.git)` — verifies nothing,
  and it is what `app/api/projects/[id]/git/route.ts` feeds to all four mutating helpers. A
  `.swe/workspace.json` member that is simply a folder of the parent repo (an ordinary monorepo
  layout) produces the corrupting case on its own.
- **The fix is to make the pin conditional**, in `repoOpts`, on `existsSync(cwd/.git)` — the same
  test `isGit` uses, so the two agree on what a root is (directory = checkout, file = linked
  worktree, both roots). Put there rather than in the route because no future caller can miss it.
  The cost is honest and stated in the code: for a non-root cwd the `core.worktree` protection is
  absent, i.e. exactly the pre-change behaviour. A hypothetical plant is worth less than not
  corrupting someone's checkout.
- **The four mutating helpers had zero test coverage, before or after.** That absence is what let the
  regression through, so they have specs now: the subdirectory case (verified to **fail** with the
  pin made unconditional again) and a happy path driving `gitCreateBranch` → `gitCheckout` → real
  `gitPull` fast-forward against a local upstream, asserting file *contents* on disk rather than exit
  codes. `gitPush` is deliberately left uncovered: it never touches the working tree, and the repo's
  own commit hook blocks scripting a push.

**Two pre-existing CRITICAL findings the audit surfaced. I reproduced both, fixed neither, and they
should be filed** (the backlog MCP tool disconnected before I could file them — do it by hand):
- **`filter.<driver>.clean` is arbitrary command execution in the web server process.** A clean
  filter is a shell command in `.git/config`, bound to a path by `.gitattributes` **or**
  `.git/info/attributes`. Measured: it executes on `git diff --numstat HEAD` (the call
  `trackedLineCounts` makes on *every project page render*) and on the submodule `git diff` — not on
  `git status --porcelain` or `git show`. Neither the binding file nor the command needs to be
  committed, so none of it appears in a review, a clone, or `git status`.
  - **No flag closes it, which I checked rather than assumed.** `--attr-source=<tree>` does suppress a
    worktree `.gitattributes` binding — but **not** `.git/info/attributes`, which is equally
    agent-writable. And it is moot regardless: the container's git is **2.39.5** and rejects
    `--attr-source` outright (exit 129), so adding it would have made `git()` return `""` and turned
    every line count into a silent 0 — the exact silent-blank antipattern this file's notes warn
    about, shipped in the name of security. The driver name is attacker-chosen, so there is no key to
    `-c` away either.
  - **What I did do is bound the damage:** every `execFileSync` in `lib/git.ts` now carries a
    `timeout`. These are *synchronous* calls, so a filter that blocks (`sleep infinity`) held the Node
    event loop — the process serving every SSE task stream — until someone restarted it. Verified a
    `sleep 30` filter is killed at the timeout (`ETIMEDOUT`/`SIGTERM`). Local reads get 30 s;
    `runGit` gets 120 s because `pull`/`push` are network operations where slow is legitimate.
  - **This partly invalidates the won't-fix above, and that is the honest reading.** I rejected
    synthesizing the change summary because the leak was worth "two integers". The sound fix for
    *this* is the same redesign — never let git read tracked content out of the live tree — and RCE
    is a different order of motivation. The won't-fix stands only as "not in this task".
- **A `.git` *file* redirects the whole repo, and `isGit` cannot see it.** `isGit` is
  `existsSync(path/.git)`, blind to whether that entry is a directory or a one-line
  `gitdir: <absolute path>` redirect — the format linked worktrees legitimately use. Reproduced: with
  project A's `.git` replaced by `gitdir: …/B/.git`, `git status` in A reported *B's* tracked file as
  deleted, and `git show HEAD:secrets/id_rsa.md` printed **B's committed content** — which is exactly
  what `trackedDiff`/`deletedDiff` render into the diff modal. So it is content disclosure across
  repositories, not just names. An explicit `--git-dir` does **not** help (it follows the gitlink
  text), and `GET /api/projects` is unauthenticated, so other projects' absolute paths are readable
  for the asking. Not fixed here because a linked worktree's `.git` *is* a file by design, so the
  guard has to validate the *resolved* gitdir against allowed roots — a change to
  `lib/discovery/projects.ts` and the worktree machinery that could break parallel runs if rushed.

**Other review findings, and what I did with each.**
- *Not fixed, filed instead — bidi/homoglyph row spoofing.* `-z` means a filename's non-ASCII bytes
  now reach the UI raw, so `U+202E` RIGHT-TO-LEFT OVERRIDE renders as a live bidi control in the
  changes list, its `title=` tooltip and the diff modal header, where it used to appear as visibly
  escaped octal. Trojan-Source-style spoofing of a path shown to a reviewer at an approval gate.
  Genuinely new here, and low: display integrity only, no leak, and React escapes the markup
  (checked — no `dangerouslySetInnerHTML`, and `URLSearchParams` percent-encodes the route param).
  Not fixed here because the sound fix is at the **render** layer and applies to every repo-derived
  path the app displays — the folder picker and file modal already render raw `readdir` names, so
  this is pre-existing in class and my change extends it to one more surface. Escaping it inside
  `gitChanges` would corrupt the path the diff route needs. Filed for fe.
- *Kept, with its limits stated.* The reviewer is right that the no-content assertion in
  `the change summary reports counts, never file content` cannot fail against the current
  `FileChange` type — it is a future-shape canary, not regression coverage, which is what its
  docstring says. Only the `+137 −1` characterisation exercises behaviour.
- *Comment corrected.* `if (!path) continue` after the rename branch is effectively unreachable —
  `maxBuffer` overflow **throws**, so `git()` returns `""` rather than a truncated stream. Kept as a
  cheap bound but no longer described as guarding truncation.
- *Pre-existing, left alone:* an `RD` entry (staged rename whose new name was then deleted in the
  worktree) reports `+0 −0` — status keys the new name, numstat the old. The old `" -> "` parse did
  the same, so it is not a regression.
- *Pre-existing, filed:* the notes' description of the dependency-audit surface ("hono via
  `@modelcontextprotocol/sdk`") understates it — `pnpm audit --prod` reports 13 high / 14 moderate,
  transitive via `next@16.2.9` and `@anthropic-ai/claude-agent-sdk`. No dependency changed here.
  Scanners were otherwise clean on this diff: semgrep 0, and gitleaks' only working-tree hit is the
  pre-existing fake `AKIA-…` fixture already committed in `lib/git.test.ts`.

## 2026-08-19 — platform-issued git runs no hooks and no system config (`NO_HOOKS`, `gitEnv`)

`git worktree add` gives a task its own HEAD, index and files. It does **not** give it its own
`.git/hooks/`, `.git/config` or `.git/info/attributes` — those are one shared copy behind the main
checkout and every linked worktree, none of them tracked. An agent has ordinary write access to
all three from inside the tree it was handed, so `runner/worktree.ts`'s isolation docstring was
overclaiming and has been rewritten to say so.

- **Measured, before the fix** (git 2.50.1): `git worktree add` runs `post-checkout`,
  `post-index-change` and `reference-transaction`; `git checkout` runs `post-checkout`;
  `git push` runs `pre-push`; `git pull` runs `reference-transaction`. `ensureTaskWorktree` issues
  `worktree add` on **every parallel dispatch**, so one plant re-arms itself indefinitely and
  executes in the runner process; the rest are reachable on demand through the project page's git
  controls and through the unauthenticated `POST /api/projects/[id]/git`.
- **Fix:** `-c core.hooksPath=/dev/null` on every git invocation in `lib/git.ts` (folded into
  `repoOpts`, plus explicitly on the two calls that bypass it — the `--no-index` diff and
  `gitShowBytes`) and in `runner/worktree.ts`'s `git()`, with `GIT_CONFIG_NOSYSTEM=1` in the
  subprocess env. Verified `-c` beats a repo-level `core.hooksPath` that points back at the
  planted directory, so the mitigation isn't one `git config` call from being undone.
- **Why `/dev/null` and not an empty value.** Empty works today, but only as an implementation
  detail: git joins `<value>/<hookname>`, so an empty value yields the absolute `/post-checkout`
  and the mitigation would rest on `/` not being writable rather than on anything git promises.
  A fixed name under `tmpdir()` is worse than either — `/tmp` is world-writable, so another local
  user could create that directory and *supply* the hooks, turning the fix into the attack.
  `/dev/null` is not a directory and can't be replaced without root, so every lookup under it
  fails ENOTDIR; a host where the path is meaningless still finds no hooks, which is the safe
  direction to degrade.
- **`GIT_CONFIG_NOSYSTEM` buys less than it looks like, and the first test I wrote for it was
  worthless.** I asserted that a system-level `core.hooksPath` couldn't re-enable hooks — it
  can't, but `-c` alone already ensures that, so the spec passed with the env var deleted. Found
  only by reverting each half separately, which is now the standing way to check a spec in this
  file earns its place. The honest key is **`core.excludesFile`**: nothing `-c`s it away, and a
  system-level ignore file makes `git status --untracked-files=all` omit matching paths, so the
  changes list under-reports and a directory of unsaved work renders as a clean tree. That is what
  the spec pins. Note the threat is weaker than the repo-level one regardless — writing
  `/etc/gitconfig` needs root.
- **`gitEnv()` is a function, not a module-level constant, and that is load-bearing for testing.**
  A snapshot taken at import never sees a later `process.env` change, which silently makes any
  spec that plants `GIT_CONFIG_SYSTEM` pass without testing anything. Caught while writing the
  spec above.
- **`process.env` is spread, never replaced.** A bare `{ GIT_CONFIG_NOSYSTEM: "1" }` drops `PATH`,
  `HOME` and the dev container's `GIT_CONFIG_COUNT`/`GIT_CONFIG_KEY_0` gh-credential wiring — that
  would break Push for every user while every hook spec still passed, so there's a spec asserting
  push/pull still resolve `remote.*` and land on the remote.
- **Deliberate behavior change:** the UI's Push/Pull/Checkout/Create no longer run the project's
  own hooks, so a repo whose `pre-push` gates on tests is no longer gated when pushing from the
  dashboard. Accepted — a hook is a program the *server* would execute. An agent's own `git` via
  Bash still honors hooks, so `/swe:ship` and the default-branch guard are unaffected.
- **Out of scope, still open:** the git route has **no auth**, so an agent can still trigger
  checkout/pull on any project over loopback; what it can no longer do is make that trigger run
  its own program. Same design question as the unauthenticated backlog routes. Also unchanged:
  `filter.<driver>.clean` is still command execution on `git diff --numstat HEAD` (no `-c` key
  exists — the driver name is attacker-chosen — and `.git/info/attributes` is untracked and
  unaffected by `--attr-source`), and a `.git` *file* still redirects a whole repo past `isGit`.
  Both remain bounded only by the subprocess timeouts.

### The audit of this change found two live RCEs in the same class — knowingly not fixed

The security audit reproduced two keys that `NO_HOOKS` does **not** cover, both on `gitPull`/
`gitPush`, both reachable from the unauthenticated git route and from the project page's buttons.
Verified independently with the exact flag set the code issues:

- **`credential.helper`** — generic *or* url-scoped, in the repo's own `.git/config`. Runs as a
  shell command the moment a remote answers 401, which is the ordinary shape of any private host,
  so `push` triggers it reliably. Reproduced against a local 401 responder: both the generic and
  the url-scoped plant fired.
- **`core.sshCommand`** — runs for an `ssh://` remote, and the attacker does not need the project
  to have one, since `git remote set-url` is the same ordinary `.git/config` write it already has.
  Reproduced: fired under `-c core.hooksPath=/dev/null -c core.fsmonitor=` + `GIT_CONFIG_NOSYSTEM=1`.

Either one inherits the whole server environment — `gitEnv()` spreads `process.env` deliberately —
so `SECRETS_MASTER_KEY` and `GH_TOKEN` are readable. That makes these credential disclosure, not
merely execution, and strictly worse than the `filter.<driver>.clean` hole already documented.

**Why they aren't fixed in this task, with the measurements that decide it:**
- `-c credential.helper=` *does* clear a planted helper — and also clears the container's own
  `GIT_CONFIG_COUNT`-supplied gh helper **and** any global one. Measured: the env-supplied helper
  did not survive the clear. That breaks Push for every user, which is a worse outcome than the
  hole.
- `-c core.sshCommand=ssh` neutralizes that plant, but measured, it equally overrides a
  *legitimate* global `core.sshCommand` — so it breaks anyone using a custom ssh invocation.
- Inspecting `.git/config` and refusing is check-then-use: the file is agent-writable and the
  render can be re-triggered freely, exactly the pattern rejected for the numstat leak.
- The sound fix is to decide which helpers are *trusted* and re-inject them after clearing — a
  change to how this app authenticates (compose wiring, native installs, the release docs), not a
  flag. Filed in the backlog rather than half-done here.

**A genuinely surprising side-finding: the dev container is accidentally protected and a real
install is not.** Compose sets `GIT_CONFIG_KEY_0=credential.helper` with an **empty** value to
clear the host's osxkeychain helper, and an empty value resets git's helper list — so inside the
container a repo-planted *generic* `credential.helper` is already neutralized as a side-effect of
wiring up gh. A **native install**, which is how releases actually run, has no `GIT_CONFIG_*` at
all and is fully exposed; so is a url-scoped plant in either case. This was found because the
"known-live" spec failed in the container while the hole reproduced fine on the host — the spec
now clears `GIT_CONFIG_*` so it describes a real install rather than this one container. Don't
mistake the container's behavior for a mitigation.

Also confirmed **not** exploitable, so nobody re-checks them: `protocol.ext.allow` (git defaults it
to `never`, and it stayed blocked even with `GIT_PROTOCOL_FROM_USER=1`), `core.pager` and
`core.editor` (no tty on these pipes; nothing here opens an editor), and alias shadowing (an alias
cannot shadow a builtin).

**One process note.** The audit reported the working tree "changing during the audit" between a
hardened and an unhardened `lib/git.ts`. That was me running falsification passes (revert a half,
run the suite, restore) in the same checkout while it read. Not a mystery — but worth knowing that
a read-only auditor and a falsification loop in one working tree will confuse each other, and the
falsification should be done in a worktree or before dispatching the auditor next time.
