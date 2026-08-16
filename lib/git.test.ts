/**
 * Specs for `gitShowFile` — the read path for a finished parallel task's committed files
 * after its worktree is cleaned up. Against a real temp repo: what matters is git's own
 * behavior for refs, missing paths, and the leading-dash guard.
 */
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
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

test("gitChanges counts untracked lines without following a link out of the repo", () => {
  const changes = gitChanges(dirtyRepo);
  const of = (p: string) => changes.files.find((f) => f.path === p);
  assert.equal(of("fresh.md")?.added, 3);
  // The symlink is untracked, so `git status` lists it; counting its lines by following it
  // would report the secret's line count.
  assert.equal(of("leak-file.md")?.added, 0);
  assert.equal(of("leak-hard.md")?.added, 0);
});
