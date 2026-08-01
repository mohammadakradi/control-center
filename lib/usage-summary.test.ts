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
  ({ spendForUser } = await import("./usage-summary"));

  // Guard: if the env override ever stopped working, fail loudly rather than reading
  // (or worse, writing) the real database.
  const file = (db.$client as { name: string }).name;
  assert.equal(file, dbFile, `refusing to run: connected to ${file}`);

  db.insert(projects).values({ id: "p1", name: "P", path: dir }).run();
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
  ) => ({
    id,
    projectId: "p1",
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
      task("t_cheap", "u_me", 1.5, 100),
      task("t_dear", "u_me", 20.25, 500),
      task("t_old", "u_me", 5, 200, 45), // outside the 30-day window
      task("t_free", "u_me", 0, 0), // never reached a billable turn
      task("t_theirs", "u_other", 99.99, 9999), // must never be counted
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
  // 1.5 + 20.25 + 5 + 0 — and neither the other user's 99.99 nor the unowned 77.
  assert.ok(Math.abs(s.totalCostUsd - 26.75) < 1e-9, `got ${s.totalCostUsd}`);
  assert.equal(s.inputTokens, 800);
  assert.equal(s.outputTokens, 1600);
  assert.equal(s.cacheReadTokens, 8000);
  assert.equal(s.cacheCreationTokens, 800);
});

test("counts every owned task, but bills only the ones that spent", () => {
  const s = spendForUser("u_me");
  assert.equal(s.taskCount, 4);
  assert.equal(s.billedTaskCount, 3, "the $0 task is owned but not billed");
});

test("the 30-day window excludes older tasks", () => {
  const s = spendForUser("u_me");
  assert.ok(Math.abs(s.last30DaysCostUsd - 21.75) < 1e-9, `got ${s.last30DaysCostUsd}`);
});

test("top tasks are ordered by cost and omit free ones", () => {
  const s = spendForUser("u_me");
  assert.deepEqual(
    s.topTasks.map((t) => t.id),
    ["t_dear", "t_old", "t_cheap"],
  );
  assert.equal(s.topTasks.every((t) => t.costUsd > 0), true);
  assert.equal(typeof s.topTasks[0].createdAt, "string", "serializable for JSON");
});

test("topN caps the list", () => {
  assert.equal(spendForUser("u_me", 1).topTasks.length, 1);
});

test("a user with no tasks gets zeros, not nulls or NaN", () => {
  const s = spendForUser("u_nobody");
  assert.equal(s.totalCostUsd, 0);
  assert.equal(s.inputTokens, 0);
  assert.equal(s.taskCount, 0);
  assert.equal(s.billedTaskCount, 0);
  assert.equal(s.last30DaysCostUsd, 0);
  assert.deepEqual(s.topTasks, []);
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
  assert.ok(Math.abs(mine.totalCostUsd - 26.75) < 1e-9);
});
