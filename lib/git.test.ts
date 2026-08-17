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
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gitChanges, gitFileDiff, gitShowFile } from "./git";

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
