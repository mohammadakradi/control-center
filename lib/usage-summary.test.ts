/**
 * Integration test for per-user spend aggregation. Runs against a throwaway SQLite file
 * created from the real schema via `drizzle-kit push` — never the app's own
 * `data/platform.db`.
 *
 * The property that matters most here is scoping: spend must never include another user's
 * tasks. (Task transcripts are shared across the team on purpose; spend is not.)
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, before } from "node:test";
import assert from "node:assert/strict";

const dir = mkdtempSync(join(tmpdir(), "platform-spend-test-"));
const dbFile = join(dir, "test.db");

// Point the shared connection at the throwaway file BEFORE lib/db is imported.
process.env.PLATFORM_DB = dbFile;

let spendForUser: typeof import("./usage-summary").spendForUser;
let parseRange: typeof import("./usage-summary").parseRange;

const DAY_MS = 24 * 60 * 60 * 1000;

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

  const { db } = await import("./db");
  const { agents, projects, tasks, users } = await import("./db/schema");
  ({ spendForUser, parseRange } = await import("./usage-summary"));

  // Guard: if the env override ever stopped working, fail loudly rather than reading
  // (or worse, writing) the real database.
  const file = (db.$client as { name: string }).name;
  assert.equal(file, dbFile, `refusing to run: connected to ${file}`);

  db.insert(projects)
    .values([
      { id: "p1", name: "P", path: dir },
      { id: "p2", name: "Q", path: join(dir, "q") },
    ])
    .run();
  db.insert(agents)
    .values({ id: "a1", name: "A", namespace: "swe", sourcePath: dir, pluginId: "a" })
    .run();
  db.insert(users)
    .values([
      { id: "u_me", email: "me@example.com", passwordHash: "x" },
      { id: "u_other", email: "other@example.com", passwordHash: "x" },
    ])
    .run();

  const task = (
    id: string,
    userId: string | null,
    cost: number,
    tokens: number,
    ageDays = 0,
    projectId = "p1",
  ) => ({
    id,
    projectId,
    agentId: "a1",
    userId,
    command: "task",
    title: `task ${id}`,
    usageCostUsd: cost,
    usageInputTokens: tokens,
    usageOutputTokens: tokens * 2,
    usageCacheReadTokens: tokens * 10,
    usageCacheCreationTokens: tokens,
    createdAt: new Date(Date.now() - ageDays * DAY_MS),
  });

  db.insert(tasks)
    .values([
      task("t_cheap", "u_me", 1.5, 100, 3), // inside the 7-day window
      task("t_dear", "u_me", 20.25, 500, 10), // inside 30 days, outside 7
      task("t_old", "u_me", 5, 200, 45), // outside the 30-day window
      task("t_free", "u_me", 0, 0), // never reached a billable turn
      task("t_mine_p2", "u_me", 4, 50, 2, "p2"), // same user, second project
      task("t_theirs", "u_other", 99.99, 9999, 0, "p2"), // must never be counted
      task("t_unowned", null, 77, 7777), // pre-auth task, owned by nobody
    ])
    .run();
});

after(async () => {
  // Close the sqlite handle before removing its directory.
  const { db } = await import("./db");
  try {
    (db.$client as { close?: () => void }).close?.();
  } catch {
    /* already closed */
  }
  rmSync(dir, { recursive: true, force: true });
});

test("totals cover only the requested user's tasks", () => {
  const s = spendForUser("u_me");
  // 1.5 + 20.25 + 5 + 0 + 4 — and neither the other user's 99.99 nor the unowned 77.
  assert.ok(Math.abs(s.totalCostUsd - 30.75) < 1e-9, `got ${s.totalCostUsd}`);
  assert.equal(s.inputTokens, 850);
  assert.equal(s.outputTokens, 1700);
  assert.equal(s.cacheReadTokens, 8500);
  assert.equal(s.cacheCreationTokens, 850);
});

test("counts every owned task, but bills only the ones that spent", () => {
  const s = spendForUser("u_me");
  assert.equal(s.taskCount, 5);
  assert.equal(s.billedTaskCount, 4, "the $0 task is owned but not billed");
});

test("top tasks are ordered by cost, omit free ones, and carry project identity", () => {
  const s = spendForUser("u_me");
  assert.deepEqual(
    s.topTasks.map((t) => t.id),
    ["t_dear", "t_old", "t_mine_p2", "t_cheap"],
  );
  assert.equal(s.topTasks.every((t) => t.costUsd > 0), true);
  assert.equal(typeof s.topTasks[0].createdAt, "string", "serializable for JSON");
  assert.equal(s.topTasks[0].projectId, "p1");
  assert.equal(s.topTasks[0].projectName, "P");
  assert.equal(s.topTasks[2].projectId, "p2");
  assert.equal(s.topTasks[2].projectName, "Q");
});

test("topN caps the list", () => {
  assert.equal(spendForUser("u_me", { topN: 1 }).topTasks.length, 1);
});

test("range defaults to all-time and is echoed back", () => {
  assert.equal(spendForUser("u_me").range, "all");
  assert.deepEqual(spendForUser("u_me", { range: "all" }), spendForUser("u_me"));
});

test("a 30-day range drops older tasks from every figure", () => {
  const s = spendForUser("u_me", { range: "30d" });
  assert.equal(s.range, "30d");
  assert.ok(Math.abs(s.totalCostUsd - 25.75) < 1e-9, `got ${s.totalCostUsd}`); // no t_old
  assert.equal(s.inputTokens, 650);
  assert.equal(s.taskCount, 4);
  assert.equal(s.billedTaskCount, 3);
  assert.deepEqual(
    s.topTasks.map((t) => t.id),
    ["t_dear", "t_mine_p2", "t_cheap"],
    "top tasks respect the window too",
  );
});

test("a 7-day range narrows further", () => {
  const s = spendForUser("u_me", { range: "7d" });
  assert.ok(Math.abs(s.totalCostUsd - 5.5) < 1e-9, `got ${s.totalCostUsd}`); // t_cheap + t_mine_p2
  assert.equal(s.inputTokens, 150);
  assert.equal(s.taskCount, 3); // plus today's $0 task
  assert.equal(s.billedTaskCount, 2);
  assert.deepEqual(
    s.topTasks.map((t) => t.id),
    ["t_mine_p2", "t_cheap"],
  );
});

test("byProject splits the user's spend per project, most expensive first", () => {
  const s = spendForUser("u_me");
  assert.deepEqual(s.byProject, [
    {
      projectId: "p1",
      projectName: "P",
      costUsd: 26.75,
      inputTokens: 800,
      outputTokens: 1600,
      cacheReadTokens: 8000,
      cacheCreationTokens: 800,
      taskCount: 4,
      billedTaskCount: 3,
    },
    {
      projectId: "p2",
      projectName: "Q",
      costUsd: 4,
      inputTokens: 50,
      outputTokens: 100,
      cacheReadTokens: 500,
      cacheCreationTokens: 50,
      taskCount: 1,
      billedTaskCount: 1,
    },
  ]);
});

test("byProject respects the range — the order can flip with the window", () => {
  const s = spendForUser("u_me", { range: "7d" });
  // Within 7 days p2 ($4) outweighs p1 ($1.50 + the $0 task).
  assert.deepEqual(
    s.byProject.map((p) => [p.projectId, p.costUsd, p.taskCount]),
    [
      ["p2", 4, 1],
      ["p1", 1.5, 2],
    ],
  );
});

test("byProject never mixes users sharing a project, nor unowned spend", () => {
  // u_other also ran a task in p2 — u_me's p2 figure must not include it, and vice versa.
  const mine = spendForUser("u_me");
  const theirs = spendForUser("u_other");
  assert.equal(mine.byProject.find((p) => p.projectId === "p2")?.costUsd, 4);
  assert.deepEqual(
    theirs.byProject.map((p) => [p.projectId, p.costUsd]),
    [["p2", 99.99]],
    "the unowned $77 task in p1 must not appear for anyone either",
  );
});

test("parseRange: absent means all, garbage is rejected, valid values pass", () => {
  assert.equal(parseRange(null), "all");
  assert.equal(parseRange(""), "all");
  assert.equal(parseRange("7d"), "7d");
  assert.equal(parseRange("30d"), "30d");
  assert.equal(parseRange("all"), "all");
  assert.equal(parseRange("90d"), null);
  assert.equal(parseRange("7D"), null, "allowlist is exact, not case-folded");
  assert.equal(parseRange("7d OR 1=1"), null);
});

test("a user with no tasks gets zeros, not nulls or NaN", () => {
  const s = spendForUser("u_nobody");
  assert.equal(s.totalCostUsd, 0);
  assert.equal(s.inputTokens, 0);
  assert.equal(s.taskCount, 0);
  assert.equal(s.billedTaskCount, 0);
  assert.deepEqual(s.topTasks, []);
  assert.deepEqual(s.byProject, []);
});

test("unattributed spend is reported separately, and is the same for every caller", () => {
  // Tasks that predate `tasks.userId` belong to nobody. Without this the UI would show $0
  // next to a long, expensive history.
  const mine = spendForUser("u_me");
  const theirs = spendForUser("u_other");
  assert.equal(mine.unattributed.taskCount, 1);
  assert.ok(Math.abs(mine.unattributed.costUsd - 77) < 1e-9);
  assert.deepEqual(theirs.unattributed, mine.unattributed, "aggregate, not per-user");
  // And it must not leak into anyone's personal figure.
  assert.ok(Math.abs(mine.totalCostUsd - 30.75) < 1e-9);
});
