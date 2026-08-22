/**
 * The feature merge sweep: retries `blocked` merge-backs and reclassifies rows from the git
 * object store. Against a real git repo AND a throwaway SQLite file built from the real
 * schema — the sweep's whole job is reconciling what the rows *say* with what git *knows*,
 * so stubbing either side would test the stubs.
 *
 * The fixture states are the real ones measured on a live install (2026-08-22): a run whose
 * branch was merged by hand after the platform recorded "conflict", a run that ended `done`
 * without committing (kept dirty worktree, empty branch), and merges blocked by the feature
 * branch being checked out in the main checkout.
 */
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "platform-merge-sweep-test-"));
const dbFile = join(root, "test.db");
// Both must be set before lib/db and lib/config load: the shared connection reads
// PLATFORM_DB, and WORKTREES_DIR derives from DATA_DIR, at module load.
process.env.PLATFORM_DB = dbFile;
process.env.PLATFORM_DATA_DIR = join(root, "data");

type Db = typeof import("../lib/db").db;
type Schema = typeof import("../lib/db/schema");
type WorktreeMod = typeof import("./worktree");
type SweepMod = typeof import("./merge-sweep");

let db: Db;
let tasks: Schema["tasks"];
let taskEvents: Schema["taskEvents"];
let eq: typeof import("drizzle-orm").eq;
let wt: WorktreeMod;
let sweep: SweepMod;

const repo = join(root, "repo");
const FEATURE = "feature/sweep";

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

before(async () => {
  execFileSync(
    "npx",
    [
      "drizzle-kit",
      "push",
      "--dialect=sqlite",
      "--schema=./lib/db/schema.ts",
      `--url=${dbFile}`,
      "--force",
    ],
    { cwd: join(import.meta.dirname, ".."), stdio: "pipe" },
  );

  ({ db } = await import("../lib/db"));
  const schema = await import("../lib/db/schema");
  ({ tasks, taskEvents } = schema);
  ({ eq } = await import("drizzle-orm"));
  wt = await import("./worktree");
  sweep = await import("./merge-sweep");

  // Guard: never run against the real database or the real worktrees dir.
  const file = (db.$client as { name: string }).name;
  assert.equal(file, dbFile, `refusing to run: connected to ${file}`);
  assert.ok(wt.WORKTREES_DIR.startsWith(root), `refusing to run: ${wt.WORKTREES_DIR}`);

  mkdirSync(repo);
  git(repo, ["init", "-b", "main"]);
  git(repo, ["config", "user.email", "test@test"]);
  git(repo, ["config", "user.name", "test"]);
  writeFileSync(join(repo, "a.txt"), "hello\n");
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-m", "init"]);
  wt.ensureFeatureBranch(repo, FEATURE, "main");

  db.insert(schema.projects).values({ id: "p1", name: "One", path: repo }).run();
  db.insert(schema.agents)
    .values({
      id: "a1",
      namespace: "swe",
      name: "SWE",
      sourcePath: join(root, "agent"),
      pluginId: "swe@test",
    })
    .run();
  db.insert(schema.features)
    .values({ id: "f1", projectId: "p1", name: "Sweep feature", branch: FEATURE })
    .run();
});

after(() => rmSync(root, { recursive: true, force: true }));

let seq = 0;
/** A done, feature-linked task row plus (optionally) a real worktree with real commits. */
function fixtureTask(opts: {
  mergeState: "blocked" | "conflict" | "merged" | "pending";
  status?: string;
  commit?: string | null; // file content to commit on the task branch (null = no commits)
  dirty?: boolean; // leave an uncommitted file in the kept worktree
  removeWorktree?: boolean;
}): { id: string; branch: string } {
  seq += 1;
  const id = `task_sw${seq}`;
  const tree = wt.ensureTaskWorktree(repo, id, { baseRef: FEATURE });
  if (opts.commit != null) {
    writeFileSync(join(tree.dir, `from-${id}.txt`), opts.commit);
    git(tree.dir, ["add", "-A"]);
    git(tree.dir, ["commit", "-m", `${id} work`]);
  }
  if (opts.dirty) writeFileSync(join(tree.dir, "unsaved.txt"), "uncommitted\n");
  if (opts.removeWorktree) {
    assert.equal(wt.removeWorktreeIfClean(repo, tree.dir), true, "fixture tree must be clean");
  }
  db.insert(tasks)
    .values({
      id,
      projectId: "p1",
      agentId: "a1",
      featureId: "f1",
      command: "task",
      status: (opts.status ?? "done") as never,
      mergeState: opts.mergeState,
      branch: tree.branch,
      workdir: tree.dir,
    })
    .run();
  return { id, branch: tree.branch };
}

const rowOf = (id: string) => db.select().from(tasks).where(eq(tasks.id, id)).get()!;
const logsOf = (id: string) =>
  db.select().from(taskEvents).where(eq(taskEvents.taskId, id)).all();

test("a blocked merge is retried and lands, with the outcome logged into the transcript", () => {
  const t = fixtureTask({ mergeState: "blocked", commit: "real work\n", removeWorktree: true });
  sweep.sweepFeatureMerges("p1", { mergeInMainCheckout: false });
  assert.equal(rowOf(t.id).mergeState, "merged");
  assert.equal(wt.branchContained(repo, FEATURE, t.branch), true, "commits actually merged");
  const logs = logsOf(t.id);
  assert.equal(logs.length, 1);
  assert.match(JSON.stringify(logs[0].payload), /Merge sweep: merged/);
});

test("a 'conflict' row whose branch was merged by hand is healed to 'merged'", () => {
  // The measured field case: the old catch-all recorded "conflict" for a merge blocked by
  // the checkout, and a later run merged the branch by hand — the row must catch up.
  const t = fixtureTask({ mergeState: "conflict", commit: "hand-merged\n", removeWorktree: true });
  git(repo, ["worktree", "prune"]);
  const scratch = join(root, `hand-merge-${t.id}`);
  git(repo, ["worktree", "add", scratch, FEATURE]);
  git(scratch, ["merge", "--no-ff", "--no-edit", t.branch]);
  git(repo, ["worktree", "remove", scratch]);

  sweep.sweepFeatureMerges("p1", { mergeInMainCheckout: false });
  assert.equal(rowOf(t.id).mergeState, "merged");
  assert.match(JSON.stringify(logsOf(t.id)[0].payload), /fully contained/);
});

test("an empty branch with a kept dirty worktree becomes 'no_commits', naming the kept work", () => {
  // The other measured field case: a run ended `done` without committing — its branch holds
  // nothing, and its work sits uncommitted in the kept worktree. "merged" would hide that.
  const t = fixtureTask({ mergeState: "conflict", commit: null, dirty: true });
  sweep.sweepFeatureMerges("p1", { mergeInMainCheckout: false });
  assert.equal(rowOf(t.id).mergeState, "no_commits");
  assert.match(JSON.stringify(logsOf(t.id)[0].payload), /uncommitted work/);
  // The dirty worktree itself is never touched by the sweep.
  assert.ok(existsSync(join(wt.taskWorktreeDir(t.id), "unsaved.txt")));
});

test("a real conflict with divergent commits is left alone — no retry, no state change", () => {
  const t = fixtureTask({ mergeState: "conflict", commit: "task side\n", removeWorktree: true });
  // Put a colliding commit on the feature branch so the branches genuinely diverge.
  const scratch = join(root, `collide-${t.id}`);
  git(repo, ["worktree", "add", scratch, FEATURE]);
  writeFileSync(join(scratch, `from-${t.id}.txt`), "feature side\n");
  git(scratch, ["add", "-A"]);
  git(scratch, ["commit", "-m", "colliding feature work"]);
  git(repo, ["worktree", "remove", scratch]);

  const featureTip = git(repo, ["rev-parse", FEATURE]);
  sweep.sweepFeatureMerges("p1", { mergeInMainCheckout: false });
  assert.equal(rowOf(t.id).mergeState, "conflict", "needs reconciling, not retrying");
  assert.equal(logsOf(t.id).length, 0, "nothing new to say");
  assert.equal(git(repo, ["rev-parse", FEATURE]), featureTip, "feature branch untouched");
});

test("a blocked row whose retry hits a real conflict is reclassified as 'conflict'", () => {
  const t = fixtureTask({ mergeState: "blocked", commit: "blocked side\n", removeWorktree: true });
  const scratch = join(root, `collide2-${t.id}`);
  git(repo, ["worktree", "add", scratch, FEATURE]);
  writeFileSync(join(scratch, `from-${t.id}.txt`), "feature collides\n");
  git(scratch, ["add", "-A"]);
  git(scratch, ["commit", "-m", "colliding feature work"]);
  git(repo, ["worktree", "remove", scratch]);

  sweep.sweepFeatureMerges("p1", { mergeInMainCheckout: false });
  assert.equal(rowOf(t.id).mergeState, "conflict");
  assert.match(JSON.stringify(logsOf(t.id)[0].payload), /real\s+conflict|resolve it by hand/);
});

test("blocked stays blocked while the feature branch is checked out and the checkout is off-limits", () => {
  const t = fixtureTask({ mergeState: "blocked", commit: "waiting\n", removeWorktree: true });
  execFileSync("git", ["checkout", FEATURE], { cwd: repo });
  try {
    sweep.sweepFeatureMerges("p1", { mergeInMainCheckout: false });
    assert.equal(rowOf(t.id).mergeState, "blocked");
    assert.equal(logsOf(t.id).length, 0, "an unchanged state writes no log");

    // …and settles the moment the sweep may use the main checkout.
    sweep.sweepFeatureMerges("p1", { mergeInMainCheckout: true });
    assert.equal(rowOf(t.id).mergeState, "merged");
    assert.ok(
      existsSync(join(repo, `from-${t.id}.txt`)),
      "the checkout advanced together with the branch",
    );
  } finally {
    execFileSync("git", ["checkout", "main"], { cwd: repo });
  }
});

test("rows the sweep must not touch: wrong status, wrong state, other projects", () => {
  const active = fixtureTask({ mergeState: "blocked", commit: "live\n", status: "running" });
  const merged = fixtureTask({ mergeState: "merged", commit: "done\n", removeWorktree: true });
  const pending = fixtureTask({ mergeState: "pending", commit: "checkout run\n" });
  sweep.sweepFeatureMerges("p1", { mergeInMainCheckout: false });
  assert.equal(rowOf(active.id).mergeState, "blocked", "a live task's merge is not the sweep's");
  assert.equal(rowOf(merged.id).mergeState, "merged");
  assert.equal(rowOf(pending.id).mergeState, "pending");
  // A project id with no rows is a clean no-op, not an error.
  sweep.sweepFeatureMerges("p-does-not-exist", { mergeInMainCheckout: true });
});
