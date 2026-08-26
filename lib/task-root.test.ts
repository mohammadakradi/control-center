/**
 * Specs for `resolveTaskWorkRoot` — which directory (if any) a task's changes and files should be
 * read from. No database: the function takes the two rows, so the states can be enumerated
 * directly. Real git repos where the distinction is git's, not ours.
 *
 * The load-bearing spec is the last pair. `existsSync(workdir)` is the obvious test for "is the
 * worktree still there" and it is wrong in a way that shows another repository's changes under
 * this task's name; the characterisation test proves that outcome is real rather than theoretical,
 * so nobody simplifies the guard back to an existence check.
 */
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gitChanges } from "./git";
import { resolveTaskWorkRoot } from "./task-root";
import type { Project, Task } from "./db/schema";

const root = mkdtempSync(join(tmpdir(), "platform-task-root-test-"));
/** Stands in for the platform's own checkout, which is where `data/worktrees/` really lives. */
const outer = join(root, "outer");
const worktreesDir = join(outer, "data", "worktrees");
/** A live linked worktree, as `ensureTaskWorktree` would have created it. */
const liveWorktree = join(worktreesDir, "task_live");
/** A directory git does not recognise, sitting inside `outer` exactly as a real one would. */
const staleWorktree = join(worktreesDir, "task_stale");

const git = (cwd: string, args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

/** The real gitdir the live worktree points at — used to build an otherwise-valid pointer. */
const liveWorktreeGitdir = () => join(outer, ".git", "worktrees", "task_live");

const project = (over: Partial<Project> = {}): Project => ({
  id: "p1",
  name: "outer",
  path: outer,
  isGit: true,
  defaultBranch: "main",
  onboarded: true,
  isWorkspace: false,
  members: [],
  createdAt: new Date(0),
  ...over,
});

const task = (over: Partial<Task> = {}): Task => ({
  id: "task_abc",
  projectId: "p1",
  userId: "user_local",
  agentId: "a1",
  featureId: null,
  mergeState: null,
  command: "task",
  agentVersion: null,
  requestText: "do the thing",
  title: null,
  status: "done",
  model: "auto",
  modelReason: null,
  effort: "auto",
  effortReason: null,
  attachments: [],
  sessionId: null,
  branch: null,
  parallel: false,
  workdir: null,
  error: null,
  usageInputTokens: 0,
  usageOutputTokens: 0,
  usageCacheReadTokens: 0,
  usageCacheCreationTokens: 0,
  usageCostUsd: 0,
  createdAt: new Date(0),
  endedAt: null,
  ...over,
});

before(() => {
  mkdirSync(outer);
  git(outer, ["init", "-b", "main"]);
  git(outer, ["config", "user.email", "test@test"]);
  git(outer, ["config", "user.name", "test"]);
  writeFileSync(join(outer, "tracked.md"), "committed\n");
  git(outer, ["add", "-A"]);
  git(outer, ["commit", "-m", "init"]);
  // An uncommitted change in the *enclosing* repo — what must never surface as a task's own.
  writeFileSync(join(outer, "tracked.md"), "edited in the enclosing checkout\n");

  mkdirSync(worktreesDir, { recursive: true });
  git(outer, ["worktree", "add", "-b", "task/live", liveWorktree]);
  mkdirSync(staleWorktree);
  writeFileSync(join(staleWorktree, "left-behind.md"), "orphaned\n");
});

after(() => rmSync(root, { recursive: true, force: true }));

test("no workdir → the project checkout", () => {
  assert.deepEqual(resolveTaskWorkRoot(project(), task()), {
    kind: "checkout",
    cwd: outer,
  });
});

test("a live worktree resolves to itself, not the checkout", () => {
  // A linked worktree carries `.git` as a *file*; the guard has to accept that, not just a dir.
  assert.ok(statSync(join(liveWorktree, ".git")).isFile());
  assert.deepEqual(
    resolveTaskWorkRoot(project(), task({ workdir: liveWorktree, parallel: true })),
    { kind: "worktree", cwd: liveWorktree },
  );
});

test("a removed worktree reports the branch instead of a directory", () => {
  const gone = join(worktreesDir, "task_gone");
  assert.deepEqual(
    resolveTaskWorkRoot(
      project(),
      task({ workdir: gone, branch: "task/gone", parallel: true }),
    ),
    { kind: "worktree-removed", branch: "task/gone" },
  );
});

test("a removed worktree with no stored branch still refuses the checkout", () => {
  // `worktreeBranch` answers null for a detached HEAD, so this row shape is reachable. There
  // is nowhere to read the run's work from — saying so beats showing the checkout's.
  assert.deepEqual(
    resolveTaskWorkRoot(
      project(),
      task({ workdir: join(worktreesDir, "task_detached"), parallel: true }),
    ),
    { kind: "worktree-removed", branch: null },
  );
});

test("a non-git project and a workspace are unavailable, workspace first", () => {
  assert.deepEqual(resolveTaskWorkRoot(project({ isGit: false }), task()), {
    kind: "unavailable",
    reason: "not-git",
  });
  assert.deepEqual(
    resolveTaskWorkRoot(project({ isWorkspace: true }), task()),
    { kind: "unavailable", reason: "workspace" },
  );
  // A workspace project that somehow carries a workdir is still refused: per-member source
  // control is the project page's job, and `gitChanges` on a workspace root is meaningless.
  assert.deepEqual(
    resolveTaskWorkRoot(
      project({ isWorkspace: true }),
      task({ workdir: liveWorktree }),
    ),
    { kind: "unavailable", reason: "workspace" },
  );
});

test("a leftover directory inside an enclosing repo is not a worktree root", () => {
  // The directory exists, so an `existsSync` check would hand it to git as a cwd.
  assert.deepEqual(
    resolveTaskWorkRoot(
      project(),
      task({ workdir: staleWorktree, branch: "task/stale", parallel: true }),
    ),
    { kind: "worktree-removed", branch: "task/stale" },
  );
});

/**
 * Each of these is a bypass the security audit **reproduced** against the first version of the
 * guard, which was `existsSync(dir + "/.git")`. None needs a race: git walks straight past a
 * `.git` that isn't a real pointer and finds the enclosing repo. An agent with Bash can plant any
 * of them inside the worktree it was handed.
 */
test("an empty directory named .git does not make a leftover dir a worktree", () => {
  const dir = join(worktreesDir, "task_emptygit");
  mkdirSync(join(dir, ".git"), { recursive: true });
  assert.equal(
    resolveTaskWorkRoot(project(), task({ workdir: dir })).kind,
    "worktree-removed",
  );
  // And the leak it would have caused is real: git reports `outer` from in there.
  assert.ok(gitChanges(dir).files.length > 0);
});

test("a symlinked .git is judged as the symlink it is, not as its target", () => {
  const dir = join(worktreesDir, "task_symlinkgit");
  mkdirSync(dir, { recursive: true });
  symlinkSync(join(outer, "data"), join(dir, ".git"));
  assert.equal(
    resolveTaskWorkRoot(project(), task({ workdir: dir })).kind,
    "worktree-removed",
  );
});

test("a .git pointer to nowhere, or to another repo, is refused", () => {
  const dangling = join(worktreesDir, "task_dangling");
  mkdirSync(dangling, { recursive: true });
  writeFileSync(join(dangling, ".git"), `gitdir: ${join(root, "nope")}\n`);
  assert.equal(
    resolveTaskWorkRoot(project(), task({ workdir: dangling })).kind,
    "worktree-removed",
  );

  // The retargeted form: a valid pointer at a *different* repository's gitdir. Left unbounded,
  // this route would enumerate that repo under this task's name.
  const other = join(root, "other-repo");
  mkdirSync(other);
  git(other, ["init", "-b", "main"]);
  const retargeted = join(worktreesDir, "task_retargeted");
  mkdirSync(retargeted, { recursive: true });
  writeFileSync(join(retargeted, ".git"), `gitdir: ${join(other, ".git")}\n`);
  assert.equal(
    resolveTaskWorkRoot(project(), task({ workdir: retargeted })).kind,
    "worktree-removed",
  );
});

test("a .git pointer that is huge, or not a pointer at all, is refused", () => {
  const junk = join(worktreesDir, "task_junk");
  mkdirSync(junk, { recursive: true });
  writeFileSync(join(junk, ".git"), "this is not a gitdir pointer\n");
  assert.equal(
    resolveTaskWorkRoot(project(), task({ workdir: junk })).kind,
    "worktree-removed",
  );
  // Oversized: refused on the size alone, so the read is always bounded.
  writeFileSync(join(junk, ".git"), `gitdir: ${liveWorktreeGitdir()}\n${"x".repeat(8192)}`);
  assert.equal(
    resolveTaskWorkRoot(project(), task({ workdir: junk })).kind,
    "worktree-removed",
  );
});

test("the live worktree still passes after all that — the guard has no false negative", () => {
  assert.deepEqual(
    resolveTaskWorkRoot(project(), task({ workdir: liveWorktree, parallel: true })),
    { kind: "worktree", cwd: liveWorktree },
  );
  // Moving the pointer aside is what a `git worktree prune` effectively leaves behind.
  renameSync(join(liveWorktree, ".git"), join(liveWorktree, ".git-off"));
  assert.equal(
    resolveTaskWorkRoot(project(), task({ workdir: liveWorktree })).kind,
    "worktree-removed",
  );
  renameSync(join(liveWorktree, ".git-off"), join(liveWorktree, ".git"));
});

test("characterisation: git really does report the enclosing repo from that directory", () => {
  // Why the spec above matters. `data/worktrees/` sits inside the platform's own checkout, so
  // git discovers `outer` from an unrecognised subdirectory and reports *its* changes. Were the
  // guard an existence check, this list would render on the task page as the run's own work.
  const leaked = gitChanges(staleWorktree);
  assert.ok(
    leaked.files.some((f) => f.path.endsWith("tracked.md")),
    `expected the enclosing repo's change to surface, got ${JSON.stringify(leaked.files)}`,
  );
});
