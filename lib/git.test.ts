/**
 * Specs for `gitShowFile` — the read path for a finished parallel task's committed files
 * after its worktree is cleaned up. Against a real temp repo: what matters is git's own
 * behavior for refs, missing paths, and the leading-dash guard.
 */
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import {
  chmodSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  gitBranchInfo,
  gitChanges,
  gitCheckout,
  gitCreateBranch,
  gitFileDiff,
  gitMerge,
  gitPull,
  gitPush,
  gitShowFile,
  gitEnv,
  NO_HOOKS,
} from "./git";

const root = mkdtempSync(join(tmpdir(), "platform-git-test-"));
const repo = join(root, "repo");

const git = (args: string[]) =>
  execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();

before(() => {
  mkdirSync(repo);
  git(["init", "-b", "main"]);
  git(["config", "user.email", "test@test"]);
  git(["config", "user.name", "test"]);
  writeFileSync(join(repo, "doc.md"), "on main\n");
  git(["add", "-A"]);
  git(["commit", "-m", "init"]);
  git(["checkout", "-b", "task/abc123"]);
  writeFileSync(join(repo, "doc.md"), "on the task branch\n");
  writeFileSync(join(repo, "only-on-branch.md"), "branch-only file\n");
  git(["add", "-A"]);
  git(["commit", "-m", "task work"]);
  git(["checkout", "main"]);
});

after(() => rmSync(root, { recursive: true, force: true }));

test("reads a file at a branch that isn't checked out", () => {
  assert.equal(gitShowFile(repo, "task/abc123", "doc.md"), "on the task branch\n");
  assert.equal(gitShowFile(repo, "task/abc123", "only-on-branch.md"), "branch-only file\n");
  assert.equal(gitShowFile(repo, "main", "doc.md"), "on main\n");
});

test("unknown ref, missing path, or non-repo cwd → null, never a throw", () => {
  assert.equal(gitShowFile(repo, "task/nope", "doc.md"), null);
  assert.equal(gitShowFile(repo, "task/abc123", "not-there.md"), null);
  assert.equal(gitShowFile(root, "main", "doc.md"), null);
});

test("a ref that could read as a git option is refused", () => {
  assert.equal(gitShowFile(repo, "--help", "doc.md"), null);
  assert.equal(gitShowFile(repo, "-", "doc.md"), null);
  assert.equal(gitShowFile(repo, "", "doc.md"), null);
});

/**
 * `gitFileDiff` / `gitChanges` against a repo with the three escapes planted in it. Worth
 * stating why this isn't redundant with the safe-read specs: git's own symlink handling
 * differs per branch, so the exposure is narrower than it looks and had to be measured
 * rather than assumed. `--no-index` renders a *plain* symlink as mode 120000 whose content
 * is the target's path — harmless. A symlinked intermediate directory is followed, and the
 * target's real content lands in the diff. That is the case these cover.
 */
const SECRET_LINE = "PRIVATE-KEY-BODY";

let dirtyBase: string;
let dirtyRepo: string;

before(() => {
  dirtyBase = realpathSync(mkdtempSync(join(tmpdir(), "platform-git-diff-")));
  dirtyRepo = join(dirtyBase, "repo");
  const outside = join(dirtyBase, "outside");
  mkdirSync(dirtyRepo);
  mkdirSync(outside);
  writeFileSync(join(outside, "id_rsa"), `${SECRET_LINE}\nsecond\n`);

  const g = (args: string[]) =>
    execFileSync("git", args, { cwd: dirtyRepo, encoding: "utf8" });
  g(["init", "-b", "main"]);
  g(["config", "user.email", "test@test"]);
  g(["config", "user.name", "test"]);
  writeFileSync(join(dirtyRepo, "tracked.md"), "one\n");
  writeFileSync(join(dirtyRepo, "gone.md"), "delete me\n");
  g(["add", "-A"]);
  g(["commit", "-m", "init"]);

  writeFileSync(join(dirtyRepo, "tracked.md"), "one\ntwo\n"); // modified
  rmSync(join(dirtyRepo, "gone.md")); // deleted
  writeFileSync(join(dirtyRepo, "fresh.md"), "a\nb\nc\n"); // untracked
  symlinkSync(join(outside, "id_rsa"), join(dirtyRepo, "leak-file.md"));
  symlinkSync(outside, join(dirtyRepo, "leak-dir"));
  linkSync(join(outside, "id_rsa"), join(dirtyRepo, "leak-hard.md"));
});

after(() => rmSync(dirtyBase, { recursive: true, force: true }));

test("gitFileDiff still produces the diffs it is actually for", () => {
  assert.match(gitFileDiff(dirtyRepo, "tracked.md"), /\+two/);
  assert.match(gitFileDiff(dirtyRepo, "fresh.md"), /\+a/);
  // A deleted file has nothing on disk — git reads it from the object store, so the guard
  // must not mistake "absent" for "escaping".
  assert.match(gitFileDiff(dirtyRepo, "gone.md"), /-delete me/);
});

test("gitFileDiff refuses paths that escape the repo on disk", () => {
  for (const p of ["leak-file.md", "leak-dir/id_rsa", "leak-hard.md", "../outside/id_rsa"]) {
    const diff = gitFileDiff(dirtyRepo, p);
    assert.equal(diff.includes(SECRET_LINE), false, `${p} leaked content`);
    assert.equal(diff, "", `${p} should produce no diff`);
  }
});

test("an untracked file's diff is synthesized, not asked of `--no-index`", () => {
  // The shape has to stay close enough for components/DiffModal.tsx, which colours by prefix.
  const diff = gitFileDiff(dirtyRepo, "fresh.md");
  assert.match(diff, /^diff --git a\/fresh\.md b\/fresh\.md$/m);
  assert.match(diff, /^--- \/dev\/null$/m);
  assert.match(diff, /^\+\+\+ b\/fresh\.md$/m);
  assert.match(diff, /^@@ -0,0 \+1,3 @@$/m);
  assert.equal(diff.includes("+a\n+b\n+c"), true);
});

test("untracked diff edge cases: empty, no trailing newline, binary", () => {
  writeFileSync(join(dirtyRepo, "empty.md"), "");
  assert.equal(gitFileDiff(dirtyRepo, "empty.md").includes("@@"), false);

  writeFileSync(join(dirtyRepo, "noeol.md"), "one\ntwo");
  const noeol = gitFileDiff(dirtyRepo, "noeol.md");
  assert.match(noeol, /^@@ -0,0 \+1,2 @@$/m);
  assert.match(noeol, /\\ No newline at end of file$/);

  writeFileSync(join(dirtyRepo, "bin.dat"), Buffer.from([0x41, 0x00, 0x42]));
  assert.match(gitFileDiff(dirtyRepo, "bin.dat"), /Binary file b\/bin\.dat differs/);

  for (const f of ["empty.md", "noeol.md", "bin.dat"])
    rmSync(join(dirtyRepo, f), { force: true });
});

test("a one-line untracked file uses git's `+1` hunk span, not `+1,1`", () => {
  writeFileSync(join(dirtyRepo, "one.md"), "onlyline\n");
  assert.match(gitFileDiff(dirtyRepo, "one.md"), /^@@ -0,0 \+1 @@$/m);
  rmSync(join(dirtyRepo, "one.md"), { force: true });
});

test("a repo cannot make `git diff` run its own command", () => {
  // `diff.<name>.textconv` names a shell command git runs to render a file. The command
  // lives in `.git/config` and the binding can live in `.git/info/attributes` — neither is
  // tracked, so neither appears in `git status`, a review, or a clone. Both are ordinary
  // writes inside a repo, which is what a task's Bash tool has in its own worktree.
  const marker = join(dirtyBase, "PWNED");
  const g = (args: string[]) =>
    execFileSync("git", args, { cwd: dirtyRepo, encoding: "utf8" });
  g(["config", "diff.pwn.textconv", `sh -c 'touch ${marker}; cat'`]);
  writeFileSync(join(dirtyRepo, ".git", "info", "attributes"), "tracked.md diff=pwn\n");

  try {
    const diff = gitFileDiff(dirtyRepo, "tracked.md"); // tracked + modified: the driver's path
    assert.equal(existsSync(marker), false, "the planted diff driver executed");
    assert.match(diff, /\+two/, "the real diff should still be produced");
  } finally {
    g(["config", "--unset", "diff.pwn.textconv"]);
    rmSync(join(dirtyRepo, ".git", "info", "attributes"), { force: true });
    rmSync(marker, { force: true });
  }
});

test("a modified submodule still diffs", () => {
  // Regression: refusing every non-regular path made `escapesOnDisk` reject a submodule —
  // a plain directory inside the repo — so every submodule silently showed no diff.
  const sub = join(dirtyBase, "sub-origin");
  mkdirSync(sub);
  const g = (cwd: string, args: string[]) =>
    execFileSync("git", args, { cwd, encoding: "utf8" });
  g(sub, ["init", "-b", "main"]);
  g(sub, ["config", "user.email", "test@test"]);
  g(sub, ["config", "user.name", "test"]);
  writeFileSync(join(sub, "a.txt"), "one\n");
  g(sub, ["add", "-A"]);
  g(sub, ["commit", "-m", "one"]);

  const host = join(dirtyBase, "host");
  mkdirSync(host);
  g(host, ["init", "-b", "main"]);
  g(host, ["config", "user.email", "test@test"]);
  g(host, ["config", "user.name", "test"]);
  g(host, ["-c", "protocol.file.allow=always", "submodule", "add", sub, "sub"]);
  g(host, ["commit", "-m", "add submodule"]);

  // Move the submodule's pointer — `git status` in the host now reports " M sub".
  writeFileSync(join(sub, "a.txt"), "two\n");
  g(sub, ["commit", "-am", "two"]);
  g(join(host, "sub"), ["fetch", "origin"]);
  g(join(host, "sub"), ["reset", "--hard", "origin/main"]);

  assert.match(gitFileDiff(host, "sub"), /Subproject commit/);
});

/**
 * The tracked-file branch: git must never read the working tree to build a diff.
 *
 * These are the specs for that rewrite, and the two attack shapes below are the reason it
 * exists. Both were reproduced against the previous implementation before it was changed —
 * the race in 20 ms, the directory one on the first try.
 */
let tBase: string;
let tRepo: string;

before(() => {
  tBase = realpathSync(mkdtempSync(join(tmpdir(), "platform-git-tracked-")));
  tRepo = join(tBase, "repo");
  mkdirSync(join(tBase, "out"));
  writeFileSync(join(tBase, "out", "id_rsa"), `${SECRET_LINE}\nsecond\n`);

  const g = (args: string[]) =>
    execFileSync("git", args, { cwd: tRepo, encoding: "utf8" });
  mkdirSync(join(tRepo, "docs"), { recursive: true });
  g(["init", "-b", "main"]);
  g(["config", "user.email", "test@test"]);
  g(["config", "user.name", "test"]);
  writeFileSync(join(tRepo, "racy.md"), "orig\n");
  writeFileSync(join(tRepo, "chmod.md"), "same content\n");
  writeFileSync(join(tRepo, "bin.dat"), Buffer.from([0x41, 0x00, 0x42]));
  writeFileSync(join(tRepo, "latin.md"), Buffer.from([0xff, 0x0a])); // not valid UTF-8
  writeFileSync(join(tRepo, "docs", "a.md"), "one\n");
  writeFileSync(join(tRepo, "docs", "b.md"), "two\n"); // a second link target
  symlinkSync("docs/a.md", join(tRepo, "link.md")); // a committed symlink
  g(["add", "-A"]);
  g(["commit", "-m", "init"]);
});

after(() => rmSync(tBase, { recursive: true, force: true }));

/**
 * The regression this whole change exists for. A background shell flips a tracked file
 * between an honest modification and a hard link to a secret outside the repo, while this
 * loop asks for its diff. `escapesOnDisk` sees the honest file; the old code then spawned
 * `git diff HEAD -- racy.md`, and git opened whatever the name pointed at by then.
 *
 * Unlike the timing test in `safe-read.test.ts`, this one **does** prove its fix: measured at
 * 3 leaks in 53 attempts / 20 ms against the previous implementation, because the window was
 * an entire process spawn rather than a couple of syscalls. If someone reintroduces a
 * worktree read here, this fails within a second.
 */
test("a hard link swapped in mid-diff cannot leak into a tracked file's diff", () => {
  const target = join(tRepo, "racy.md");
  const flip = spawn(
    "sh",
    [
      "-c",
      `while :; do rm -f "${target}"; ln "${join(tBase, "out", "id_rsa")}" "${target}" 2>/dev/null; ` +
        `rm -f "${target}"; printf 'orig\\nmodified\\n' > "${target}"; done`,
    ],
    { stdio: "ignore" },
  );

  try {
    let leaks = 0;
    let real = 0;
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
      const diff = gitFileDiff(tRepo, "racy.md");
      if (diff.includes(SECRET_LINE)) leaks += 1;
      if (diff.includes("+modified")) real += 1;
    }
    assert.equal(leaks, 0, `leaked the outside file ${leaks} time(s)`);
    // Without this the test could pass by refusing every single request.
    assert.ok(real > 0, "no honest diff was ever produced — the race proved nothing");
  } finally {
    flip.kill("SIGKILL");
    rmSync(target, { force: true });
    writeFileSync(target, "orig\n");
  }
});

test("a hard link inside a tracked directory cannot leak through the directory's path", () => {
  // No race in this one. `escapesOnDisk` allows a contained *directory* — it has to, or
  // submodules stop diffing — and `git diff HEAD -- docs` then walked the directory and
  // diffed a file the caller never named and no check ever saw.
  const planted = join(tRepo, "docs", "a.md");
  rmSync(planted, { force: true });
  linkSync(join(tBase, "out", "id_rsa"), planted);
  try {
    assert.equal(gitFileDiff(tRepo, "docs").includes(SECRET_LINE), false);
    assert.equal(gitFileDiff(tRepo, "docs"), "");
  } finally {
    rmSync(planted, { force: true });
    writeFileSync(planted, "one\n");
  }
});

test("a submodule diff that stops being one emits nothing", () => {
  // HEAD saying "gitlink" does not bind the working tree to still be a submodule: put a
  // regular file where the gitlink is and git renders a typechange carrying its content.
  // The output allowlist is what refuses that, so this must not depend on the escape checks —
  // the planted file is an ordinary contained one.
  const host = join(tBase, "gitlink-host");
  mkdirSync(host);
  const g = (args: string[]) =>
    execFileSync("git", args, { cwd: host, encoding: "utf8" });
  g(["init", "-b", "main"]);
  g(["config", "user.email", "test@test"]);
  g(["config", "user.name", "test"]);
  writeFileSync(join(host, "keep.md"), "x\n");
  g(["add", "-A"]);
  g([
    "update-index",
    "--add",
    "--cacheinfo",
    `160000,${"a".repeat(40)},sub`,
  ]);
  g(["commit", "-m", "gitlink"]);

  writeFileSync(join(host, "sub"), "NOT-A-SUBMODULE-CONTENT\n");
  assert.equal(gitFileDiff(host, "sub").includes("NOT-A-SUBMODULE"), false);
  assert.equal(gitFileDiff(host, "sub"), "");

  // The security audit's bypass: git prefixes every added line with one literal "+", so a
  // planted file whose lines start with "++ " renders as "+++ <text>" — which a *prefix*
  // pattern for the "+++ b/…" header waved straight through. Matching whole lines is the fix.
  writeFileSync(
    join(host, "sub"),
    "++ EXFILTRATED-LINE-ONE apikey=AKIA-1234567890\n++ EXFILTRATED-LINE-TWO\n",
  );
  assert.equal(gitFileDiff(host, "sub").includes("EXFILTRATED"), false);
  assert.equal(gitFileDiff(host, "sub"), "");
});

test("a mode-only change still produces a diff", () => {
  // It has no hunks, so a rewrite that only rendered content would show "modified" in the
  // file list and then open an empty diff.
  chmodSync(join(tRepo, "chmod.md"), 0o755);
  try {
    const diff = gitFileDiff(tRepo, "chmod.md");
    assert.match(diff, /^old mode 100644$/m);
    assert.match(diff, /^new mode 100755$/m);
    assert.equal(diff.includes("@@"), false);
  } finally {
    chmodSync(join(tRepo, "chmod.md"), 0o644);
  }
});

test("an unchanged committed symlink produces no diff", () => {
  // A contained read follows the link and returns its target's content, while HEAD holds the
  // target *path* — diffing those two would render a bogus full diff for a file nobody
  // touched.
  //
  // The old implementation failed this for a second reason worth keeping in mind: it read an
  // empty `git diff` as "not tracked" and fell through to the untracked branch, so *any*
  // unchanged tracked file rendered as a brand-new file containing its whole content.
  assert.equal(gitFileDiff(tRepo, "link.md"), "");
});

test("an unchanged tracked file produces no diff", () => {
  assert.equal(gitFileDiff(tRepo, "chmod.md"), "");
});

test("a deleted committed symlink shows a deletion; a retargeted one shows nothing", () => {
  // The deletion is rendered purely from HEAD's committed blob, so no working-tree data can
  // reach it. The retarget is deliberately NOT rendered: the honest "after" side would be
  // `readlink`, which reads no file but follows the directories *above* the link — the
  // security re-audit leaked an outside link's target through exactly that, including with no
  // race at all. Node has no `openat`/`O_PATH`, so there is no way to read a symlink's own
  // target through a handle; a rare blank diff beats an open race. See `symlinkDiff`.
  const link = join(tRepo, "link.md");
  rmSync(link, { force: true });

  const gone = gitFileDiff(tRepo, "link.md");
  assert.match(gone, /^deleted file mode 120000$/m);
  assert.match(gone, /^-docs\/a\.md$/m);

  symlinkSync("docs/b.md", link);
  assert.equal(gitFileDiff(tRepo, "link.md"), "");

  rmSync(link, { force: true });
  symlinkSync("docs/a.md", link); // restore for the other specs
});

test("a symlink behind a swapped ancestor cannot leak an outside link's target", () => {
  // The security re-audit's deterministic proof-of-concept, kept as a spec. `escapesOnDisk`
  // answers "safe" for a path with nothing on disk — deliberately, since that is how a deleted
  // file's diff is served from the object store — and a *dangling* link behind an ancestor
  // pointing outside the tree is exactly that case. Validating the target string lexically
  // does not save it either: a plain relative name resolves inside the root on paper while
  // having been read from outside it.
  const evil = join(tBase, "evil-outside");
  mkdirSync(evil, { recursive: true });
  symlinkSync("SECRET-HOST-PATH-LEAKED", join(evil, "link"));

  const nested = join(tRepo, "nest");
  mkdirSync(nested, { recursive: true });
  writeFileSync(join(nested, "real.md"), "x\n");
  symlinkSync("real.md", join(nested, "link"));
  execFileSync("git", ["add", "-A"], { cwd: tRepo, encoding: "utf8" });
  execFileSync("git", ["commit", "-m", "nested link"], { cwd: tRepo, encoding: "utf8" });

  renameSync(nested, join(tBase, "nest-stash"));
  symlinkSync(evil, nested);
  try {
    const diff = gitFileDiff(tRepo, "nest/link");
    assert.equal(diff.includes("SECRET-HOST-PATH-LEAKED"), false, "leaked the outside target");
  } finally {
    rmSync(nested, { force: true });
    renameSync(join(tBase, "nest-stash"), nested);
  }
});

test("a one-line change in a large tracked file still diffs", () => {
  // Also from review. Capping the *input* at the untracked read cap (2 MB) meant a tiny edit
  // deep inside a big file rendered nothing at all — the old code let git read the file at any
  // size and only ever truncated the rendered output.
  const big = join(tRepo, "big.txt");
  const filler = `${"x".repeat(80)}\n`.repeat(40_000); // ~3.2 MB
  writeFileSync(big, `first line\n${filler}`);
  execFileSync("git", ["add", "big.txt"], { cwd: tRepo, encoding: "utf8" });
  execFileSync("git", ["commit", "-m", "big"], { cwd: tRepo, encoding: "utf8" });
  try {
    writeFileSync(big, `edited first line\n${filler}`);
    const diff = gitFileDiff(tRepo, "big.txt");
    assert.match(diff, /^-first line$/m);
    assert.match(diff, /^\+edited first line$/m);
    assert.ok(diff.length < 1000, `expected a small hunk, got ${diff.length} bytes`);
  } finally {
    rmSync(big, { force: true });
  }
});

test("a tracked file with no trailing newline keeps git's marker", () => {
  writeFileSync(join(tRepo, "chmod.md"), "same content\nno eol");
  try {
    assert.match(gitFileDiff(tRepo, "chmod.md"), /\\ No newline at end of file/);
  } finally {
    writeFileSync(join(tRepo, "chmod.md"), "same content\n");
  }
});

test("a tracked file's bytes are compared as bytes, not through a UTF-8 round trip", () => {
  // HEAD holds 0xff, the working tree now holds 0xfe. Both are invalid UTF-8 and both decode
  // to the *same* replacement character, so a diff built from decoded strings would compare
  // them as equal and report that this file had not changed at all. This is what
  // `readBytesInside` and the undecoded `git show` are for. (The rendered diff still has to
  // be a string — the route returns JSON — so U+FFFD in the *output* is expected.)
  writeFileSync(join(tRepo, "latin.md"), Buffer.from([0xfe, 0x0a]));
  assert.match(gitFileDiff(tRepo, "latin.md"), /^@@ /m);
});

test("a modified tracked binary file diffs as binary", () => {
  writeFileSync(join(tRepo, "bin.dat"), Buffer.from([0x41, 0x00, 0x43]));
  assert.match(gitFileDiff(tRepo, "bin.dat"), /^Binary files a\/bin\.dat and b\/bin\.dat differ$/m);
});

test("a staged but uncommitted file diffs as a new file", () => {
  // HEAD has no entry for it, so it takes the same branch as an untracked file.
  writeFileSync(join(tRepo, "staged.md"), "fresh\n");
  execFileSync("git", ["add", "staged.md"], { cwd: tRepo, encoding: "utf8" });
  const diff = gitFileDiff(tRepo, "staged.md");
  assert.match(diff, /^\+\+\+ b\/staged\.md$/m);
  assert.match(diff, /^\+fresh$/m);
});

test("tracked paths with spaces or non-ASCII are classified from HEAD correctly", () => {
  // `headEntry` parses `git ls-tree`, which C-quotes a non-ASCII path — but only in the field
  // *after* the tab, so splitting on the tab is immune. Worth pinning: a misparse falls through
  // to the "absent" branch, which renders a tracked file as a brand-new one containing its
  // whole content, and it would only ever show up for users with such filenames.
  const names = ["üni.md", "my file.md", "emoji-🎉.md", "sub dir/nested ü.md"];
  mkdirSync(join(tRepo, "sub dir"), { recursive: true });
  for (const n of names) writeFileSync(join(tRepo, n), "one\n");
  execFileSync("git", ["add", "-A"], { cwd: tRepo, encoding: "utf8" });
  execFileSync("git", ["commit", "-m", "odd names"], { cwd: tRepo, encoding: "utf8" });
  for (const n of names) writeFileSync(join(tRepo, n), "one\ntwo\n");

  for (const n of names) {
    const diff = gitFileDiff(tRepo, n);
    assert.match(diff, /^\+two$/m, n);
    assert.equal(diff.includes("new file mode"), false, `${n} misread as untracked`);
  }
});

test("a submodule whose path has a space or non-ASCII still diffs", () => {
  // The false negative the whole-line allowlist introduced, caught before merge: git appends a
  // trailing TAB to `--- a/<path>` when the path contains a space, and C-quotes the path when
  // it is not ASCII (`diff --git "a/\303\274ni sub" …`). Matching the header against the path
  // therefore blanked ordinary submodules — the same class as the bug that once hid every
  // submodule in every project.
  const origin = join(tBase, "sub-origin-2");
  mkdirSync(origin);
  const g = (cwd: string, args: string[]) =>
    execFileSync("git", args, { cwd, encoding: "utf8" });
  g(origin, ["init", "-q", "-b", "main"]);
  g(origin, ["config", "user.email", "t@t"]);
  g(origin, ["config", "user.name", "t"]);
  writeFileSync(join(origin, "a.txt"), "one\n");
  g(origin, ["add", "-A"]);
  g(origin, ["commit", "-qm", "one"]);

  const host = join(tBase, "space-host");
  mkdirSync(host);
  g(host, ["init", "-q", "-b", "main"]);
  g(host, ["config", "user.email", "t@t"]);
  g(host, ["config", "user.name", "t"]);

  for (const name of ["my sub", "üni sub"]) {
    g(host, ["-c", "protocol.file.allow=always", "submodule", "add", origin, name]);
    g(host, ["commit", "-qm", `add ${name}`]);
    writeFileSync(join(origin, "a.txt"), `${name}\n`);
    g(origin, ["commit", "-qam", "move"]);
    g(join(host, name), ["fetch", "-q", "origin"]);
    g(join(host, name), ["reset", "-q", "--hard", "origin/main"]);
    assert.match(gitFileDiff(host, name), /Subproject commit/, name);
  }
});

test("a repo's diff.submodule config cannot change what a submodule diff is", () => {
  // `diff.submodule` is ordinary config in the untracked, worktree-shared `.git/config`, and
  // it rewrites the output wholesale: `log` drops the `@@` line entirely (so a real pointer
  // change rendered blank — caught in re-review) and `diff` prints the *contents of files
  // inside the submodule*. Same class as the textconv driver pinned by NO_CUSTOM_DIFF_DRIVERS.
  const origin = join(tBase, "sub-origin-3");
  mkdirSync(origin);
  const g = (cwd: string, args: string[]) =>
    execFileSync("git", args, { cwd, encoding: "utf8" });
  g(origin, ["init", "-q", "-b", "main"]);
  g(origin, ["config", "user.email", "t@t"]);
  g(origin, ["config", "user.name", "t"]);
  writeFileSync(join(origin, "a.txt"), "one\n");
  g(origin, ["add", "-A"]);
  g(origin, ["commit", "-qm", "one"]);

  const host = join(tBase, "cfg-host");
  mkdirSync(host);
  g(host, ["init", "-q", "-b", "main"]);
  g(host, ["config", "user.email", "t@t"]);
  g(host, ["config", "user.name", "t"]);
  g(host, ["-c", "protocol.file.allow=always", "submodule", "add", origin, "sub"]);
  g(host, ["commit", "-qm", "add sub"]);
  writeFileSync(join(origin, "a.txt"), "SUBMODULE-FILE-CONTENT\n");
  g(origin, ["commit", "-qam", "two"]);
  g(join(host, "sub"), ["fetch", "-q", "origin"]);
  g(join(host, "sub"), ["reset", "-q", "--hard", "origin/main"]);

  for (const mode of ["log", "diff", "short"]) {
    g(host, ["config", "diff.submodule", mode]);
    const diff = gitFileDiff(host, "sub");
    assert.match(diff, /Subproject commit/, `diff.submodule=${mode} rendered nothing`);
    assert.equal(
      diff.includes("SUBMODULE-FILE-CONTENT"),
      false,
      `diff.submodule=${mode} leaked the submodule's file content`,
    );
  }
});

test("gitChanges counts untracked lines without following a link out of the repo", () => {
  const changes = gitChanges(dirtyRepo);
  const of = (p: string) => changes.files.find((f) => f.path === p);
  assert.equal(of("fresh.md")?.added, 3);
  // The symlink is untracked, so `git status` lists it; counting its lines by following it
  // would report the secret's line count.
  assert.equal(of("leak-file.md")?.added, 0);
  assert.equal(of("leak-hard.md")?.added, 0);
});

/**
 * `gitChanges` against paths git does not print plainly.
 *
 * The old parse read `git status --porcelain` and `git diff --numstat HEAD` in their default,
 * *quoted* form and undid the quoting with `JSON.parse` — which is not the format git emits, and
 * which it applied **only to the status path**, never to the numstat key. Measured consequences on
 * default config, and note the first two are different failures rather than one:
 * - A name containing `"` or a tab is quoted by **both** commands, and `JSON.parse` *succeeds* on
 *   those escapes — so the status side became the raw name while the numstat key stayed quoted,
 *   the lookup missed, and the file showed `+0 −0`.
 * - A **non-ASCII** name is quoted by both too, but with **octal** escapes, and `JSON.parse`
 *   *throws* on `\3` — so the quoted string survived on both sides, matched, and the counts were
 *   *correct*. What broke was the path: `ChangesList` displayed `"\346\227\245…"` literally and
 *   clicking it asked the diff route for a name not on disk, which answered with an empty diff.
 *   An *untracked* non-ASCII file did also show `+0`, since the contained line-count read was
 *   handed that quoted name.
 * - A rename is `old => new` in numstat and `new`+`old` in status, and `diff.renames` defaults
 *   to on — so an ordinary `git mv` plus an edit showed `+0 −0`.
 * - A file whose name contains `" -> "` was mis-parsed as a rename.
 *
 * `-z` makes both commands emit raw, NUL-terminated, never-quoted paths, so there is nothing to
 * unquote — and nothing that depends on `core.quotePath`, which is ordinary repo config. That is
 * the same reason `--literal-pathspecs` and `--submodule=short` are pinned on the diff calls:
 * a default output shape is a format, and a repo gets a say in it.
 *
 * The non-ASCII name here is CJK rather than something accented on purpose: `ü` has both an NFC
 * and an NFD spelling, and macOS stores the decomposed one, so a spec using it would pass in the
 * Linux container and fail on a host checkout for a reason that has nothing to do with the code.
 */
test("gitChanges reads paths git quotes: non-ASCII, quotes, tabs, renames", () => {
  const exotic = join(tBase, "exotic");
  mkdirSync(exotic);
  const g = (args: string[]) =>
    execFileSync("git", args, { cwd: exotic, encoding: "utf8" });
  g(["init", "-q", "-b", "main"]);
  g(["config", "user.email", "test@test"]);
  g(["config", "user.name", "test"]);

  const cjk = "日本語.md";
  const quoted = 'quo"te.md';
  const tabbed = "tab\tname.md";
  const arrow = "arrow -> name.md";
  for (const name of [cjk, quoted, tabbed, arrow])
    writeFileSync(join(exotic, name), "one\n");
  writeFileSync(join(exotic, "renamed-from.md"), "one\n");
  g(["add", "-A"]);
  g(["commit", "-qm", "init"]);

  // Each tracked file gains exactly one line, so every count below is 1 added / 0 deleted.
  for (const name of [cjk, quoted, tabbed, arrow])
    writeFileSync(join(exotic, name), "one\ntwo\n");
  g(["mv", "renamed-from.md", "renamed-to.md"]);
  writeFileSync(join(exotic, "renamed-to.md"), "one\ntwo\n");
  // An untracked non-ASCII name too: that side is counted by a contained read keyed on the
  // same parsed path, so a mangled path silently counted 0 there as well.
  writeFileSync(join(exotic, "未追跡.md"), "a\nb\nc\n");

  const changes = gitChanges(exotic);
  const of = (p: string) => changes.files.find((f) => f.path === p);

  for (const name of [cjk, quoted, tabbed, arrow]) {
    const f = of(name);
    assert.ok(f, `${JSON.stringify(name)} is missing from the changes list`);
    assert.equal(f.status, "modified", `${JSON.stringify(name)} status`);
    assert.equal(f.added, 1, `${JSON.stringify(name)} added`);
    assert.equal(f.deleted, 0, `${JSON.stringify(name)} deleted`);
  }

  // The rename is reported under its new name, with the counts of the edit that came with it.
  const moved = of("renamed-to.md");
  assert.ok(moved, "the renamed file is missing from the changes list");
  assert.equal(moved.added, 1);
  // ...and the old name must not appear as an entry of its own: with `-z` it arrives as a
  // second NUL-terminated field of the *same* record, and skipping it is what stops a phantom
  // "renamed-from.md" row from being listed.
  assert.equal(of("renamed-from.md"), undefined);

  assert.equal(of("未追跡.md")?.added, 3);

  // Nothing should carry git's quoting into the response — that string is what reached the UI.
  for (const f of changes.files)
    assert.equal(
      f.path.includes("\\3"),
      false,
      `${f.path} still holds git's octal quoting`,
    );
});

/**
 * The rename/copy record is consumed **by position, not by content**, and this pins that.
 *
 * `git status --porcelain -z` writes a rename as two NUL-terminated fields — `XY new` then the
 * bare old name — so a parser that decided what a field was by *looking* at it would read the old
 * name as an entry of its own. That is a desync bug with a nasty shape: a file can be named
 * `?? evil.md`, so the phantom entry would carry an attacker-chosen status code and path, and
 * every following entry would be misaligned too. Consuming the field by index is what makes the
 * old name's contents irrelevant.
 *
 * The `R`/`C` code test and git's emission of that extra field stay in lockstep across the repo
 * config that governs it, which is the other half of this: `status.renames` is ordinary
 * `.git/config` (writable by a task's Bash tool), and all three settings are covered below.
 */
test("a renamed file is one row, whatever its old name is called", () => {
  const rn = join(tBase, "renames");
  mkdirSync(rn);
  const g = (args: string[]) =>
    execFileSync("git", args, { cwd: rn, encoding: "utf8" });
  g(["init", "-q", "-b", "main"]);
  g(["config", "user.email", "test@test"]);
  g(["config", "user.name", "test"]);
  // An old name that is itself a plausible `git status` record.
  writeFileSync(join(rn, "?? evil.md"), "one\n");
  writeFileSync(join(rn, "plain-src.md"), "one\n");
  writeFileSync(join(rn, "untouched.md"), "one\n");
  g(["add", "-A"]);
  g(["commit", "-qm", "init"]);

  g(["mv", "?? evil.md", "moved.md"]); // -> "R " plus the old name as a second field
  g(["mv", "plain-src.md", "plain-dst.md"]);
  writeFileSync(join(rn, "plain-dst.md"), "one\ntwo\n"); // -> "RM"
  writeFileSync(join(rn, "untouched.md"), "one\ntwo\n"); // an ordinary row after both renames

  const changes = gitChanges(rn);
  const paths = changes.files.map((f) => f.path).sort();
  assert.deepEqual(paths, [
    "moved.md",
    "plain-dst.md",
    "untouched.md",
  ]);
  const of = (p: string) => changes.files.find((f) => f.path === p);
  assert.equal(of("moved.md")?.status, "renamed");
  assert.equal(of("plain-dst.md")?.added, 1);
  // The entry *after* both renames must still be read correctly — a swallowed or un-swallowed
  // field would shift everything below it.
  assert.equal(of("untouched.md")?.status, "modified");
  assert.equal(of("untouched.md")?.added, 1);

  // `status.renames` and `diff.renames` are independent keys that can be set to disagree, which
  // produced wrong counts rather than a leak: `false` on the status side reports a move as an add
  // plus a delete, while `--numstat` still emits one rename record keyed to the new name — so the
  // old name got `+0 −0` instead of its deleted lines and the totals came out short. `repoOpts`
  // pins both, so a repo cannot get a say in it; the result is identical to the default above.
  for (const setting of ["false", "copies"]) {
    g(["config", "status.renames", setting]);
    const underConfig = gitChanges(rn);
    assert.deepEqual(
      underConfig.files.map((f) => f.path).sort(),
      ["moved.md", "plain-dst.md", "untouched.md"],
      `status.renames=${setting} changed what the changes list reports`,
    );
    assert.equal(underConfig.totalAdded, 2, `totals under ${setting}`);
  }
  g(["config", "--unset", "status.renames"]);
});

/**
 * Two more ways a repository decides what git does, both found by the security audit of this
 * change as unverified hypotheses and both reproduced immediately. `.git/config` is untracked,
 * shared across every linked worktree, and an ordinary write for a task's Bash tool.
 */
test("a repo cannot make `git status` run its own program", () => {
  // `core.fsmonitor` names a program git executes. Measured before the fix: it ran on both of
  // `gitChanges`' commands and on the submodule diff. That is code execution in the web server
  // process, triggered by whoever loads the project page — possibly a different user.
  const fs1 = join(tBase, "fsmonitor");
  mkdirSync(fs1);
  const g = (args: string[]) =>
    execFileSync("git", args, { cwd: fs1, encoding: "utf8" });
  g(["init", "-q", "-b", "main"]);
  g(["config", "user.email", "test@test"]);
  g(["config", "user.name", "test"]);
  writeFileSync(join(fs1, "tracked.md"), "one\n");
  g(["add", "-A"]);
  g(["commit", "-qm", "init"]);
  writeFileSync(join(fs1, "tracked.md"), "one\ntwo\n");

  const marker = join(tBase, "FSMONITOR_RAN");
  const hook = join(fs1, "hook.sh");
  writeFileSync(hook, `#!/bin/sh\ntouch ${JSON.stringify(marker)}\nexit 1\n`, {
    mode: 0o755,
  });
  g(["config", "core.fsmonitor", hook]);

  try {
    const changes = gitChanges(fs1);
    assert.equal(existsSync(marker), false, "core.fsmonitor executed");
    // ...and the real answer is still produced, so this is not a "refuse everything" guard.
    assert.equal(
      changes.files.find((f) => f.path === "tracked.md")?.added,
      1,
      "the diff summary should be unchanged by the flag",
    );
    // The file diff path shares the same helper, so it is covered too.
    assert.match(gitFileDiff(fs1, "tracked.md"), /\+two/);
    assert.equal(existsSync(marker), false, "core.fsmonitor executed via the diff");
  } finally {
    g(["config", "--unset", "core.fsmonitor"]);
    rmSync(marker, { force: true });
  }
});

test("a repo cannot redirect the working tree to somewhere else on the host", () => {
  // `core.worktree` points git's working tree at an absolute path. Before the fix, an untracked
  // enumeration of *that* directory was reported as this project's changes — arbitrary
  // directory listings for any path on the host, with no race and no plant inside the tree.
  const wtBase = realpathSync(mkdtempSync(join(tmpdir(), "platform-git-wt-")));
  const repoDir = join(wtBase, "repo");
  const outsideDir = join(wtBase, "outside");
  mkdirSync(repoDir);
  mkdirSync(outsideDir);
  writeFileSync(join(outsideDir, "a-secret-filename.md"), "SECRET\n");

  const g = (args: string[]) =>
    execFileSync("git", args, { cwd: repoDir, encoding: "utf8" });
  g(["init", "-q", "-b", "main"]);
  g(["config", "user.email", "test@test"]);
  g(["config", "user.name", "test"]);
  writeFileSync(join(repoDir, "tracked.md"), "one\n");
  g(["add", "-A"]);
  g(["commit", "-qm", "init"]);
  writeFileSync(join(repoDir, "tracked.md"), "one\ntwo\n");
  g(["config", "core.worktree", outsideDir]);

  try {
    const changes = gitChanges(repoDir);
    const paths = changes.files.map((f) => f.path);
    assert.equal(
      paths.includes("a-secret-filename.md"),
      false,
      "an outside filename was reported as a change in this project",
    );
    // The honest answer for the real tree, unaffected by the plant.
    assert.deepEqual(paths, ["tracked.md"]);
    assert.equal(changes.files[0].added, 1);
  } finally {
    rmSync(wtBase, { recursive: true, force: true });
  }
});

/**
 * The mutating helpers, which had **no coverage at all** before this — and the regression that
 * absence hid.
 *
 * `repoOpts` pins `--work-tree` to guard against a planted `core.worktree`, and `runGit` runs
 * `checkout` / `checkout -b` / `pull` / `push`. Telling git that a *subdirectory* is the entire
 * working tree does not fail — it "succeeds" destructively: HEAD moves, the branch's files are
 * written **rebased into that subdirectory**, and the real tracked files are left at their old
 * content. Exit 0, `Switched to branch 'feature'`, and a tree where every real file then reports as
 * modified with a set of phantom duplicates beside it.
 *
 * That is reachable: `memberPath()` (lib/workspace.ts) resolves a workspace member and, unlike
 * `resolveMembers()`, does **not** check the member has its own `.git` — and it is what
 * `app/api/projects/[id]/git/route.ts` feeds to all four helpers. A member that is just a folder of
 * the parent repo needs no attacker at all. So `repoOpts` sends `--work-tree` only for a real
 * worktree root, and this spec is the reason.
 */
test("a git action in a subdirectory updates the real tree, not a copy of it", () => {
  const nested = join(tBase, "nested");
  mkdirSync(nested);
  const g = (args: string[]) =>
    execFileSync("git", args, { cwd: nested, encoding: "utf8" });
  g(["init", "-q", "-b", "main"]);
  g(["config", "user.email", "test@test"]);
  g(["config", "user.name", "test"]);
  mkdirSync(join(nested, "sub"));
  writeFileSync(join(nested, "root.md"), "root main\n");
  writeFileSync(join(nested, "sub", "f.md"), "sub v1\n");
  g(["add", "-A"]);
  g(["commit", "-qm", "init"]);
  g(["checkout", "-q", "-b", "feature"]);
  writeFileSync(join(nested, "root.md"), "root FEATURE\n");
  writeFileSync(join(nested, "sub", "f.md"), "sub v2\n");
  g(["add", "-A"]);
  g(["commit", "-qm", "feat"]);
  g(["checkout", "-q", "main"]);

  // The cwd is the subdirectory — exactly what a workspace member pointing at a subfolder gives.
  const sub = join(nested, "sub");
  const res = gitCheckout(sub, "feature");
  assert.equal(res.ok, true, `checkout failed: ${res.output}`);

  // The real files must have been updated...
  assert.equal(readFileSync(join(nested, "root.md"), "utf8"), "root FEATURE\n");
  assert.equal(readFileSync(join(sub, "f.md"), "utf8"), "sub v2\n");
  // ...and no phantom duplicates written underneath the subdirectory.
  assert.equal(existsSync(join(sub, "root.md")), false, "a phantom sub/root.md was written");
  assert.equal(existsSync(join(sub, "sub")), false, "a phantom sub/sub/ was written");
  // The tree must be self-consistent: nothing modified, nothing untracked.
  assert.deepEqual(gitChanges(nested).files, []);
});

test("checkout, branch create and pull work from a repo root", () => {
  // The happy path for three of the four `runGit` helpers, which the `--work-tree` pin also
  // changed. `gitPush` is deliberately not exercised: it needs a writable remote, it never touches
  // the working tree (so the pin cannot affect it), and this repo's own hook blocks scripting one.
  const up = join(tBase, "upstream");
  const clone = join(tBase, "clone");
  mkdirSync(up);
  const gu = (args: string[]) =>
    execFileSync("git", args, { cwd: up, encoding: "utf8" });
  gu(["init", "-q", "-b", "main"]);
  gu(["config", "user.email", "test@test"]);
  gu(["config", "user.name", "test"]);
  writeFileSync(join(up, "a.md"), "one\n");
  gu(["add", "-A"]);
  gu(["commit", "-qm", "init"]);
  execFileSync("git", ["clone", "-q", up, clone], { encoding: "utf8" });
  const gc = (args: string[]) =>
    execFileSync("git", args, { cwd: clone, encoding: "utf8" });
  gc(["config", "user.email", "test@test"]);
  gc(["config", "user.name", "test"]);

  assert.equal(gitCreateBranch(clone, "feature/x").ok, true);
  assert.equal(gitBranchInfo(clone).current, "feature/x");
  writeFileSync(join(clone, "a.md"), "one\ntwo\n");
  gc(["add", "-A"]);
  gc(["commit", "-qm", "local work"]);

  // Switching back must actually rewrite the working tree.
  assert.equal(gitCheckout(clone, "main").ok, true);
  assert.equal(readFileSync(join(clone, "a.md"), "utf8"), "one\n");

  // A fast-forward pull must land the upstream commit's content on disk.
  writeFileSync(join(up, "a.md"), "one\nthree\n");
  gu(["add", "-A"]);
  gu(["commit", "-qm", "upstream work"]);
  const pulled = gitPull(clone);
  assert.equal(pulled.ok, true, `pull failed: ${pulled.output}`);
  assert.equal(readFileSync(join(clone, "a.md"), "utf8"), "one\nthree\n");

  // A failure still comes back as a result rather than throwing.
  const bad = gitCheckout(clone, "no/such/branch");
  assert.equal(bad.ok, false);
  assert.match(bad.output, /no\/such\/branch/);
});

test("gitMerge merges cleanly with --no-ff, and aborts cleanly on conflict", () => {
  const base = join(tBase, "merge-base");
  mkdirSync(base);
  const g = (args: string[]) =>
    execFileSync("git", args, { cwd: base, encoding: "utf8" });
  g(["init", "-q", "-b", "main"]);
  g(["config", "user.email", "test@test"]);
  g(["config", "user.name", "test"]);
  writeFileSync(join(base, "shared.md"), "base\n");
  g(["add", "-A"]);
  g(["commit", "-qm", "init"]);
  // Both conflict branches fork from this same commit, before either merge below — so their
  // histories genuinely diverge rather than one trivially containing the other.
  g(["branch", "task/clean"]);
  g(["branch", "task/conflict-a"]);
  g(["branch", "task/conflict-b"]);

  // Clean case: a branch that only adds a new file merges with no conflict.
  g(["checkout", "-q", "task/clean"]);
  writeFileSync(join(base, "new.md"), "added by task\n");
  g(["add", "-A"]);
  g(["commit", "-qm", "clean addition"]);
  g(["checkout", "-q", "main"]);
  const clean = gitMerge(base, "task/clean");
  assert.equal(clean.ok, true, clean.output);
  assert.equal(clean.conflict, false, "a clean merge is not a conflict");
  assert.equal(readFileSync(join(base, "new.md"), "utf8"), "added by task\n");
  // --no-ff always leaves a merge commit, even though this merge could have fast-forwarded —
  // so the feature branch's history shows one boundary per merged task branch consistently.
  assert.match(
    execFileSync("git", ["log", "-1", "--pretty=%s"], { cwd: base, encoding: "utf8" }),
    /^Merge branch 'task\/clean'/,
  );

  // Conflict case: two branches editing the same line of the same file from the same base.
  g(["checkout", "-q", "task/conflict-a"]);
  writeFileSync(join(base, "shared.md"), "task A's version\n");
  g(["add", "-A"]);
  g(["commit", "-qm", "conflict a"]);
  g(["checkout", "-q", "task/conflict-b"]);
  writeFileSync(join(base, "shared.md"), "task B's version\n");
  g(["add", "-A"]);
  g(["commit", "-qm", "conflict b"]);
  g(["checkout", "-q", "main"]);

  assert.equal(gitMerge(base, "task/conflict-a").ok, true);
  assert.equal(readFileSync(join(base, "shared.md"), "utf8"), "task A's version\n");
  const beforeConflict = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: base,
    encoding: "utf8",
  }).trim();

  const conflict = gitMerge(base, "task/conflict-b");
  assert.equal(conflict.ok, false);
  // Classified structurally (unmerged index entries read before the abort), not from git's
  // prose — this is what lets a caller tell "needs reconciling" from "couldn't be attempted".
  assert.equal(conflict.conflict, true, "a real content conflict is flagged as one");
  assert.match(conflict.output, /conflict/i);

  // A failure that never produced unmerged entries is NOT a conflict: merging a branch that
  // doesn't exist fails before any merge starts.
  const missing = gitMerge(base, "task/does-not-exist");
  assert.equal(missing.ok, false);
  assert.equal(missing.conflict, false, "a refused merge must not read as a content conflict");
  // Aborted, not left half-done: HEAD never moved, the file still holds task A's committed
  // content (not conflict markers), and the working tree is clean — so a caller can remove
  // this worktree afterward without `--force` fighting a real mess.
  assert.equal(
    execFileSync("git", ["rev-parse", "HEAD"], { cwd: base, encoding: "utf8" }).trim(),
    beforeConflict,
  );
  assert.equal(readFileSync(join(base, "shared.md"), "utf8"), "task A's version\n");
  assert.equal(
    execFileSync("git", ["status", "--porcelain"], { cwd: base, encoding: "utf8" }).trim(),
    "",
    "working tree is clean after the abort",
  );
});

test("gitMerge refuses a ref that could read as a git option", () => {
  const dir = join(tBase, "merge-unsafe");
  mkdirSync(dir);
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
  const result = gitMerge(dir, "--help");
  assert.equal(result.ok, false);
  assert.equal(result.conflict, false);
  assert.match(result.output, /unsafe/);
});

/**
 * Hooks are the widest form of "a repository decides what git does", and the one that survives
 * worktree isolation: `.git/hooks/` is shared by the main checkout and every linked worktree, so
 * a script written from inside one task's tree runs in the *server* process on everyone else's
 * git command. Nothing about it is tracked, so it appears in no status, diff, review or clone.
 *
 * Measured before the fix, on this git: `checkout` and `worktree add` run `post-checkout`,
 * `push` runs `pre-push`, and every one of them runs `reference-transaction`.
 *
 * These specs are written to fail loudly if `NO_HOOKS`/`GIT_ENV` are removed — each plants a real
 * executable hook and asserts the marker it would create does not exist, *and* that the command
 * still did its job, so "neutralized" can never be satisfied by the command simply failing.
 */
function plantHooks(repoDir: string, markerDir: string, names: string[]): void {
  const hooks = join(repoDir, ".git", "hooks");
  mkdirSync(hooks, { recursive: true });
  for (const name of names) {
    // `touch`, then exit 0: a hook that failed would change git's behavior and could make a
    // spec pass for the wrong reason (the command refused rather than the hook not running).
    writeFileSync(
      join(hooks, name),
      `#!/bin/sh\ntouch ${JSON.stringify(join(markerDir, name))}\nexit 0\n`,
      { mode: 0o755 },
    );
  }
}

function firedHooks(markerDir: string, names: string[]): string[] {
  return names.filter((n) => existsSync(join(markerDir, n)));
}

const HOOKS = ["post-checkout", "pre-push", "post-merge", "reference-transaction"];

test("a repo's hooks never run on a platform-issued git command", () => {
  const hBase = realpathSync(mkdtempSync(join(tmpdir(), "platform-git-hooks-")));
  const remote = join(hBase, "remote.git");
  const work = join(hBase, "work");
  const markers = join(hBase, "markers");
  mkdirSync(markers);

  execFileSync("git", ["init", "-q", "--bare", "-b", "main", remote]);
  const g = (args: string[]) =>
    execFileSync("git", args, { cwd: work, encoding: "utf8" });
  mkdirSync(work);
  g(["init", "-q", "-b", "main"]);
  g(["config", "user.email", "test@test"]);
  g(["config", "user.name", "test"]);
  g(["remote", "add", "origin", remote]);
  writeFileSync(join(work, "a.md"), "one\n");
  g(["add", "-A"]);
  g(["commit", "-qm", "init"]);
  g(["push", "-q", "-u", "origin", "main"]);

  // A branch with real work to merge, prepared *before* the plant (like everything else in
  // this setup) — only `gitMerge` itself, called below, should run with hooks live.
  g(["checkout", "-q", "-b", "feature/merge-hook-check"]);
  writeFileSync(join(work, "c.md"), "merge me\n");
  g(["add", "-A"]);
  g(["commit", "-qm", "mergeable work"]);
  g(["checkout", "-q", "main"]);

  // The plant goes in *after* the setup above, so the fixture's own commands can't trip it.
  plantHooks(work, markers, HOOKS);
  // Belt and braces: a repo-level `core.hooksPath` pointing back at the planted directory. `-c`
  // must win over `.git/config`, or the mitigation would be one `git config` call away.
  g(["config", "core.hooksPath", join(work, ".git", "hooks")]);

  try {
    // Each mutating helper, with a real effect asserted so a silent failure can't pass.
    assert.equal(gitCreateBranch(work, "feature/y").ok, true);
    assert.equal(gitBranchInfo(work).current, "feature/y");

    assert.equal(gitCheckout(work, "main").ok, true);
    assert.equal(gitBranchInfo(work).current, "main");

    const pushed = gitPush(work);
    assert.equal(pushed.ok, true, `push failed: ${pushed.output}`);

    // The pull must have something to fast-forward, or `post-merge` never runs even unmitigated
    // and its place in `HOOKS` is decoration. A second clone supplies the upstream commit.
    // (Measured: an advancing pull fires `post-merge`; an "Already up to date" one does not.)
    const other = join(hBase, "other");
    execFileSync("git", ["clone", "-q", remote, other]);
    const go = (args: string[]) =>
      execFileSync("git", args, { cwd: other, encoding: "utf8" });
    go(["config", "user.email", "test@test"]);
    go(["config", "user.name", "test"]);
    writeFileSync(join(other, "b.md"), "from upstream\n");
    go(["add", "-A"]);
    go(["commit", "-qm", "upstream work"]);
    go(["push", "-q", "origin", "main"]);

    const pulled = gitPull(work);
    assert.equal(pulled.ok, true, `pull failed: ${pulled.output}`);
    assert.equal(
      readFileSync(join(work, "b.md"), "utf8"),
      "from upstream\n",
      "the pull did not actually fast-forward, so post-merge was never in play",
    );

    // `gitMerge` is new: the same claim needs the same proof here, not an inference from
    // sharing `runGit` with `gitPull` above. The branch it merges was prepared before the
    // plant; only this call itself runs with hooks live.
    const merged = gitMerge(work, "feature/merge-hook-check");
    assert.equal(merged.ok, true, `merge failed: ${merged.output}`);
    assert.equal(readFileSync(join(work, "c.md"), "utf8"), "merge me\n");

    // The read paths share `git()`, so they are covered by the same pin.
    writeFileSync(join(work, "a.md"), "one\ntwo\n");
    assert.equal(gitChanges(work).files.length, 1);
    assert.match(gitFileDiff(work, "a.md"), /\+two/);
    assert.equal(gitShowFile(work, "main", "a.md"), "one\n");

    assert.deepEqual(
      firedHooks(markers, HOOKS),
      [],
      "a planted hook executed on a platform-issued git command",
    );
  } finally {
    rmSync(hBase, { recursive: true, force: true });
  }
});

test("config from the environment still reaches git", () => {
  /*
   * The spec for `gitEnv()` itself, and it exists because the obvious version of it was hollow.
   *
   * Passing an explicit `env` risks two regressions that no hook spec would catch: replacing
   * `process.env` instead of spreading it (dropping the container's
   * `GIT_CONFIG_COUNT`/`GIT_CONFIG_KEY_0` gh-credential wiring, so Push breaks for every user),
   * and snapshotting at import instead of reading per call. My first attempt asserted a push to a
   * *local* remote still worked, which tests neither — a local push needs no credential helper,
   * and dropping `PATH` doesn't fail either, because glibc falls back to `confstr(_CS_PATH)` and
   * finds `/usr/bin/git` regardless. A reviewer broke `gitEnv()` in both ways and the suite stayed
   * green.
   *
   * So this uses git's own env-config mechanism — the exact one compose uses — as a positive
   * control: `GIT_CONFIG_COUNT`/`KEY_0`/`VALUE_0` set an `excludesFile` that hides the untracked
   * file. If the spread is dropped, git never sees those vars and the file is reported; if the env
   * is snapshotted at import, git never sees them either, since they are set here at run time.
   * Either regression turns the assertion red. (Verified: env-supplied config is *not* system
   * config, so `GIT_CONFIG_NOSYSTEM=1` leaves it in force — which is what makes it usable here.)
   */
  const eBase = realpathSync(mkdtempSync(join(tmpdir(), "platform-git-env-")));
  const work = join(eBase, "work");
  mkdirSync(work);
  const ge = (args: string[]) =>
    execFileSync("git", args, { cwd: work, encoding: "utf8" });
  ge(["init", "-q", "-b", "main"]);
  ge(["config", "user.email", "test@test"]);
  ge(["config", "user.name", "test"]);
  writeFileSync(join(work, "a.md"), "one\n");
  ge(["add", "-A"]);
  ge(["commit", "-qm", "init"]);
  writeFileSync(join(work, "hidden-by-env.md"), "x\n");

  const excludes = join(eBase, "excludes");
  writeFileSync(excludes, "hidden-by-env.md\n");
  const saved = {
    count: process.env.GIT_CONFIG_COUNT,
    key: process.env.GIT_CONFIG_KEY_0,
    value: process.env.GIT_CONFIG_VALUE_0,
  };
  process.env.GIT_CONFIG_COUNT = "1";
  process.env.GIT_CONFIG_KEY_0 = "core.excludesFile";
  process.env.GIT_CONFIG_VALUE_0 = excludes;
  try {
    // Sanity: without the env reaching git, the file *is* listed — so the assertion below is
    // a real distinction and not a tautology.
    assert.deepEqual(
      gitChanges(work).files.map((f) => f.path),
      [],
      "env-supplied git config never reached the subprocess",
    );
  } finally {
    const restore = (k: string, v: string | undefined) => {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    };
    restore("GIT_CONFIG_COUNT", saved.count);
    restore("GIT_CONFIG_KEY_0", saved.key);
    restore("GIT_CONFIG_VALUE_0", saved.value);
    rmSync(eBase, { recursive: true, force: true });
  }
});

test("push and pull still work with hooks off", () => {
  // The happy path for the two network helpers: repo-level config (`remote.*`) must keep working
  // — only *system* config is dropped. This deliberately no longer claims to test the
  // credential-helper wiring; a push to a local remote doesn't exercise it. See the spec above
  // for the part that actually pins `gitEnv()`.
  const cBase = realpathSync(mkdtempSync(join(tmpdir(), "platform-git-cfg-")));
  const remote = join(cBase, "remote.git");
  const work = join(cBase, "work");
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", remote]);
  const g = (args: string[]) =>
    execFileSync("git", args, { cwd: work, encoding: "utf8" });
  mkdirSync(work);
  g(["init", "-q", "-b", "main"]);
  g(["config", "user.email", "test@test"]);
  g(["config", "user.name", "test"]);
  g(["remote", "add", "origin", remote]);
  writeFileSync(join(cBase, "seed"), "x");

  try {
    writeFileSync(join(work, "a.md"), "one\n");
    g(["add", "-A"]);
    g(["commit", "-qm", "init"]);

    // A remote named only in `.git/config` must still resolve, and the push must land.
    const pushed = gitPush(work);
    assert.equal(pushed.ok, true, `push failed: ${pushed.output}`);
    assert.equal(
      execFileSync("git", ["--git-dir", remote, "rev-parse", "main"], {
        encoding: "utf8",
      }).trim(),
      g(["rev-parse", "HEAD"]).trim(),
      "the push did not reach the remote",
    );

    // And the tracking info the UI renders comes back.
    const info = gitBranchInfo(work);
    assert.equal(info.hasRemote, true);
    assert.equal(info.tracking, "origin/main");
  } finally {
    rmSync(cBase, { recursive: true, force: true });
  }
});

test("machine-wide config cannot hide a file from the changes list", () => {
  /*
   * The spec for the `GIT_CONFIG_NOSYSTEM` half, and the key it pins is deliberately *not*
   * `core.hooksPath`. The first version of this test used exactly that and was worthless: `-c`
   * outranks system config, so the pin in `NO_HOOKS` already defeats a system-level hooksPath and
   * the spec passed with the env var deleted. Caught by reverting each half separately, which is
   * the only way that class of dead spec shows up.
   *
   * `core.excludesFile` is the honest one — nothing `-c`s it away, and its effect is a silent
   * wrong answer rather than an error: a system-level ignore file makes
   * `git status --untracked-files=all` omit matching paths, so the project page reports a clean
   * tree over a directory full of unsaved work. `GIT_CONFIG_SYSTEM` relocates what git treats as
   * the system file so this can run without touching the real one; the platform helper only sees
   * it because `gitEnv()` spreads `process.env` at call time rather than snapshotting at import.
   */
  const sBase = realpathSync(mkdtempSync(join(tmpdir(), "platform-git-sys-")));
  const work = join(sBase, "work");
  mkdirSync(work);

  const g = (args: string[]) =>
    execFileSync("git", args, { cwd: work, encoding: "utf8" });
  g(["init", "-q", "-b", "main"]);
  g(["config", "user.email", "test@test"]);
  g(["config", "user.name", "test"]);
  writeFileSync(join(work, "a.md"), "one\n");
  g(["add", "-A"]);
  g(["commit", "-qm", "init"]);
  writeFileSync(join(work, "untracked-work.md"), "unsaved\n");

  const excludes = join(sBase, "excludes");
  writeFileSync(excludes, "*.md\n");
  const sysConfig = join(sBase, "gitconfig");
  writeFileSync(sysConfig, `[core]\n\texcludesFile = ${excludes}\n`);

  const prev = process.env.GIT_CONFIG_SYSTEM;
  process.env.GIT_CONFIG_SYSTEM = sysConfig;
  try {
    // Sanity: the fixture bites. A plain git call does hide the file.
    assert.equal(
      g(["status", "--porcelain", "--untracked-files=all"]).trim(),
      "",
      "fixture is inert — system config did not hide anything, so the assertion below is empty",
    );

    // Through the platform helper it must still be reported.
    const paths = gitChanges(work).files.map((f) => f.path);
    assert.deepEqual(
      paths,
      ["untracked-work.md"],
      "machine-wide config hid an untracked file from the changes list",
    );
  } finally {
    if (prev === undefined) delete process.env.GIT_CONFIG_SYSTEM;
    else process.env.GIT_CONFIG_SYSTEM = prev;
    rmSync(sBase, { recursive: true, force: true });
  }
});

/**
 * The boundary of what the hook work actually bought, pinned so it can't quietly rot.
 *
 * The security audit of this change reproduced two keys in the *same* "a repository names a
 * program git runs" class that `NO_HOOKS` does **not** cover, both on the `gitPull`/`gitPush`
 * path: `credential.helper` (fires whenever a remote answers 401 — i.e. on any real push) and
 * `core.sshCommand` (fires for an `ssh://` remote, which an attacker can set themselves with
 * `git remote set-url`). Both execute as the server process and inherit its whole environment,
 * `SECRETS_MASTER_KEY` and `GH_TOKEN` included.
 *
 * They are knowingly **not fixed here**, because the one-line pins are worse than the hole:
 * `-c credential.helper=` also clears the container's `GIT_CONFIG_COUNT`-supplied gh helper and
 * any global one (breaking Push for everyone), and `-c core.sshCommand=ssh` equally overrides a
 * legitimate global setting. Both measured. A real fix has to re-inject the helpers we trust.
 *
 * This spec asserts the *current* behavior, so it fails the day someone changes it — at which
 * point the fix is to update this spec and the notes, not to delete it. It deliberately uses a
 * helper that only writes a marker, and a remote that cannot be reached.
 */
test("known-live: a repo-planted credential.helper still runs on push (not fixed)", () => {
  const kBase = realpathSync(mkdtempSync(join(tmpdir(), "platform-git-cred-")));
  const work = join(kBase, "work");
  const marker = join(kBase, "HELPER_RAN");
  mkdirSync(work);
  const g = (args: string[]) =>
    execFileSync("git", args, { cwd: work, encoding: "utf8" });
  g(["init", "-q", "-b", "main"]);
  g(["config", "user.email", "test@test"]);
  g(["config", "user.name", "test"]);
  writeFileSync(join(work, "a.md"), "one\n");
  g(["add", "-A"]);
  g(["commit", "-qm", "init"]);

  // Faking a 401 remote offline is awkward, so this asserts the decisive fact instead: the
  // planted helper survives into git's *resolved* config under the exact flags and env the
  // platform issues. If git can see it, git will run it when a remote asks for credentials.
  g([
    "config",
    "credential.helper",
    `!f() { touch ${marker}; echo username=x; echo password=y; }; f`,
  ]);

  // The dev container must be taken out of the picture, and finding that out was the useful
  // part of writing this. Compose sets `GIT_CONFIG_COUNT=2` with `GIT_CONFIG_KEY_0=
  // credential.helper` and an **empty** value — which resets the helper list — so inside the
  // container a repo-planted *generic* helper is already neutralized, by accident, as a
  // side-effect of wiring up gh. A **native install** (how releases actually run: no compose, no
  // `GIT_CONFIG_*`) has no such thing, and neither does a url-scoped plant. Clearing those vars
  // here is what makes this spec describe a real install rather than this one container.
  const savedEnv = Object.entries(process.env).filter(([k]) =>
    k.startsWith("GIT_CONFIG_"),
  );
  for (const [k] of savedEnv) delete process.env[k];

  try {
    const resolved = execFileSync(
      "git",
      [...NO_HOOKS, "config", "--get", "credential.helper"],
      { cwd: work, encoding: "utf8", env: gitEnv() },
    ).trim();
    assert.match(
      resolved,
      /touch/,
      "credential.helper is now filtered — good; update this spec and .swe/notes/file-reads-and-git.md",
    );
    assert.equal(
      existsSync(marker),
      false,
      "the helper should not have run merely from reading config",
    );
  } finally {
    for (const [k, v] of savedEnv) process.env[k] = v;
    rmSync(kBase, { recursive: true, force: true });
  }
});

test("a path ending in whitespace keeps it", () => {
  // `git()` strips trailing whitespace from a command's output, which was load-bearing for the
  // old newline-delimited parse. It cannot corrupt a `-z` path — the final byte of that output
  // is a NUL and `\s` does not match one — but the two facts sit in different functions, so it
  // is worth a spec rather than a comment.
  const ws = join(tBase, "trailing-ws");
  mkdirSync(ws);
  const g = (args: string[]) =>
    execFileSync("git", args, { cwd: ws, encoding: "utf8" });
  g(["init", "-q", "-b", "main"]);
  g(["config", "user.email", "test@test"]);
  g(["config", "user.name", "test"]);
  const name = "trail space.md ";
  writeFileSync(join(ws, name), "one\n");
  g(["add", "-A"]);
  g(["commit", "-qm", "init"]);
  writeFileSync(join(ws, name), "one\ntwo\n");

  const f = gitChanges(ws).files.find((x) => x.path === name);
  assert.ok(f, "the trailing space was trimmed off the path");
  assert.equal(f.added, 1); // and the counts map still keyed on the untrimmed name
});

/**
 * The bound the tracked-side residual rests on.
 *
 * `gitChanges` takes its tracked counts from a whole-tree `git diff --numstat HEAD`, and that
 * command reads the working tree — so the hard-link plant this file already uses against
 * `gitFileDiff` makes the *summary* report an outside file's line count. Reproduced while
 * investigating: a tracked path hard-linked to a 137-line file outside the repo is reported as
 * `+137 −1`.
 *
 * **That is knowingly not fixed** (2026-08-18; see `.swe/notes/file-reads-and-git.md`). Every sound fix requires us
 * to do the reading ourselves, and added/deleted are *diff* quantities rather than line counts,
 * so it costs either a `git show` subprocess per changed file — on a page that renders on every
 * project view, once per workspace member — or a hand-rolled line-diff whose numbers would
 * disagree with git's for every user. The cheap-looking alternative, post-filtering the numstat
 * map with `escapesOnDisk`, is not a fix at all: that helper answers "safe" for a path with
 * nothing on disk (deliberately — it is how a deleted file's diff is served), so the plant is
 * removed after numstat has read it and the check passes with no timing skill required.
 *
 * What makes that acceptable is strictly that the leak is *two integers*, so this spec pins
 * exactly that: the summary is a path, a status word and two numbers, and never any of the
 * file's bytes. If a content preview is ever added to this list, the residual stops being two
 * integers and this fails.
 *
 * The `+137 −1` assertion below is a characterisation of the accepted leak, not a requirement.
 * If you are here because you closed it: good — update this spec, don't delete it, and move the
 * note in `.swe/notes/file-reads-and-git.md` from "residual" to "fixed".
 */
test("the change summary reports counts, never file content", () => {
  const leakBase = realpathSync(mkdtempSync(join(tmpdir(), "platform-git-sum-")));
  const repoDir = join(leakBase, "repo");
  const outsideDir = join(leakBase, "outside");
  mkdirSync(repoDir);
  mkdirSync(outsideDir);
  const secret = join(outsideDir, "id_rsa");
  writeFileSync(
    secret,
    `${Array.from({ length: 137 }, (_, i) => `${SECRET_LINE}-${i}`).join("\n")}\n`,
  );

  const g = (args: string[]) =>
    execFileSync("git", args, { cwd: repoDir, encoding: "utf8" });
  g(["init", "-q", "-b", "main"]);
  g(["config", "user.email", "test@test"]);
  g(["config", "user.name", "test"]);
  writeFileSync(join(repoDir, "tracked.md"), "one\n");
  g(["add", "-A"]);
  g(["commit", "-qm", "init"]);

  // The plant: a tracked path is now a second name for a file outside the repo. There is no
  // symlink to refuse and no target to resolve — only `nlink` can see it.
  rmSync(join(repoDir, "tracked.md"));
  linkSync(secret, join(repoDir, "tracked.md"));

  try {
    const changes = gitChanges(repoDir);
    const f = changes.files.find((x) => x.path === "tracked.md");
    assert.ok(f, "the planted file should still be listed as changed");

    // No bytes of the outside file may appear anywhere in the response, under any key.
    assert.equal(
      JSON.stringify(changes).includes(SECRET_LINE),
      false,
      "the change summary leaked the outside file's content",
    );
    // ...and the shape stays minimal, which is what keeps the statement above true in future.
    assert.deepEqual(Object.keys(f).sort(), [
      "added",
      "deleted",
      "path",
      "status",
    ]);

    // The accepted residual, stated out loud. See the docstring before changing this.
    assert.equal(f.added, 137, "known residual: numstat read the outside file");
    assert.equal(f.deleted, 1);
  } finally {
    rmSync(leakBase, { recursive: true, force: true });
  }
});
