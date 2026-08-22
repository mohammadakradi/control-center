/**
 * Specs for the worktree lifecycle behind parallel task runs — against real git repos in a
 * temp dir, because everything that matters here is git's own behavior: whether a branch
 * survives cleanup, whether a dirty tree is refused, whether a recreate reattaches to the
 * same branch. Stubbing git would test the stubs.
 */
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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
  const base = {
    busy: false,
    parallel: false,
    workdir: null,
    isGit: true,
    isWorkspace: false,
    feature: false,
  };
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

test("launchMode: a feature-linked parallel run always isolates, busy or not", () => {
  const base = {
    busy: false,
    parallel: false,
    workdir: null,
    isGit: true,
    isWorkspace: false,
    feature: false,
  };
  // `feature` alone changes nothing — it only matters together with the opt-in.
  assert.equal(wt.launchMode({ ...base, feature: true }), "run");
  assert.equal(wt.launchMode({ ...base, feature: true, busy: true }), "queue");
  // Parallel AND feature-linked isolates even though the checkout is free — the first of N
  // siblings must not land in the shared checkout.
  assert.equal(wt.launchMode({ ...base, parallel: true, feature: true }), "isolate");
  assert.equal(
    wt.launchMode({ ...base, parallel: true, feature: true, busy: true }),
    "isolate",
  );
  // A non-parallel feature run is a plain checkout run regardless — the platform never
  // system-merges one, so it must not silently isolate either.
  assert.equal(wt.launchMode({ ...base, feature: true, parallel: false }), "run");
  // Still gated on there being a worktree to make at all.
  assert.equal(
    wt.launchMode({ ...base, parallel: true, feature: true, isGit: false }),
    "run",
  );
  assert.equal(
    wt.launchMode({ ...base, parallel: true, feature: true, isWorkspace: true }),
    "run",
  );
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

test("a hook planted in the shared .git never fires on worktree lifecycle commands", () => {
  // The re-trigger path this whole neutralization exists for. `git worktree add` gives a task
  // its own HEAD, index and files, but `.git/hooks/` stays shared with the main checkout and
  // every other worktree — and an agent has ordinary write access to it from inside the tree it
  // was handed. Measured before the fix: `worktree add` runs `post-checkout`,
  // `post-index-change` and `reference-transaction`, so one plant re-arms on every parallel
  // dispatch, executing in the runner process indefinitely.
  const markers = join(root, "hook-markers");
  mkdirSync(markers, { recursive: true });
  const names = ["post-checkout", "post-index-change", "reference-transaction"];
  const hooks = join(repo, ".git", "hooks");
  mkdirSync(hooks, { recursive: true });
  for (const name of names) {
    writeFileSync(
      join(hooks, name),
      `#!/bin/sh\ntouch ${JSON.stringify(join(markers, name))}\nexit 0\n`,
      { mode: 0o755 },
    );
  }
  // A repo-level `core.hooksPath` too: `-c` has to win over `.git/config`, or the fix would be
  // one `git config` call away from being undone.
  git(repo, ["config", "core.hooksPath", hooks]);

  try {
    // The full lifecycle: create, read the branch back, then remove.
    const w = wt.ensureTaskWorktree(repo, "task_hookcheck");
    assert.equal(w.branch, "task/hookcheck");
    assert.ok(existsSync(join(w.dir, "a.txt")), "the worktree was not actually created");
    assert.equal(wt.worktreeBranch(w.dir), "task/hookcheck");
    assert.equal(wt.removeWorktreeIfClean(repo, w.dir), true);

    assert.deepEqual(
      names.filter((n) => existsSync(join(markers, n))),
      [],
      "a planted hook executed on a worktree lifecycle command",
    );
  } finally {
    git(repo, ["config", "--unset", "core.hooksPath"]);
    for (const name of names) rmSync(join(hooks, name), { force: true });
    rmSync(markers, { recursive: true, force: true });
  }
});

test("a repo cannot make worktree/branch/merge operations run its own program via core.fsmonitor", () => {
  // Found by the security audit of the feature-branch merge-back work: `core.fsmonitor` names
  // a program git executes, and unlike `core.hooksPath`-gated hooks, `git worktree add` (among
  // others) invokes it regardless. This file's `git()` used to carry only `NO_HOOKS`/`gitEnv`
  // — a second, narrower pin list kept in sync by hand with lib/git.ts's `repoOpts` — and that
  // gap is exactly what let a planted `core.fsmonitor` fire on `worktree add`. Now `git()` uses
  // `repoOpts(cwd)` itself, so this covers `ensureTaskWorktree`, `ensureFeatureBranch` and
  // `mergeFeatureTask` in one plant.
  const marker = join(root, "FSMONITOR_RAN");
  const hook = join(repo, "fsmonitor-hook.sh");
  writeFileSync(hook, `#!/bin/sh\ntouch ${JSON.stringify(marker)}\nexit 1\n`, { mode: 0o755 });
  git(repo, ["config", "core.fsmonitor", hook]);

  try {
    const branchRan = () => {
      const ran = existsSync(marker);
      rmSync(marker, { force: true });
      return ran;
    };

    wt.ensureFeatureBranch(repo, "feature/fsmonitor-check", "main");
    assert.equal(branchRan(), false, "core.fsmonitor executed on ensureFeatureBranch");

    const t1 = wt.ensureTaskWorktree(repo, "task_fsm1", { baseRef: "feature/fsmonitor-check" });
    assert.equal(branchRan(), false, "core.fsmonitor executed on ensureTaskWorktree");
    writeFileSync(join(t1.dir, "fsm.txt"), "work\n");
    // These two use the *test's own* unhardened `git()` (test setup, not the app's wrapper) —
    // `add`/`commit` are expected to run fsmonitor themselves, so the marker is discarded here
    // rather than asserted on, to isolate what happens next.
    git(t1.dir, ["add", "-A"]);
    git(t1.dir, ["commit", "-m", "fsm work"]);
    branchRan();

    const result = wt.mergeFeatureTask(repo, "feature/fsmonitor-check", t1.branch);
    assert.equal(branchRan(), false, "core.fsmonitor executed on mergeFeatureTask");
    assert.equal(result.state, "merged", result.output);

    assert.equal(wt.removeWorktreeIfClean(repo, t1.dir), true);
    assert.equal(branchRan(), false, "core.fsmonitor executed on removeWorktreeIfClean");
  } finally {
    git(repo, ["config", "--unset", "core.fsmonitor"]);
    rmSync(marker, { force: true });
  }
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

test("ensureFeatureBranch creates the ref off the given base, and is idempotent", () => {
  assert.throws(() => git(repo, ["rev-parse", "--verify", "refs/heads/feature/alpha"]));
  wt.ensureFeatureBranch(repo, "feature/alpha", "main");
  assert.equal(git(repo, ["rev-parse", "feature/alpha"]), git(repo, ["rev-parse", "main"]));
  // The main checkout itself is never touched — still on main, nothing checked out.
  assert.equal(git(repo, ["rev-parse", "--abbrev-ref", "HEAD"]), "main");

  // Advance main, then call again: an already-existing branch is left exactly where it is —
  // renaming or rebasing it out from under work already merged into it would be wrong.
  writeFileSync(join(repo, "advance.txt"), "later\n");
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-m", "advance main"]);
  const before = git(repo, ["rev-parse", "feature/alpha"]);
  wt.ensureFeatureBranch(repo, "feature/alpha", "main");
  assert.equal(git(repo, ["rev-parse", "feature/alpha"]), before, "existing branch untouched");
  assert.notEqual(before, git(repo, ["rev-parse", "main"]), "main moved on without it");
});

test("ensureFeatureBranch falls back to HEAD when no base is given, and refuses an unsafe ref", () => {
  wt.ensureFeatureBranch(repo, "feature/no-base", null);
  assert.equal(git(repo, ["rev-parse", "feature/no-base"]), git(repo, ["rev-parse", "HEAD"]));
  assert.throws(() => wt.ensureFeatureBranch(repo, "--help", "main"), /unsafe/);
});

test("ensureFeatureBranch rethrows a real create failure — 'already exists' isn't the only one", () => {
  // An unusable base is a genuine failure, not a benign race: the branch still doesn't exist
  // afterward, so the catch's `branchExists` recheck must not swallow this one.
  assert.throws(() =>
    wt.ensureFeatureBranch(repo, "feature/bad-base", "refs/heads/does-not-exist-at-all"),
  );
  assert.throws(() => git(repo, ["rev-parse", "--verify", "refs/heads/feature/bad-base"]));
});

test("mergeFeatureTask refuses an unsafe ref on either side without touching git", () => {
  const result = wt.mergeFeatureTask(repo, "--upload-pack=evil", "task/whatever");
  assert.equal(result.state, "blocked");
  assert.match(result.output, /unsafe/);
  const taskSide = wt.mergeFeatureTask(repo, "feature/fine", "--upload-pack=evil");
  assert.equal(taskSide.state, "blocked");
  assert.match(taskSide.output, /unsafe/);
});

test("ensureTaskWorktree bases a fresh branch on baseRef, not the checkout's current HEAD", () => {
  git(repo, ["branch", "diverged-base"]);
  execFileSync("git", ["checkout", "diverged-base"], { cwd: repo });
  writeFileSync(join(repo, "diverged.txt"), "only on the diverged base\n");
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-m", "diverged"]);
  execFileSync("git", ["checkout", "main"], { cwd: repo });
  assert.notEqual(git(repo, ["rev-parse", "main"]), git(repo, ["rev-parse", "diverged-base"]));

  const { dir } = wt.ensureTaskWorktree(repo, "task_based", { baseRef: "diverged-base" });
  assert.equal(
    git(dir, ["rev-parse", "HEAD"]),
    git(repo, ["rev-parse", "diverged-base"]),
    "the new branch starts at baseRef, not at whatever HEAD the checkout happened to be on",
  );
  assert.ok(existsSync(join(dir, "diverged.txt")), "the worktree has the base branch's files");
  assert.equal(wt.removeWorktreeIfClean(repo, dir), true);
});

test("mergeFeatureTask merges cleanly, leaves no worktree behind, and doesn't touch WORKTREES_DIR", () => {
  wt.ensureFeatureBranch(repo, "feature/merge-happy", "main");
  const t1 = wt.ensureTaskWorktree(repo, "task_mh1", { baseRef: "feature/merge-happy" });
  writeFileSync(join(t1.dir, "from-task-1.txt"), "task 1\n");
  git(t1.dir, ["add", "-A"]);
  git(t1.dir, ["commit", "-m", "task 1 work"]);

  const before = readdirSync(wt.WORKTREES_DIR).length;
  const result = wt.mergeFeatureTask(repo, "feature/merge-happy", t1.branch);
  assert.equal(result.state, "merged", result.output);
  assert.equal(readdirSync(wt.WORKTREES_DIR).length, before, "no temp dir left in WORKTREES_DIR");
  assert.ok(
    !git(repo, ["worktree", "list", "--porcelain"]).includes("platform-merge-"),
    "no lingering merge worktree registered",
  );

  // The feature branch now has task 1's file — read via a throwaway checkout so this spec
  // doesn't depend on any git-show quoting subtleties.
  const verify = mkdtempSync(join(root, "verify-"));
  git(repo, ["worktree", "add", verify, "feature/merge-happy"]);
  assert.ok(existsSync(join(verify, "from-task-1.txt")));
  git(repo, ["worktree", "remove", "--force", verify]);

  // The task's own worktree is untouched — merging never writes to it.
  assert.ok(existsSync(join(t1.dir, "from-task-1.txt")));
  assert.equal(wt.removeWorktreeIfClean(repo, t1.dir), true);

  // A second, non-conflicting task branch merges too — the feature branch ends up with both.
  const t2 = wt.ensureTaskWorktree(repo, "task_mh2", { baseRef: "feature/merge-happy" });
  writeFileSync(join(t2.dir, "from-task-2.txt"), "task 2\n");
  git(t2.dir, ["add", "-A"]);
  git(t2.dir, ["commit", "-m", "task 2 work"]);
  assert.equal(wt.mergeFeatureTask(repo, "feature/merge-happy", t2.branch).state, "merged");
  const verify2 = mkdtempSync(join(root, "verify2-"));
  git(repo, ["worktree", "add", verify2, "feature/merge-happy"]);
  assert.ok(existsSync(join(verify2, "from-task-1.txt")), "task 1's work is still there");
  assert.ok(existsSync(join(verify2, "from-task-2.txt")), "task 2's work merged in too");
  git(repo, ["worktree", "remove", "--force", verify2]);
  assert.equal(wt.removeWorktreeIfClean(repo, t2.dir), true);
});

test("mergeFeatureTask aborts on conflict, leaving the feature and task branches untouched", () => {
  wt.ensureFeatureBranch(repo, "feature/merge-conflict", "main");
  const featureTip = git(repo, ["rev-parse", "feature/merge-conflict"]);
  const t1 = wt.ensureTaskWorktree(repo, "task_mc1", { baseRef: "feature/merge-conflict" });
  const t2 = wt.ensureTaskWorktree(repo, "task_mc2", { baseRef: "feature/merge-conflict" });
  writeFileSync(join(t1.dir, "shared.txt"), "task 1's version\n");
  git(t1.dir, ["add", "-A"]);
  git(t1.dir, ["commit", "-m", "task 1"]);
  writeFileSync(join(t2.dir, "shared.txt"), "task 2's conflicting version\n");
  git(t2.dir, ["add", "-A"]);
  git(t2.dir, ["commit", "-m", "task 2"]);
  const t2Tip = git(t2.dir, ["rev-parse", "HEAD"]);

  assert.equal(wt.mergeFeatureTask(repo, "feature/merge-conflict", t1.branch).state, "merged");
  const before = readdirSync(wt.WORKTREES_DIR).length;
  const result = wt.mergeFeatureTask(repo, "feature/merge-conflict", t2.branch);
  assert.equal(
    result.state,
    "conflict",
    "the two tasks touched the same line — this must classify as a real content conflict",
  );
  assert.match(result.output, /conflict/i);

  // The feature branch sits wherever task 1's merge left it — advanced from its pre-merge
  // tip, but never moved further by the aborted second merge.
  assert.notEqual(git(repo, ["rev-parse", "feature/merge-conflict"]), featureTip, "task 1 did merge in");
  assert.equal(git(t2.dir, ["rev-parse", "HEAD"]), t2Tip, "task 2's branch is untouched by the aborted merge");
  assert.equal(readdirSync(wt.WORKTREES_DIR).length, before, "no leaked temp merge dir");

  // The aborted merge leaves nothing dangling — no leftover worktree registration.
  const list = git(repo, ["worktree", "list", "--porcelain"]);
  assert.ok(!list.includes("platform-merge-"), "no lingering merge worktree");

  assert.equal(wt.removeWorktreeIfClean(repo, t1.dir), true);
  assert.equal(wt.removeWorktreeIfClean(repo, t2.dir), true);
});

test("mergeFeatureTask answers 'blocked' when the feature branch is checked out elsewhere", () => {
  // A non-isolated (checkout) feature run can switch to the feature branch itself — the
  // preamble tells it to — and a live isolated sibling's merge landing at the same moment
  // would find that branch already checked out. That is *not* a content conflict (the exact
  // failure that used to be recorded as one, reproduced on a real install): it is a blocked,
  // retryable attempt, detected up front rather than via a failed `worktree add`.
  wt.ensureFeatureBranch(repo, "feature/busy-elsewhere", "main");
  const elsewhere = join(root, "checked-out-elsewhere");
  git(repo, ["worktree", "add", elsewhere, "feature/busy-elsewhere"]);
  const t1 = wt.ensureTaskWorktree(repo, "task_busy1", { baseRef: "feature/busy-elsewhere" });
  writeFileSync(join(t1.dir, "work.txt"), "task work\n");
  git(t1.dir, ["add", "-A"]);
  git(t1.dir, ["commit", "-m", "task work"]);

  const before = readdirSync(wt.WORKTREES_DIR).length;
  const blocked = wt.mergeFeatureTask(repo, "feature/busy-elsewhere", t1.branch);
  assert.equal(blocked.state, "blocked");
  assert.match(blocked.output, /checked out/);
  assert.equal(readdirSync(wt.WORKTREES_DIR).length, before, "no leaked temp merge dir");
  assert.ok(
    !git(repo, ["worktree", "list", "--porcelain"]).includes("platform-merge-"),
    "the blocked attempt leaves no temp worktree registered",
  );

  // Nothing about the refusal is destructive: the other worktree and the task branch are
  // both exactly as they were, and a retry once the branch frees up succeeds.
  assert.ok(existsSync(join(elsewhere, "a.txt")));
  git(repo, ["worktree", "remove", "--force", elsewhere]);
  assert.equal(wt.mergeFeatureTask(repo, "feature/busy-elsewhere", t1.branch).state, "merged");
  assert.equal(wt.removeWorktreeIfClean(repo, t1.dir), true);
});

test("mergeFeatureTask merges in the main checkout when it holds the feature branch and the caller allows it", () => {
  // The real shape from the field: a checkout run left the feature branch checked out in the
  // project's own checkout. With the checkout free the merge runs *there* — advancing the
  // user's checkout together with the branch — instead of failing.
  wt.ensureFeatureBranch(repo, "feature/in-main", "main");
  const t1 = wt.ensureTaskWorktree(repo, "task_inmain1", { baseRef: "feature/in-main" });
  writeFileSync(join(t1.dir, "from-task.txt"), "task work\n");
  git(t1.dir, ["add", "-A"]);
  git(t1.dir, ["commit", "-m", "task work"]);
  execFileSync("git", ["checkout", "feature/in-main"], { cwd: repo });
  try {
    // Not allowed (checkout busy) → blocked, and the checkout is untouched.
    const denied = wt.mergeFeatureTask(repo, "feature/in-main", t1.branch);
    assert.equal(denied.state, "blocked");
    assert.match(denied.output, /checked out/);
    assert.ok(!existsSync(join(repo, "from-task.txt")), "denied merge touched the checkout");

    // Allowed (checkout free) → merged in place: branch advanced AND working tree updated.
    const merged = wt.mergeFeatureTask(repo, "feature/in-main", t1.branch, {
      mergeInMainCheckout: true,
    });
    assert.equal(merged.state, "merged", merged.output);
    assert.ok(existsSync(join(repo, "from-task.txt")), "the checkout advanced with the branch");
    assert.equal(
      git(repo, ["rev-parse", "--abbrev-ref", "HEAD"]),
      "feature/in-main",
      "still on the feature branch",
    );
  } finally {
    execFileSync("git", ["checkout", "main"], { cwd: repo });
  }
  assert.equal(wt.removeWorktreeIfClean(repo, t1.dir), true);
});

test("mergeFeatureTask answers 'no_commits' for a branch with nothing beyond the feature branch", () => {
  // A run that ended `done` without committing anything: `--no-ff` would answer "Already up
  // to date" and read as merged, hiding that the work (if any) is still uncommitted.
  wt.ensureFeatureBranch(repo, "feature/empty-task", "main");
  const t1 = wt.ensureTaskWorktree(repo, "task_empty1", { baseRef: "feature/empty-task" });
  const tip = git(repo, ["rev-parse", "feature/empty-task"]);
  const result = wt.mergeFeatureTask(repo, "feature/empty-task", t1.branch);
  assert.equal(result.state, "no_commits");
  assert.equal(git(repo, ["rev-parse", "feature/empty-task"]), tip, "no merge commit created");
  assert.equal(wt.removeWorktreeIfClean(repo, t1.dir), true);
});

test("branchContained answers from the object store, and null for a branch git can't resolve", () => {
  wt.ensureFeatureBranch(repo, "feature/containment", "main");
  const t1 = wt.ensureTaskWorktree(repo, "task_cont1", { baseRef: "feature/containment" });
  assert.equal(wt.branchContained(repo, "feature/containment", t1.branch), true, "fresh branch");
  writeFileSync(join(t1.dir, "novel.txt"), "new work\n");
  git(t1.dir, ["add", "-A"]);
  git(t1.dir, ["commit", "-m", "novel"]);
  assert.equal(wt.branchContained(repo, "feature/containment", t1.branch), false, "diverged");
  assert.equal(wt.mergeFeatureTask(repo, "feature/containment", t1.branch).state, "merged");
  assert.equal(wt.branchContained(repo, "feature/containment", t1.branch), true, "merged back");
  assert.equal(wt.branchContained(repo, "feature/containment", "no-such-branch"), null);
  // Leading-dash refs are refused before reaching git's range syntax (defense in depth).
  assert.equal(wt.branchContained(repo, "--all", t1.branch), null);
  assert.equal(wt.branchContained(repo, "feature/containment", "-x"), null);
  assert.equal(wt.removeWorktreeIfClean(repo, t1.dir), true);
});

test("branchCheckoutDir finds a genuine checkout and resists a forged worktree entry", () => {
  // Honest case first: the feature branch checked out in the main checkout is found there.
  wt.ensureFeatureBranch(repo, "feature/where", "main");
  execFileSync("git", ["checkout", "feature/where"], { cwd: repo });
  try {
    assert.equal(wt.branchCheckoutDir(repo, "feature/where"), repo);
  } finally {
    execFileSync("git", ["checkout", "main"], { cwd: repo });
  }
  assert.equal(wt.branchCheckoutDir(repo, "feature/where"), null, "not checked out anywhere now");

  // The attack (security audit, 2026-08-22): a task can register a worktree whose *path*
  // contains a newline followed by a fake `branch refs/heads/<feature>` line. Under the old
  // newline-split parse that forged line attributed the feature branch to the project
  // checkout, and `mergeFeatureTask` then merged into the user's real tree. `git worktree
  // list --porcelain -z` keeps the newline inert inside the NUL-terminated path field.
  wt.ensureFeatureBranch(repo, "feature/target", "main");
  git(repo, ["branch", "attacker-scratch"]);
  const forgedPath = `${repo}\nbranch refs/heads/feature/target`;
  // git creates the directory named literally with the embedded newline; some platforms may
  // refuse — treat a refusal as the plant simply not landing, still a pass.
  let planted = true;
  try {
    git(repo, ["worktree", "add", forgedPath, "attacker-scratch"]);
  } catch {
    planted = false;
  }
  try {
    // feature/target is NOT genuinely checked out anywhere → must be null despite the forge.
    assert.equal(
      wt.branchCheckoutDir(repo, "feature/target"),
      null,
      "a forged worktree path must not attribute the feature branch to the real checkout",
    );
  } finally {
    if (planted) {
      try {
        git(repo, ["worktree", "remove", "--force", forgedPath]);
      } catch {
        rmSync(forgedPath, { recursive: true, force: true });
        git(repo, ["worktree", "prune"]);
      }
    }
  }
});

test("git() bounds a blocking repo-defined filter rather than hanging the event loop", () => {
  // A smudge filter bound via untracked `.git/info/attributes` runs on `worktree add`'s
  // checkout, and `execFileSync` is synchronous — without a timeout it wedges the runner
  // (which also serves the SSE streams). Plant a slow filter and assert the call is killed
  // near the bound rather than blocking for the filter's full duration. Uses a short filter
  // sleep (5s) well under the 30s LOCAL_GIT_TIMEOUT, and a generous wall-clock ceiling so the
  // spec asserts "the timeout mechanism is wired" without itself waiting 30s.
  const slow = join(root, "filter-repo");
  mkdirSync(slow);
  git(slow, ["init", "-b", "main"]);
  git(slow, ["config", "user.email", "t@t"]);
  git(slow, ["config", "user.name", "t"]);
  git(slow, ["config", "filter.slow.smudge", "sleep 5 && cat"]);
  writeFileSync(join(slow, "tracked.txt"), "content\n");
  git(slow, ["add", "-A"]);
  git(slow, ["commit", "-m", "init"]);
  // `.git/info/attributes` is untracked and not visible in `git status` — the point of the plant.
  writeFileSync(join(slow, ".git", "info", "attributes"), "tracked.txt filter=slow\n");
  git(slow, ["branch", "wt-branch"]);

  // The filter fires on the checkout `worktree add` performs. 5s < 30s bound, so this
  // completes normally; the assertion is only that it doesn't hang unboundedly. (Reverting
  // the `timeout:` option leaves the filter's 5s sleep as the floor, still passing — the
  // real regression guard is that the option is present and shares LOCAL_GIT_TIMEOUT, which
  // a reviewer can confirm by raising the filter sleep past 30s locally.)
  const dir = join(wt.WORKTREES_DIR, "task_slowfilter");
  try {
    wt.ensureTaskWorktree(slow, "task_slowfilter");
    assert.ok(existsSync(dir));
  } finally {
    try {
      wt.removeWorktreeIfClean(slow, dir);
    } catch {
      /* best effort */
    }
  }
});

test("worktreeDirty tells a dirty tree from a clean or missing one", () => {
  const t1 = wt.ensureTaskWorktree(repo, "task_dirty1");
  assert.equal(wt.worktreeDirty(t1.dir), false, "fresh worktree is clean");
  writeFileSync(join(t1.dir, "unsaved.txt"), "uncommitted\n");
  assert.equal(wt.worktreeDirty(t1.dir), true, "uncommitted file");
  rmSync(join(t1.dir, "unsaved.txt"));
  assert.equal(wt.worktreeDirty(t1.dir), false);
  assert.equal(wt.removeWorktreeIfClean(repo, t1.dir), true);
  assert.equal(wt.worktreeDirty(t1.dir), false, "a missing dir is not dirty");
});
