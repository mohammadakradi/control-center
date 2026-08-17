/**
 * Specs for the worktree lifecycle behind parallel task runs — against real git repos in a
 * temp dir, because everything that matters here is git's own behavior: whether a branch
 * survives cleanup, whether a dirty tree is refused, whether a recreate reattaches to the
 * same branch. Stubbing git would test the stubs.
 */
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "platform-worktree-test-"));
// Must be set before ../lib/config (via ./worktree) is imported — WORKTREES_DIR derives
// from DATA_DIR at module load.
process.env.PLATFORM_DATA_DIR = join(root, "data");

type WorktreeMod = typeof import("./worktree");
let wt: WorktreeMod;

const repo = join(root, "repo");

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

before(async () => {
  wt = await import("./worktree");
  assert.ok(
    wt.WORKTREES_DIR.startsWith(root),
    `refusing to run: WORKTREES_DIR is ${wt.WORKTREES_DIR}`,
  );
  mkdirSync(repo);
  git(repo, ["init", "-b", "main"]);
  git(repo, ["config", "user.email", "test@test"]);
  git(repo, ["config", "user.name", "test"]);
  writeFileSync(join(repo, "a.txt"), "hello\n");
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-m", "init"]);
});

after(() => rmSync(root, { recursive: true, force: true }));

test("taskBranch is deterministic and ref-safe", () => {
  assert.equal(wt.taskBranch("task_ab12cd34"), "task/ab12cd34");
  assert.equal(wt.taskBranch("task_ab12cd34"), wt.taskBranch("task_ab12cd34"));
  // Anything that isn't ref-safe is dropped, never passed through to git.
  assert.equal(wt.taskBranch("task_a b~^:?*["), "task/ab");
  assert.equal(wt.taskBranch("task_"), "task/unnamed");
});

test("taskWorktreeDir refuses ids that could escape the worktrees dir", () => {
  assert.throws(() => wt.taskWorktreeDir("../evil"));
  assert.throws(() => wt.taskWorktreeDir("a/b"));
  assert.throws(() => wt.taskWorktreeDir(".."));
  assert.throws(() => wt.taskWorktreeDir("."));
  assert.ok(wt.taskWorktreeDir("task_ok").startsWith(wt.WORKTREES_DIR));
});

test("create → commit inside → branch visible from the main repo", () => {
  const { dir, branch } = wt.ensureTaskWorktree(repo, "task_one");
  assert.ok(existsSync(join(dir, "a.txt")), "worktree has the repo's files");
  assert.equal(git(dir, ["rev-parse", "--abbrev-ref", "HEAD"]), branch);

  // The main checkout is untouched — still on main, index not shared.
  assert.equal(git(repo, ["rev-parse", "--abbrev-ref", "HEAD"]), "main");

  writeFileSync(join(dir, "b.txt"), "from the task\n");
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-m", "task work"]);
  // The commit is reachable from the main repo via the branch.
  assert.equal(git(repo, ["rev-parse", branch]), git(dir, ["rev-parse", "HEAD"]));
});

test("ensure on a live worktree reuses it, including an agent-made branch", () => {
  const first = wt.ensureTaskWorktree(repo, "task_one");
  git(first.dir, ["checkout", "-b", "feat/renamed-by-agent"]);
  const again = wt.ensureTaskWorktree(repo, "task_one");
  assert.equal(again.dir, first.dir);
  assert.equal(again.branch, "feat/renamed-by-agent");
});

test("clean remove succeeds; the branch and its commits survive", () => {
  const { dir, branch } = wt.ensureTaskWorktree(repo, "task_clean");
  writeFileSync(join(dir, "c.txt"), "committed\n");
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-m", "committed work"]);
  const head = git(dir, ["rev-parse", "HEAD"]);

  assert.equal(wt.removeWorktreeIfClean(repo, dir), true);
  assert.ok(!existsSync(dir), "worktree dir is gone");
  assert.equal(git(repo, ["rev-parse", branch]), head, "commits still reachable");
});

test("dirty remove is refused and the tree is preserved", () => {
  const { dir } = wt.ensureTaskWorktree(repo, "task_dirty");
  writeFileSync(join(dir, "uncommitted.txt"), "not shipped yet\n");

  assert.equal(wt.removeWorktreeIfClean(repo, dir), false);
  assert.ok(existsSync(join(dir, "uncommitted.txt")), "uncommitted work untouched");
});

test("launchMode: queueing is the default; isolation needs the opt-in AND a busy checkout", () => {
  const base = { busy: false, parallel: false, workdir: null, isGit: true, isWorkspace: false };
  // The plain cases: free checkout runs, busy checkout queues.
  assert.equal(wt.launchMode(base), "run");
  assert.equal(wt.launchMode({ ...base, busy: true }), "queue");
  // The opt-in only isolates when the checkout is actually busy at launch.
  assert.equal(wt.launchMode({ ...base, parallel: true }), "run");
  assert.equal(wt.launchMode({ ...base, busy: true, parallel: true }), "isolate");
  // A task that ever ran isolated goes back to its worktree — busy or not, flag or not.
  assert.equal(wt.launchMode({ ...base, workdir: "/x" }), "isolate");
  assert.equal(wt.launchMode({ ...base, busy: true, workdir: "/x" }), "isolate");
  // No isolation where no worktree can exist: non-git projects and workspaces.
  for (const noGit of [
    { ...base, busy: true, parallel: true, isGit: false },
    { ...base, busy: true, parallel: true, isWorkspace: true },
    { ...base, busy: true, workdir: "/x", isGit: false },
  ]) {
    assert.equal(wt.launchMode(noGit), "queue");
  }
  assert.equal(wt.launchMode({ ...base, parallel: true, isGit: false }), "run");
});

test("recreate after cleanup follows the STORED branch, not the birth name", () => {
  // The review's repro: the agent switches to its own feature branch mid-run, the clean
  // worktree is reaped at done (finalize stores the real branch), and Continue must come
  // back to that branch — reattaching to task/<id> would resume without the actual work.
  const first = wt.ensureTaskWorktree(repo, "task_moved");
  git(first.dir, ["checkout", "-b", "feat/real-work"]);
  writeFileSync(join(first.dir, "real.txt"), "the actual work\n");
  git(first.dir, ["add", "-A"]);
  git(first.dir, ["commit", "-m", "real work"]);
  const stored = wt.worktreeBranch(first.dir); // what finalize() persists
  assert.equal(stored, "feat/real-work");
  assert.equal(wt.removeWorktreeIfClean(repo, first.dir), true);

  const second = wt.ensureTaskWorktree(repo, "task_moved", { branch: stored });
  assert.equal(second.branch, "feat/real-work");
  assert.ok(existsSync(join(second.dir, "real.txt")), "the committed work came back");
  assert.equal(wt.removeWorktreeIfClean(repo, second.dir), true);

  // A stored branch that no longer exists (or was never set) falls back to the birth name.
  const third = wt.ensureTaskWorktree(repo, "task_moved", { branch: "feat/deleted" });
  assert.equal(third.branch, "task/moved");
  assert.equal(wt.removeWorktreeIfClean(repo, third.dir), true);
  // A stored value that could read as a git option is refused as a ref, not passed through.
  const fourth = wt.ensureTaskWorktree(repo, "task_moved", { branch: "--help" });
  assert.equal(fourth.branch, "task/moved");
});

test("worktreeBranch is null for a detached HEAD, never the literal 'HEAD'", () => {
  // Storing "HEAD" would make a later `git show HEAD:…` read the project checkout's HEAD —
  // a different tree entirely.
  const { dir } = wt.ensureTaskWorktree(repo, "task_detach");
  git(dir, ["checkout", "--detach"]);
  assert.equal(wt.worktreeBranch(dir), null);
});

test("the creation cap refuses loudly; reuse of a live worktree is exempt", () => {
  // Worktrees for task_one/task_dirty/etc. already exist from the tests above, so a cap of
  // 1 is guaranteed to be at/over the limit for any NEW dir.
  assert.throws(
    () => wt.ensureTaskWorktree(repo, "task_capped", { maxWorktrees: 1 }),
    /refusing to create another isolated worktree/,
  );
  assert.ok(!existsSync(wt.taskWorktreeDir("task_capped")), "nothing was created");
  // An existing live worktree is reused regardless of the cap — resuming adds no disk.
  const reused = wt.ensureTaskWorktree(repo, "task_one", { maxWorktrees: 0 });
  assert.ok(existsSync(reused.dir));
});

test("recreate after cleanup reattaches to the surviving branch", () => {
  const first = wt.ensureTaskWorktree(repo, "task_resume");
  writeFileSync(join(first.dir, "d.txt"), "round one\n");
  git(first.dir, ["add", "-A"]);
  git(first.dir, ["commit", "-m", "round one"]);
  assert.equal(wt.removeWorktreeIfClean(repo, first.dir), true);

  const second = wt.ensureTaskWorktree(repo, "task_resume");
  assert.equal(second.dir, first.dir);
  assert.equal(second.branch, first.branch);
  assert.ok(existsSync(join(second.dir, "d.txt")), "committed work came back");
});

test("a leftover dir git doesn't recognise is refused, not deleted", () => {
  const dir = wt.taskWorktreeDir("task_leftover");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "unpushed.txt"), "maybe valuable\n");
  assert.throws(() => wt.ensureTaskWorktree(repo, "task_leftover"), /not a working git worktree/);
  assert.ok(existsSync(join(dir, "unpushed.txt")), "nothing was deleted");
  rmSync(dir, { recursive: true, force: true });
});

test("removeOrphanWorktreeDir deletes only direct children of the worktrees dir", () => {
  const dir = join(wt.WORKTREES_DIR, "task_orphan");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "junk.txt"), "x\n");
  wt.removeOrphanWorktreeDir("task_orphan");
  assert.ok(!existsSync(dir));

  assert.throws(() => wt.removeOrphanWorktreeDir("../outside"));
  assert.throws(() => wt.removeOrphanWorktreeDir("."));
  assert.throws(() => wt.removeOrphanWorktreeDir("a/b"));
});

test("removeOrphanWorktreeDir on a symlink removes the link, not the target", () => {
  const target = join(root, "precious");
  mkdirSync(target, { recursive: true });
  writeFileSync(join(target, "keep.txt"), "keep\n");
  const link = join(wt.WORKTREES_DIR, "task_link");
  execFileSync("ln", ["-s", target, link]);
  wt.removeOrphanWorktreeDir("task_link");
  assert.ok(!existsSync(link));
  assert.ok(existsSync(join(target, "keep.txt")), "target untouched");
});
