import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { escapesOnDisk, readBytesInside, readFileInside } from "./safe-read";

export type FileChange = {
  path: string;
  status: string; // modified | added | deleted | renamed | untracked
  added: number;
  deleted: number;
};

export type GitChanges = {
  files: FileChange[];
  totalAdded: number;
  totalDeleted: number;
  truncated: number; // files beyond the display cap
};

const FILE_CAP = 200;

/** Ceiling on reading an untracked file — to count its lines for the changes list, and to
 *  build its diff. The line-count read used to be unbounded, so a multi-gigabyte untracked
 *  file was a way to make that route exhaust memory. Past the cap the file counts 0 additions
 *  and shows no diff, like any other unreadable one. An untracked file's diff is its whole
 *  content, so `DIFF_CAP` would have truncated it to 200 KB regardless. */
const UNTRACKED_READ_CAP = 2 * 1024 * 1024;

/** Ceiling on either side of a *tracked* file's diff, matching the `maxBuffer` these git calls
 *  already run with — a bound on memory, not on what is worth showing.
 *
 *  It deliberately is not `UNTRACKED_READ_CAP`. A one-line edit deep inside a 4 MB tracked file
 *  produces a five-line hunk, and reusing the smaller cap here silently returned *no diff* for
 *  it — a regression review caught, since the old code let git read the file at any size and
 *  only the rendered output was ever capped. */
const TRACKED_READ_CAP = 16 * 1024 * 1024;

/**
 * Flags every `git diff` here must carry, because a repository can define what "diff" *means*.
 *
 * `diff.<name>.textconv` and `diff.<name>.command` name a shell command git runs to render a
 * file. The command lives in `.git/config` and the pattern binding it to a path can live in
 * `.git/info/attributes` — neither is a tracked file, so neither shows up in `git status`, a
 * review, or a clone. Both are ordinary filesystem writes inside a repo, which is exactly what
 * a task's Bash tool has in the worktree it runs in. Verified: without these flags a planted
 * driver executes on `git diff HEAD -- <path>`; with them it does not, and the diff is
 * unchanged.
 *
 * A clone can't carry this (`.git/config` and `.git/hooks` never transfer), so it is the
 * agent-with-Bash arm of the threat model, not the untrusted-repo one.
 */
const NO_CUSTOM_DIFF_DRIVERS = ["--no-ext-diff", "--no-textconv"];

/**
 * Args and env that make git run **no hook and no machine-wide config**, on every invocation in
 * this file. Unlike everything in `repoOpts` below, these are not tied to a repo being present,
 * so they are also carried by the two calls that bypass it (`--no-index`, `git show`).
 *
 * **Hooks are the widest instance of "a repo decides what git does" in this file.** `.git/hooks/`
 * is *shared* by a checkout and every linked worktree — `git worktree add` gives a task its own
 * HEAD, index and working directory, but not its own hooks — and none of it is tracked, so a
 * planted hook appears in no `git status`, no diff, no review and no clone. A task's Bash tool has
 * ordinary write access there. Measured against a planted set:
 * - `git worktree add` runs `post-checkout`, `post-index-change` and `reference-transaction` —
 *   and `ensureTaskWorktree` (runner/worktree.ts) issues that command on **every parallel
 *   dispatch**, so one plant re-fires by itself, in the main checkout's `.git`, indefinitely;
 * - `git checkout` runs `post-checkout`, `git push` runs `pre-push`, `git pull` runs
 *   `reference-transaction` — all four reachable from the project page's git controls.
 *
 * `core.hooksPath` is the only knob that turns the whole directory off, and `-c` beats a
 * `.git/config` that sets it back (verified against a repo-level plant).
 *
 * **Why `/dev/null` and not the alternatives**, since the value is the entire mitigation:
 * - *An empty value* also works today, but only as an implementation detail — git joins
 *   `<value>/<hookname>`, so empty yields the absolute `/post-checkout`, and the mitigation would
 *   be resting on `/` not being writable rather than on anything git promises.
 * - *A fixed name under `tmpdir()`* is actively worse: `/tmp` is world-writable, so another
 *   local user could create that directory and **supply** the hooks — turning the fix into the
 *   attack. A per-process `mkdtemp` avoids that but adds a directory to create, keep and clean up
 *   for no gain.
 * - `/dev/null` exists on every POSIX system, is not a directory, and cannot be replaced without
 *   root, so every `<hooksPath>/<hook>` lookup fails with ENOTDIR. A path that cannot resolve is
 *   exactly the outcome wanted, which is also why a non-POSIX host degrades safely rather than
 *   dangerously: the worst a nonsense path does is find no hooks.
 *
 * `GIT_CONFIG_NOSYSTEM=1` covers the other end, `/etc/gitconfig` — and it is worth being precise
 * about what it adds, because the obvious answer is wrong. It is **not** needed to stop a
 * system-level `core.hooksPath` or `core.fsmonitor`: `-c` outranks system config, so the pins
 * above already win those (measured — a spec asserting otherwise passed with the env var removed,
 * which is how this was caught). What it covers is every key we *don't* name, since there is no
 * `-c` for a file whose contents we don't know. The one pinned by a spec is `core.excludesFile`:
 * a system-level ignore file makes `git status --untracked-files=all` omit matching files, so the
 * changes list silently under-reports and the omission looks exactly like a clean tree.
 *
 * Deliberately narrow: **repo and global config stay on.** `gitPull`/`gitPush` need `remote.*`,
 * and the dev container wires gh's credential helper through `GIT_CONFIG_COUNT`/`GIT_CONFIG_KEY_0`
 * env — verified that `NOSYSTEM` leaves those alone (they are a separate mechanism), so Push keeps
 * authenticating. Note the threat here is weaker than the repo-level one either way: writing
 * `/etc/gitconfig` needs root, and an attacker with root has no need of this.
 *
 * **This turns off *legitimate* hooks too, and one case is worth knowing about.** The mitigation
 * cannot distinguish a planted hook from a wanted one, so a project relying on hooks for correct
 * checkouts loses that here. **git-lfs** is the realistic instance: it installs `post-checkout`,
 * `post-merge` and `pre-push`, so through the platform's own commands an LFS repo will materialise
 * *pointer files* rather than file contents in a new parallel-run worktree, and a Push from the
 * dashboard will not upload LFS objects. The agent's own `git` (Bash) still runs them, which is
 * the path that actually commits work, so this is a rough edge rather than data loss — but the
 * dashboard's Push button is the wrong thing to use on an LFS repo until that is handled.
 *
 * **What this does *not* do — read this before trusting the paragraph above.** This closes
 * *hooks*. It does **not** close the wider "a repository names a program git runs" class, and two
 * keys in it are still live on `gitPull`/`gitPush`, both reproduced by the security audit of this
 * change with the exact flag set above:
 * - **`credential.helper`** (generic *or* url-scoped, in the repo's own `.git/config`) runs as a
 *   shell command the moment a remote answers 401 — the ordinary shape of any private host, so a
 *   `push` triggers it reliably. Measured: fires.
 * - **`core.sshCommand`** runs for an `ssh://` remote, and the attacker does not need the project
 *   to have one — `git remote set-url` is the same ordinary `.git/config` write. Measured: fires.
 * Because the child inherits the whole server environment (deliberately — see `gitEnv`), either
 * one reads `SECRETS_MASTER_KEY` and `GH_TOKEN`, so this is credential disclosure, not just
 * execution.
 *
 * **The one-line fixes do not work, which is the part worth recording.** Measured, not assumed:
 * `-c credential.helper=` does clear a planted helper — and also clears the container's own
 * `GIT_CONFIG_COUNT`-supplied gh helper and any global one, i.e. it breaks Push for every user.
 * `-c core.sshCommand=ssh` neutralizes that plant but equally overrides a *legitimate* global
 * `core.sshCommand`. A sound fix has to decide which helpers are trusted and re-inject them, which
 * is a change to how this app authenticates (compose wiring, native installs, docs) rather than a
 * flag — and inspecting `.git/config` first and refusing is check-then-use, the pattern this file
 * has already rejected twice. Tracked in the backlog; see `.swe/notes.md`.
 *
 * Also unchanged and pre-existing: `filter.<driver>.clean` (no `-c` key exists — the driver name
 * is attacker-chosen), and a `.git` *file* redirecting the whole repo past `isGit`.
 *
 * Finally, an agent's own `git` from its Bash tool still runs hooks, as it should — this is about
 * what the *server process* executes on a user's behalf — and a plant is still reachable on demand
 * through `POST /api/projects/[id]/git`, which has no auth at all.
 */
export const NO_HOOKS = ["-c", "core.hooksPath=/dev/null"];

/**
 * Spread `process.env` — do not replace it. A bare `{ GIT_CONFIG_NOSYSTEM: "1" }` drops `PATH`,
 * `HOME` and the container's `GIT_CONFIG_*` credential wiring, which breaks `pull`/`push` (and
 * finds `git` only by luck). This is the whole reason it is one shared helper.
 *
 * It is a **function, not a module-level snapshot**, and that is not style: a snapshot taken at
 * import never reflects a later change to `process.env`, which is both wrong (the container's
 * `GIT_CONFIG_*` wiring is read at call time everywhere else) and untestable. Pinned by the
 * "config from the environment still reaches git" spec, which sets `GIT_CONFIG_COUNT` *after*
 * import and fails against a snapshot. Reading `process.env` per call costs nothing measurable
 * next to a process spawn.
 *
 * Both halves resisted a naive spec, so if you are adding one here: revert the thing it claims to
 * protect and check it actually goes red. A spec that pushes to a **local** remote does not test
 * the credential wiring, and one that drops `PATH` does not fail either, because glibc falls back
 * to `confstr(_CS_PATH)` and finds `/usr/bin/git` anyway. Both of those passed against a
 * deliberately broken `gitEnv` before a reviewer caught them.
 */
export function gitEnv(): NodeJS.ProcessEnv {
  return { ...process.env, GIT_CONFIG_NOSYSTEM: "1" };
}

/**
 * Global options every git invocation here carries, for exactly the reason
 * `--no-ext-diff --no-textconv` are on the diff calls: **a repository decides what git does**,
 * and `.git/config` is untracked, shared across every linked worktree, and an ordinary write for
 * a task's Bash tool. Both of these were found by the security audit of this change as
 * unverified hypotheses, and both reproduced on the first try.
 *
 * - **`-c core.fsmonitor=`** — that key names a **program git executes**. Measured: with a script
 *   planted there, `git status --porcelain` and `git diff --numstat HEAD` both ran it, as did
 *   `git diff --submodule=short` (`git ls-tree`, `git show` and `git rev-parse` did not). So a
 *   plant from inside one task's "isolated" worktree executes in the web server process whenever
 *   anyone — including a different user — loads that project's page. The empty value disables it;
 *   the only cost is that a repo legitimately running the fsmonitor daemon does a full scan,
 *   which is slower and correct. This is the third instance of "a repo can make git run its own
 *   command" in this file, after `diff.<n>.textconv` and `diff.<n>.command`.
 *
 * - **`--work-tree=<cwd>`** — `core.worktree` **redirects the working tree**. Measured: with an
 *   absolute path planted there, `git status --porcelain --untracked-files=all` enumerated that
 *   directory and reported *its* filenames as untracked entries of this project, with no race and
 *   no plant in the tree itself. Note `-c core.worktree=…` does **not** override it (git resolves
 *   the worktree during setup, before `-c` config is layered) — `--work-tree` does. Verified to
 *   leave a normal checkout and a linked worktree byte-identical. It is **conditional**, for the
 *   reason spelled out above `repoOpts` below: sending it for a path that is not a worktree root
 *   corrupts the tree, and the mutating callers cannot be assumed to pass a root.
 *
 * - **`-c diff.renames=true -c status.renames=true`** — not a leak, a wrong number. These are two
 *   independent keys (`status.renames` merely *defaults* to `diff.renames`), so they can be made
 *   to disagree: with `status.renames=false` the status side reports a move as an add plus a
 *   delete, while `--numstat` still emits one rename record keyed to the new name — so the new
 *   name gets the edit's counts and the deleted old name gets `+0 −0` instead of its lines, and
 *   the summary totals come out short. Pinning both to git's default means the two commands can
 *   never describe the same change differently. Found by the security audit.
 *
 * Pinning them in the two shared helpers rather than per call site is deliberate: the flags that
 * were added per-call before this (`--no-ext-diff`, `--submodule=short`) each had to be added
 * again to the next command someone wrote, and the audit history in `.swe/notes.md` is largely a
 * list of times one was missed.
 */
// `resolve(cwd)` rather than `cwd`: `--work-tree` must be absolute to mean anything. It is
// correct for a relative `cwd` too — Node resolves the `cwd` spawn option against `process.cwd()`
// exactly as `resolve` does, so the two can never name different directories.
//
// **`--work-tree` is only sent when `cwd` is itself a worktree root, and that condition is not
// cosmetic — sending it for a subdirectory corrupts the repository.** Told that a subdirectory is
// the whole working tree, `git checkout`/`pull` move HEAD, write the branch's files *rebased onto
// that subdirectory* (`sub/root.md`, `sub/sub/…`), and leave the real tracked files untouched —
// exit 0, "Switched to branch", and a tree where `git status` then reports every real file as
// modified and a set of phantom duplicates as untracked. Reproduced; a round-two review caught it,
// and my own verification had missed it by only ever testing correctly-rooted directories.
//
// The test mirrors `isGit` in lib/discovery/projects.ts (`existsSync(path/.git)`) so the two agree
// on what a repo root is: a normal checkout has `.git` as a directory, a linked worktree has it as
// a file, and both are roots. Everything that reads (`gitChanges`, `gitBranchInfo`, `gitFileDiff`)
// is already only called when that holds; the mutating helpers reach `memberPath()`
// (lib/workspace.ts), which does *not* check it, so the guard belongs here where no caller can
// miss it rather than in one route. When it doesn't hold, git resolves the worktree itself exactly
// as it did before this change — so a `core.worktree` plant is unmitigated in that one case, which
// is the honest trade: a plant is a hypothetical, silently corrupting someone's checkout is not.
//
// **Exported and reused by `runner/worktree.ts`'s own hardened `git()`, and that reuse is not
// optional.** That file used to carry only `NO_HOOKS`/`gitEnv()` — a second, hand-kept-in-sync
// copy of part of this pin set — and the security audit of the feature-branch merge-back work
// (2026-08-21) found the gap that leaves open: `-c core.fsmonitor=` was missing, and `git
// worktree add` (unlike `branch`, `worktree prune`, or `worktree remove`) *does* invoke a
// planted `core.fsmonitor`, verified live. `ensureFeatureBranch`/`mergeFeatureTask`'s `worktree
// add` calls run against the project's shared checkout automatically on every feature-linked
// task reaching `done` — an unattended trigger, not one that needs a fresh dispatch — which is
// what made this the wrong place to keep a second, narrower pin list.
export function repoOpts(cwd: string): string[] {
  const pins = [
    ...NO_HOOKS,
    "-c",
    "core.fsmonitor=",
    "-c",
    "diff.renames=true",
    "-c",
    "status.renames=true",
  ];
  const abs = resolve(cwd);
  return existsSync(join(abs, ".git")) ? [...pins, `--work-tree=${abs}`] : pins;
}

/**
 * Wall-clock ceiling on a git subprocess, because a repository can make one **never return**.
 *
 * `filter.<driver>.clean` names a shell command git runs over a file's contents, bound to a path by
 * `.gitattributes` *or* `.git/info/attributes`. Measured: it executes on `git diff --numstat HEAD`
 * and on the submodule `git diff` (not on `status` or `show`). These are `execFileSync` calls, so a
 * filter that blocks holds the Node event loop — the process that also serves every SSE task
 * stream — for as long as it likes, with no recovery but a restart. A timeout turns that into a
 * failed request: `git()` already answers "" for a failure, so the page degrades to zero counts.
 *
 * That is a bound on the damage, **not** a fix for the execution itself — see the note in
 * `.swe/notes.md` and the filed backlog item; no flag closes it, because `.git/info/attributes` is
 * untracked, agent-writable, and unaffected by `--attr-source` (which this git is too old for
 * anyway). Verified the mechanism works: a `sleep 30` clean filter is killed at the timeout with
 * `ETIMEDOUT`/`SIGTERM` rather than blocking.
 *
 * The two values differ because the risks do: a local read that takes 30s is already a broken page,
 * while `pull`/`push` are network operations where a slow-but-legitimate transfer is ordinary, and
 * killing one of those mid-flight would be a self-inflicted failure.
 */
export const LOCAL_GIT_TIMEOUT = 30_000;
const NETWORK_GIT_TIMEOUT = 120_000;

function git(cwd: string, args: string[]): string {
  try {
    // Trim only trailing whitespace — leading spaces are significant in
    // `git status --porcelain` (the XY status column starts at column 0).
    return execFileSync("git", [...repoOpts(cwd), ...args], {
      cwd,
      encoding: "utf8",
      env: gitEnv(),
      maxBuffer: 16 * 1024 * 1024,
      timeout: LOCAL_GIT_TIMEOUT,
    }).replace(/\s+$/, "");
  } catch {
    return "";
  }
}

export type GitResult = { ok: boolean; output: string };

/** Run a git command capturing both stdout and stderr (git progress goes to stderr).
 *
 *  Carries `repoOpts` too, and here `--work-tree` guards a *write*: these are `checkout` /
 *  `pull` / `push`, so a planted `core.worktree` would have git materialise the branch's files
 *  into an attacker-chosen directory rather than the project. */
function runGit(cwd: string, args: string[]): GitResult {
  try {
    const out = execFileSync("git", [...repoOpts(cwd), ...args], {
      cwd,
      encoding: "utf8",
      env: gitEnv(),
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 16 * 1024 * 1024,
      timeout: NETWORK_GIT_TIMEOUT,
    });
    return { ok: true, output: out.trim() || "Done." };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message?: string };
    const output =
      [err.stdout, err.stderr].filter(Boolean).join("\n").trim() ||
      err.message ||
      "git command failed";
    return { ok: false, output };
  }
}

function statusLabel(code: string): string {
  if (code.includes("?")) return "untracked";
  switch (code.trim()[0]) {
    case "A":
      return "added";
    case "D":
      return "deleted";
    case "R":
      return "renamed";
    case "C":
      return "copied";
    default:
      return "modified";
  }
}

/**
 * `-z` is on every command below, and it is a correctness fix rather than tidiness.
 *
 * In its default output git *quotes* a path it can't print plainly — C-style, using **named**
 * escapes for `\a \b \f \n \r \t \v \" \\` and **octal** for everything else, non-ASCII bytes
 * included (`"\346\227\245…"`). The old parse tried to undo that with `JSON.parse` — a different
 * format — and, crucially, applied it **only to the status path**, never to the `--numstat` key.
 * Measured, and the two failures are not the same failure:
 * - A name with `"` or a tab is quoted by *both* commands. `JSON.parse` **succeeds** on it, so the
 *   status side became the raw name while the numstat key stayed quoted — the lookup missed and
 *   the file showed `+0 −0`.
 * - A **non-ASCII** name is also quoted by both, but `JSON.parse` **throws** on `\3`, so the raw
 *   quoted string survived on the status side and matched the equally-quoted numstat key. Its
 *   counts were therefore *correct*; what broke was the path itself, which was displayed escaped
 *   and whose diff request resolved to nothing. (An *untracked* non-ASCII file did show `+0`,
 *   because the contained read below was handed that quoted name.)
 * - And every renamed file showed `+0 −0`, since `diff.renames` defaults to on and numstat writes
 *   a rename as the unmatchable `old => new`.
 * (The two commands do also disagree outright — a name with a space is quoted by `status` and not
 * by `--numstat` — but `JSON.parse` handled that one, so it worked.)
 *
 * Under `-z` both commands emit raw, NUL-terminated, never-quoted paths, so there is nothing to
 * unquote — and nothing that varies with `core.quotePath`, which is ordinary repo config. That
 * last part is the same reason `--literal-pathspecs` and `--submodule=short` are pinned on the
 * diff calls: a default output shape is a format, and a repo gets a say in it.
 *
 * Fields are NUL-*terminated*, so the split leaves a trailing empty element. A path is never
 * empty and neither is a `added\tdeleted\t…` record, so dropping empties is safe. (`git()`
 * trims trailing whitespace, which cannot bite here: the last byte of this output is a NUL and
 * `\s` does not match it.)
 */
function nulFields(out: string): string[] {
  return out.split("\0").filter((f) => f !== "");
}

type LineCounts = { added: number; deleted: number };

/** Tracked added/deleted per path, relative to HEAD. */
function trackedLineCounts(cwd: string): Map<string, LineCounts> {
  const counts = new Map<string, LineCounts>();
  const fields = nulFields(
    git(cwd, ["diff", ...NO_CUSTOM_DIFF_DRIVERS, "--numstat", "-z", "HEAD"]),
  );
  for (let i = 0; i < fields.length; i++) {
    const parts = fields[i].split("\t");
    if (parts.length < 3) continue;
    // `added\tdeleted\tpath`, and only the first two tabs are separators — a filename may
    // contain one, which is among the names the old quoted parse got wrong.
    let path = parts.slice(2).join("\t");
    if (path === "") {
      // A rename or copy: the path field is empty and the next two fields hold the old name
      // then the new one. `diff.renames` is on by default, so this is the ordinary shape for a
      // moved file, not an exotic one — it used to arrive as the unmatchable `old => new`.
      path = fields[i + 2] ?? "";
      i += 2;
      // Defensive only, and review established it is unreachable against real git: a `maxBuffer`
      // overflow *throws*, so `git()` returns "" rather than a stream cut mid-record. Kept as a
      // cheap bound so a malformed tail can never set a count under an empty key.
      if (!path) continue;
    }
    const [a, d] = parts;
    counts.set(path, {
      added: a === "-" ? 0 : Number(a) || 0, // "-" is git's marker for a binary file
      deleted: d === "-" ? 0 : Number(d) || 0,
    });
  }
  return counts;
}

/** One `git status` entry: its two-letter code and the path it concerns. */
function statusEntries(cwd: string): { code: string; path: string }[] {
  const entries: { code: string; path: string }[] = [];
  const fields = nulFields(
    git(cwd, ["status", "--porcelain", "-z", "--untracked-files=all"]),
  );
  for (let i = 0; i < fields.length; i++) {
    const rec = fields[i];
    if (rec.length < 4) continue; // "XY p" is the shortest an entry can be
    const code = rec.slice(0, 2);
    // A rename or copy is followed by one more field holding the *old* name (`RM new\0old`).
    // Consuming it is what keeps the old name from being listed as a change of its own — and
    // `R`/`C` can only mean rename/copy, so there is no other code this can swallow.
    if (code.includes("R") || code.includes("C")) i += 1;
    entries.push({ code, path: rec.slice(3) });
  }
  return entries;
}

/** Summarize uncommitted working-tree changes (staged + unstaged + untracked). */
export function gitChanges(cwd: string): GitChanges {
  const lines = trackedLineCounts(cwd);

  const files: FileChange[] = [];
  for (const { code, path } of statusEntries(cwd)) {
    const counts = lines.get(path) ?? { added: 0, deleted: 0 };
    let added = counts.added;
    const deleted = counts.deleted;
    // Only files that will actually be displayed get read. The loop walks every entry
    // `git status` reports, so a project with a large untracked tree (a missing .gitignore
    // over node_modules is the usual way) would otherwise pay a contained read — several
    // syscalls each — for tens of thousands of files it is about to throw away, on the
    // process that also serves the SSE task streams.
    //
    // The cost of the cap: untracked files past `FILE_CAP` contribute 0 to `totalAdded`
    // rather than their real line count. They already contribute nothing to the list, and
    // `truncated` says how many were dropped, so the summary stays readable — but it is an
    // undercount on a tree that large, and that is the deliberate trade.
    if (code.includes("?") && files.length < FILE_CAP) {
      // Untracked: count its lines as additions. The read is contained (lib/safe-read.ts)
      // because `git status` reports an untracked *symlink* as an ordinary entry — following
      // it would leak the line count of whatever it points at, and a FIFO planted in the tree
      // would block this request forever. Anything refused counts as 0, exactly like the
      // binary/unreadable case this already tolerated.
      const read = readFileInside(cwd, path, UNTRACKED_READ_CAP);
      added =
        read.ok && read.content
          ? read.content.replace(/\n$/, "").split("\n").length
          : 0;
    }
    files.push({ path, status: statusLabel(code), added, deleted });
  }

  const totalAdded = files.reduce((s, f) => s + f.added, 0);
  const totalDeleted = files.reduce((s, f) => s + f.deleted, 0);
  const truncated = Math.max(0, files.length - FILE_CAP);

  return { files: files.slice(0, FILE_CAP), totalAdded, totalDeleted, truncated };
}

const DIFF_CAP = 200_000;

/**
 * Unified diff for a single path: working tree vs HEAD, or the whole file if untracked.
 *
 * **git is never allowed to read the working tree here**, and that is the whole design. A
 * Node-side containment check followed by `git diff HEAD -- <path>` is check-then-use with a
 * *process spawn* sitting in the window, and git resolves the path independently of whatever
 * we resolved — so `O_NOFOLLOW`, realpath and `nlink` prove nothing about the file git will
 * open. Measured against the previous version of this function, in a repo where the tracked
 * file is flipped between an honest file and a hard link to an outside secret:
 * **3 leaks in 53 attempts, 20 ms.** (The regression spec in `lib/git.test.ts` is that race,
 * and it fails without this rewrite.)
 *
 * Two shapes were tested and only one of them works, which is worth recording because the
 * backlog item that asked for this fix named the wrong one:
 * - a symlinked *ancestor directory* on a tracked path does **not** leak — git reports the
 *   path as `deleted file mode 100644` rather than following the link. That is why an earlier
 *   audit attacked this at 66k attempts and found nothing.
 * - a **hard link** does leak, immediately. It has no target to resolve, so it is a plain
 *   regular file to every check except `nlink`, and git happily diffs whatever inode it names.
 *
 * So both sides now come from somewhere the caller's path cannot reach at read time: "before"
 * from the object store (`git show HEAD:<path>`), "after" through `readBytesInside`, which
 * decides on a file handle. git still renders the diff — on two files in a private temp
 * directory — so hunk format, binary detection and `\ No newline at end of file` stay exactly
 * as they were rather than being reimplemented here.
 */
export function gitFileDiff(cwd: string, path: string): string {
  // Kept as a cheap pre-filter and to preserve the existing "escaping paths get nothing"
  // answer. It is no longer what makes this safe — every branch below is sound on its own.
  if (escapesOnDisk(cwd, path)) return "";
  const diff = pathDiff(cwd, path);
  return diff.length > DIFF_CAP
    ? `${diff.slice(0, DIFF_CAP)}\n… (diff truncated)`
    : diff;
}

/** How HEAD describes a path. Read from the object store, so it is one thing an attacker
 *  writing in the working tree cannot restate. */
type HeadEntry =
  | { kind: "blob"; mode: string }
  | { kind: "symlink" }
  | { kind: "gitlink" }
  | { kind: "tree" }
  | { kind: "absent" };

function headEntry(cwd: string, path: string): HeadEntry {
  // `--literal-pathspecs` because `path` is a name, not a pattern: without it a leading ":"
  // is pathspec magic (`:/` is the repo root, `:(exclude)…` inverts a match) and `*` globs,
  // so a single request could name a set of files that no containment check ever saw.
  const line = git(cwd, [
    "--literal-pathspecs",
    "ls-tree",
    "HEAD",
    "--",
    path,
  ]).split("\n")[0];
  const [mode, type] = line.split("\t")[0].split(" ");
  if (type === "commit") return { kind: "gitlink" };
  if (type === "tree") return { kind: "tree" };
  if (type !== "blob") return { kind: "absent" }; // includes "no such path" and "no commits yet"
  return mode === "120000" ? { kind: "symlink" } : { kind: "blob", mode };
}

function pathDiff(cwd: string, path: string): string {
  const head = headEntry(cwd, path);
  switch (head.kind) {
    case "blob":
      return trackedDiff(cwd, path, head.mode);
    case "gitlink":
      return submoduleDiff(cwd, path);
    case "absent":
      // Untracked, or staged-but-not-committed: either way HEAD has nothing to diff against,
      // and "every line is an addition" is the right answer for both.
      return untrackedDiff(cwd, path);
    case "tree":
      // A tracked *directory*. `git diff HEAD -- docs` walks it and diffs every file inside,
      // none of which the caller named and none of which `escapesOnDisk` looked at — and
      // `escapesOnDisk` deliberately allows contained directories so submodules keep working.
      // That made a hard link planted at `docs/a.md` leak through a request for `docs` with
      // **no race at all**. This route serves one file; a directory is not one.
      return "";
    case "symlink":
      return symlinkDiff(cwd, path);
  }
}

/** A tracked file: HEAD's blob against a contained read of the working tree. */
function trackedDiff(cwd: string, path: string, headMode: string): string {
  const before = gitShowBytes(cwd, "HEAD", path);
  if (!before) return "";

  const after = readBytesInside(cwd, path, TRACKED_READ_CAP);
  if (!after.ok) {
    // "not-found" is an ordinary deleted file — the diff is served from the object store, so
    // there is still something to render. Anything else (too large, non-regular, hard-linked,
    // escaping) shows nothing, which is how an unreadable file has always been treated here.
    return after.reason === "not-found" ? deletedDiff(path, headMode, before) : "";
  }

  // git records exactly two file modes for a blob, keyed off the owner-execute bit.
  const workMode = after.mode & 0o100 ? "100755" : "100644";
  const modeLines =
    headMode === workMode ? "" : `old mode ${headMode}\nnew mode ${workMode}\n`;
  const start = `diff --git a/${path} b/${path}\n${modeLines}`;

  const body = diffBody(before, after.bytes);
  // A mode-only change is a real diff with no hunks — git prints the two mode lines and
  // nothing else. Without this, `chmod +x` showed as "modified" in the list and then opened
  // an empty diff.
  if (!body) return modeLines ? start.trimEnd() : "";
  if (body.binary)
    return `${start}Binary files a/${path} and b/${path} differ`;
  return `${start}--- a/${path}\n+++ b/${path}\n${body.body}`;
}

/**
 * A committed symlink. To git its content is the target *path*, and the honest "after" side
 * would be `readlink`. **We do not read it**, and that conclusion cost two wrong attempts:
 *
 * - A contained *content* read is wrong: `readBytesInside` follows the link and returns the
 *   target's content, so against HEAD's stored path text it renders a large bogus diff for a
 *   symlink nobody touched.
 * - `readlink` itself is wrong, which is the non-obvious one. It reads no file, but it
 *   *follows the directories above the link*, so pointing an ancestor at a directory outside
 *   the tree makes it return an outside symlink's target. The security re-audit demonstrated
 *   that end to end, including a variant with **no race at all**: `escapesOnDisk` answers
 *   "safe" for a path with nothing on disk (deliberately — that is how a deleted file's diff
 *   is served from the object store), and a *dangling* link behind a swapped ancestor is
 *   exactly that case. Validating the returned target lexically — which is what I tried first
 *   — does not help either: a plain relative target like `secret-name` resolves inside the
 *   root on paper while having been read from outside it.
 *
 * There is no sound version of this in Node: closing it needs the link's parent held as a
 * descriptor (`openat`/`O_PATH`), which Node does not expose, so every route to a symlink's
 * own target is a path the attacker can re-point. Shipping the narrow-but-open race instead
 * would repeat the mistake this whole change exists to correct.
 *
 * So: a symlink that is **gone** still renders its deletion, because that is built purely from
 * HEAD's committed blob and reads nothing from the tree. A symlink that is still there renders
 * nothing. The cost is a *retargeted* committed symlink showing no diff — rare, cosmetic, and
 * the file list still reports it as modified.
 */
function symlinkDiff(cwd: string, path: string): string {
  const before = gitShowBytes(cwd, "HEAD", path);
  if (!before) return "";
  try {
    lstatSync(join(cwd, path));
  } catch {
    // Nothing at that name any more. Whether this call is raced does not matter: the diff it
    // produces is HEAD's own blob, so no working-tree data can reach the response either way.
    return deletedDiff(path, "120000", before);
  }
  return "";
}

function deletedDiff(path: string, headMode: string, before: Buffer): string {
  const start = `diff --git a/${path} b/${path}\ndeleted file mode ${headMode}`;
  const body = diffBody(before, Buffer.alloc(0));
  if (!body) return start; // an empty file that was deleted: a header and no hunks
  if (body.binary)
    return `${start}\nBinary files a/${path} and /dev/null differ`;
  return `${start}\n--- a/${path}\n+++ /dev/null\n${body.body}`;
}

/**
 * The hunks git produces for two blobs we already hold, or null when they are identical.
 *
 * The pair is written into a fresh `mkdtemp` directory (0700, unpredictable name) and diffed
 * with `--no-index`, so the only paths reaching git are ones we just created and nobody else
 * can name. That is what makes reusing `--no-index` safe here after it was removed from the
 * untracked branch: there, the path came from the caller and pointed into a tree an agent can
 * write; here it does not.
 *
 * git's own headers are stripped and rebuilt by the callers against the real path — the temp
 * names must never reach the response.
 */
function diffBody(
  before: Buffer,
  after: Buffer,
): { body: string; binary: boolean } | null {
  // Everything here is failure-tolerant on purpose. This is the only part of the module that
  // *writes* to disk, and the route calls `gitFileDiff` with no try/catch of its own — so a
  // full disk or an unwritable TMPDIR would turn a diff request into an HTML 500 that the
  // modal cannot read. Every other helper in this file already swallows its failures into an
  // empty result; this keeps that contract.
  let dir: string | undefined;
  try {
    dir = mkdtempSync(join(tmpdir(), "platform-diff-"));
    const a = join(dir, "before");
    const b = join(dir, "after");
    writeFileSync(a, before, { mode: 0o600 });
    writeFileSync(b, after, { mode: 0o600 });

    let out: string;
    try {
      out = execFileSync(
        "git",
        [...NO_HOOKS, "diff", ...NO_CUSTOM_DIFF_DRIVERS, "--no-index", "--", a, b],
        {
          cwd: dir,
          encoding: "utf8",
          env: gitEnv(),
          stdio: ["ignore", "pipe", "pipe"],
          maxBuffer: 16 * 1024 * 1024,
          timeout: LOCAL_GIT_TIMEOUT,
        },
      );
    } catch (e) {
      // `--no-index` exits 1 whenever the two files differ, which is the normal case here.
      // The diff itself is on stdout; treating a non-zero exit as failure would return an
      // empty diff for every file that actually changed.
      out = (e as { stdout?: string }).stdout ?? "";
    }

    if (!out.trim()) return null;
    const lines = out.split("\n");
    const at = lines.findIndex((l) => l.startsWith("+++ "));
    // No `+++` header means git classified the pair as binary and declined to render it.
    if (at === -1) return { body: "", binary: true };
    return { body: lines.slice(at + 1).join("\n").replace(/\n+$/, ""), binary: false };
  } catch {
    return null; // no temp dir, no space, no git — no diff, not a 500
  } finally {
    if (dir) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // A temp dir we cannot remove is not a reason to fail the request.
      }
    }
  }
}

/** The only statement a gitlink diff's body may make: which commit the submodule points at.
 *  The leading `-`/`+`/space is required — a bare "Subproject commit" line is not something a
 *  diff body contains. */
const SUBPROJECT_LINE = /^[-+ ]Subproject commit [0-9a-f]{7,64}(-dirty)?$/;

/**
 * Is this really a submodule diff — one that cannot be carrying file content?
 *
 * Checked **positionally, on the body**, and both halves of that are the result of getting it
 * wrong twice:
 * - *Prefix patterns don't work.* The first version allowlisted header shapes by prefix, and
 *   the security audit broke it: git prefixes each added line with one literal `+`, so a
 *   planted file whose lines begin with `++ ` renders as `+++ <text>` and passes as the
 *   `+++ b/…` header. Content came out of `gitFileDiff` dressed as a diff — a spoofing
 *   primitive aimed at whoever reads an approval gate.
 * - *Exact-matching the header against the path doesn't work either.* git appends a trailing
 *   **tab** to `--- a/<path>` when the path contains a space, and C-quotes the whole path when
 *   it isn't ASCII (`diff --git "a/\303\274ni sub" …`). Matching `--- a/${path}` therefore
 *   rejected perfectly ordinary submodules and rendered them blank — the exact regression this
 *   file has already shipped once, when refusing non-regular paths hid every submodule.
 *
 * So the header block is left alone (git builds it from the path and some object ids — there
 * is no file content in it) and everything from the first hunk header onward must be a
 * `Subproject commit` line. A typechange — the case where the worktree entry stopped being a
 * submodule and git renders the replacement file's content — puts a second `diff --git` block
 * after that first `@@`, so it fails here no matter what the replacement file contains.
 */
function isSubmoduleDiff(out: string): boolean {
  const lines = out.split("\n");
  // Content lines are prefixed by git, so a planted `@@ …` line arrives as `+@@ …` and cannot
  // be mistaken for the real hunk header.
  const at = lines.findIndex((l) => l.startsWith("@@ "));
  if (at === -1) return false; // no hunk at all: not something to render as a submodule diff
  const body = lines.slice(at + 1);
  return body.length > 0 && body.every((l) => SUBPROJECT_LINE.test(l));
}

/**
 * A submodule keeps the real `git diff`, because its output is only ever a pair of commit
 * ids — there is no file content for git to read out of the tree, and reimplementing the
 * "Subproject commit" rendering (including `-dirty` and uninitialized submodules) would be
 * strictly worse than letting git say it.
 *
 * The catch is that HEAD saying "gitlink" does not bind the *working tree* to still be one.
 * Replace the submodule directory with a hard link to an outside file and git renders a
 * typechange: gitlink deleted, regular file added — with that file's content. `isSubmoduleDiff`
 * is what refuses that.
 *
 * **`--submodule=short` is as load-bearing as `--no-ext-diff --no-textconv` above, and for the
 * same reason: a repository decides what "diff" means.** `diff.submodule` is ordinary,
 * documented config living in `.git/config` — untracked, shared across every linked worktree,
 * and writable by a task's Bash tool. It changes the output shape entirely:
 * - `= log` prints `Submodule sub aaa..bbb:` with commit subjects and **no `@@` line at all**,
 *   so a real pointer change rendered blank. Found in re-review; that is the same
 *   "everything looks fine, nothing renders" failure this file has now shipped twice.
 * - `= diff` prints the **contents of the files inside the submodule** — content-bearing
 *   output produced entirely by config, no planted file needed.
 * Pinning the format means neither depends on what a repo happens to be configured to do.
 */
function submoduleDiff(cwd: string, path: string): string {
  const out = git(cwd, [
    "--literal-pathspecs",
    "diff",
    ...NO_CUSTOM_DIFF_DRIVERS,
    "--submodule=short",
    "HEAD",
    "--",
    path,
  ]);
  return out && isSubmoduleDiff(out) ? out : "";
}

/**
 * The diff `git diff --no-index /dev/null <path>` used to produce for an untracked file:
 * every line an addition. Synthesized from a contained read rather than asked of git, so no
 * filesystem path crosses into a subprocess. The shape matches git's closely enough for the
 * renderer, which colours lines by their prefix (`components/DiffModal.tsx`).
 */
function untrackedDiff(cwd: string, path: string): string {
  const read = readFileInside(cwd, path, UNTRACKED_READ_CAP);
  if (!read.ok) return "";

  const header = `diff --git a/${path} b/${path}\nnew file mode 100644\n--- /dev/null\n+++ b/${path}`;
  // git reports a NUL-containing file as binary rather than emitting its bytes as "+" lines.
  if (read.content.includes("\0")) return `${header}\nBinary file b/${path} differs`;
  if (read.content === "") return header;

  const endsWithNewline = read.content.endsWith("\n");
  const lines = read.content.replace(/\n$/, "").split("\n");
  const body = lines.map((l) => `+${l}`).join("\n");
  // git writes `@@ -0,0 +1 @@` for a one-line file, not `+1,1` — the count is omitted when it
  // is 1. Nothing parses it (the renderer only colours by prefix), but a one-line new file is
  // about the most common case there is and there is no reason to be subtly wrong about it.
  const span = lines.length === 1 ? "+1" : `+1,${lines.length}`;
  return `${header}\n@@ -0,0 ${span} @@\n${body}${
    endsWithNewline ? "" : "\n\\ No newline at end of file"
  }`;
}

/**
 * Content of one file at a ref (`git show ref:path`), or null when git can't produce it
 * (unknown ref, path not in that tree, not a repo). Used to read a finished parallel task's
 * committed files after its worktree was cleaned up — the branch is what survives.
 * The ref must not start with "-": args go through execFile (no shell), so a leading dash
 * being read as a git option is the one injection left to refuse.
 */
export function gitShowFile(cwd: string, ref: string, path: string): string | null {
  return gitShowBytes(cwd, ref, path)?.toString("utf8") ?? null;
}

/**
 * The same read, undecoded — what the diff path needs, since turning a latin-1 or binary blob
 * into a string first would substitute the bytes it cannot map and then diff a file that
 * never existed.
 *
 * `--no-textconv` is insurance, not a fix for anything observed: `git show <rev>:<path>`
 * dumps the raw blob today (verified), but every other `git diff` in this file carries the
 * flag for a reason — a repo can name a shell command to "render" a file — and this content
 * is shown to a user, so it should not be the one call that depends on git's default.
 */
function gitShowBytes(cwd: string, ref: string, path: string): Buffer | null {
  if (!ref || ref.startsWith("-")) return null;
  try {
    return execFileSync(
      "git",
      [...NO_HOOKS, "show", "--no-textconv", `${ref}:${path}`],
      {
        cwd,
        env: gitEnv(),
        stdio: ["ignore", "pipe", "pipe"],
        maxBuffer: 16 * 1024 * 1024,
        timeout: LOCAL_GIT_TIMEOUT,
      },
    );
  } catch {
    return null;
  }
}

export type BranchInfo = {
  current: string | null;
  branches: string[];
  hasRemote: boolean;
  tracking: string | null;
  ahead: number;
  behind: number;
};

/** Current branch, local branches, and ahead/behind vs. the upstream. */
export function gitBranchInfo(cwd: string): BranchInfo {
  const current = git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]) || null;
  const branches = git(cwd, [
    "for-each-ref",
    "--format=%(refname:short)",
    "refs/heads",
  ])
    .split("\n")
    .filter(Boolean);
  const hasRemote = git(cwd, ["remote"]).length > 0;

  let tracking: string | null = null;
  let ahead = 0;
  let behind = 0;
  const upstream = git(cwd, [
    "rev-parse",
    "--abbrev-ref",
    "--symbolic-full-name",
    "@{upstream}",
  ]);
  if (upstream) {
    tracking = upstream;
    // left-right count: left = upstream-only (behind), right = HEAD-only (ahead)
    const counts = git(cwd, [
      "rev-list",
      "--left-right",
      "--count",
      `${upstream}...HEAD`,
    ]);
    const [b, a] = counts.split(/\s+/).map((n) => Number(n) || 0);
    behind = b ?? 0;
    ahead = a ?? 0;
  }

  return { current, branches, hasRemote, tracking, ahead, behind };
}

export const gitCheckout = (cwd: string, branch: string): GitResult =>
  runGit(cwd, ["checkout", branch]);

export const gitCreateBranch = (cwd: string, branch: string): GitResult =>
  runGit(cwd, ["checkout", "-b", branch]);

/** Fast-forward-only pull, so a divergent history fails loudly instead of auto-merging. */
export const gitPull = (cwd: string): GitResult =>
  runGit(cwd, ["pull", "--ff-only"]);

/** Push the current branch, setting upstream on first push. */
export const gitPush = (cwd: string): GitResult =>
  runGit(cwd, ["push", "-u", "origin", "HEAD"]);

/**
 * Merge `branch` into whatever is checked out at `cwd`, aborting on any failure — a real
 * content conflict, unrelated histories, anything — so a failed attempt never leaves the
 * tree mid-merge (which would make a later `git worktree remove` refuse it as unclean).
 * Used only by the runner's feature-branch merge-back, always against a worktree it owns and
 * discards immediately after; an agent's own git never goes through this.
 *
 * `--no-ff` always leaves a merge commit, so the feature branch's history shows one boundary
 * per merged task branch — without it, the *first* task merged into a fresh feature branch
 * would fast-forward with no merge commit while every later one wouldn't, an inconsistency
 * with nothing to do with the content. `--no-edit` is what keeps this non-interactive (no
 * `$EDITOR` spawned for the merge commit message).
 */
export type MergeResult = GitResult & {
  /** True only for a real *content* conflict: the merge genuinely started and stopped
   *  mid-way needing resolution. False for every other failure — a merge git refused to
   *  start (missing ref, dirty files in the way, unrelated histories), an unsafe ref — so
   *  the caller can tell "needs a human/agent to reconcile" apart from "couldn't be
   *  attempted", which retries. Decided structurally from `MERGE_HEAD` existing *before*
   *  the abort (git creates it only once a merge is underway, and a refused merge never
   *  gets that far), never by parsing git's prose, which is localised and
   *  version-dependent. Deliberately not `ls-files -u` through `runGit`: that helper maps
   *  empty output to "Done.", so an empty unmerged list is indistinguishable from prose —
   *  the exit code of `rev-parse --verify` can't be misread that way. */
  conflict: boolean;
};

export function gitMerge(cwd: string, branch: string): MergeResult {
  if (!branch || branch.startsWith("-")) {
    return { ok: false, conflict: false, output: `refusing to merge an unsafe ref: ${branch}` };
  }
  const result = runGit(cwd, ["merge", "--no-ff", "--no-edit", branch]);
  if (result.ok) return { ...result, conflict: false };
  const inMerge = runGit(cwd, ["rev-parse", "-q", "--verify", "MERGE_HEAD"]);
  runGit(cwd, ["merge", "--abort"]);
  return { ...result, conflict: inMerge.ok };
}
