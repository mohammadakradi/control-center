/**
 * Integration test for the usage write path: the SQL increment must ACCUMULATE onto a
 * task row (a resumed task adds to its earlier runs) and the backfill's absolute write
 * must replace. Runs against a throwaway SQLite file created from the real schema via
 * `drizzle-kit push` — never the app's own `data/platform.db`.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import {
  isZeroUsage,
  usageAbsolute,
  usageDelta,
  usageIncrement,
  ZERO_USAGE,
  type UsageTotals,
} from "./usage";

const dir = mkdtempSync(join(tmpdir(), "platform-usage-test-"));
const dbFile = join(dir, "test.db");

// Point the shared connection at the throwaway file BEFORE lib/db is imported.
process.env.PLATFORM_DB = dbFile;

type Db = typeof import("../lib/db").db;
type Schema = typeof import("../lib/db/schema");
let db: Db;
let tasks: Schema["tasks"];
let eq: typeof import("drizzle-orm").eq;

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
  ({ tasks } = await import("../lib/db/schema"));
  ({ eq } = await import("drizzle-orm"));

  // Guard: if the env override ever stopped working, fail loudly rather than writing
  // to the real database.
  const file = (db.$client as { name: string }).name;
  assert.equal(file, dbFile, `refusing to run: connected to ${file}`);

  const { projects, agents } = await import("../lib/db/schema");
  db.insert(projects).values({ id: "p1", name: "P", path: dir }).run();
  db.insert(agents)
    .values({ id: "a1", name: "A", namespace: "swe", sourcePath: dir, pluginId: "a" })
    .run();
});

after(() => rmSync(dir, { recursive: true, force: true }));

function makeTask(id: string): void {
  db.insert(tasks)
    .values({ id, projectId: "p1", agentId: "a1", command: "task" })
    .run();
}

function readUsage(id: string) {
  const row = db.select().from(tasks).where(eq(tasks.id, id)).get()!;
  return {
    inputTokens: row.usageInputTokens,
    outputTokens: row.usageOutputTokens,
    cacheReadTokens: row.usageCacheReadTokens,
    cacheCreationTokens: row.usageCacheCreationTokens,
    costUsd: row.usageCostUsd,
  };
}

const delta: UsageTotals = {
  inputTokens: 100,
  outputTokens: 200,
  cacheReadTokens: 300,
  cacheCreationTokens: 400,
  costUsd: 1.25,
};

test("a new task starts at zero, not null", () => {
  makeTask("t_zero");
  assert.deepEqual(readUsage("t_zero"), {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    costUsd: 0,
  });
});

test("usageIncrement accumulates across turns and resumes", () => {
  makeTask("t_inc");
  db.update(tasks).set(usageIncrement(delta)).where(eq(tasks.id, "t_inc")).run();
  assert.deepEqual(readUsage("t_inc"), delta);

  // A second turn — and then a third, as a resume would produce.
  db.update(tasks).set(usageIncrement(delta)).where(eq(tasks.id, "t_inc")).run();
  db.update(tasks)
    .set(usageIncrement({ ...delta, inputTokens: 1, costUsd: 0.5 }))
    .where(eq(tasks.id, "t_inc"))
    .run();

  assert.deepEqual(readUsage("t_inc"), {
    inputTokens: 201,
    outputTokens: 600,
    cacheReadTokens: 900,
    cacheCreationTokens: 1200,
    costUsd: 3,
  });
});

test("the increment touches only its own row", () => {
  makeTask("t_a");
  makeTask("t_b");
  db.update(tasks).set(usageIncrement(delta)).where(eq(tasks.id, "t_a")).run();
  assert.equal(readUsage("t_a").inputTokens, 100);
  assert.equal(readUsage("t_b").inputTokens, 0);
});

test("token columns stay integers", () => {
  makeTask("t_int");
  // Deltas are rounded before they get here; make sure the column doesn't quietly
  // hold a float if one ever slips through.
  db.update(tasks)
    .set(usageIncrement({ ...delta, inputTokens: 7 }))
    .where(eq(tasks.id, "t_int"))
    .run();
  assert.equal(Number.isInteger(readUsage("t_int").inputTokens), true);
});

test("real result messages, driven the way session-manager drives them, land the right row", () => {
  // Mirrors the live path: one accumulator per launch (a fresh SDK subprocess), each
  // `result` message adding its delta to the row. Fed with the messages actually
  // recorded for task_f68c9003 — two subprocesses, five results, one of them a resume.
  const events = JSON.parse(
    readFileSync(join(import.meta.dirname, "__fixtures__/task-f68c9003-events.json"), "utf8"),
  ) as Array<{ type: string; payload: unknown }>;

  makeTask("t_replay");
  let seenUsage: UsageTotals = { ...ZERO_USAGE };
  const deltas: UsageTotals[] = [];
  for (const event of events) {
    if (event.type === "log") {
      seenUsage = { ...ZERO_USAGE }; // new launch → new subprocess → counters restart
      continue;
    }
    const { delta, next } = usageDelta(seenUsage, event.payload);
    seenUsage = next;
    if (!isZeroUsage(delta)) {
      db.update(tasks).set(usageIncrement(delta)).where(eq(tasks.id, "t_replay")).run();
      deltas.push(delta);
    }
  }

  const row = readUsage("t_replay");
  assert.equal(row.inputTokens, 10_309);
  assert.equal(row.outputTokens, 141_440);
  assert.equal(row.cacheReadTokens, 16_505_419);
  assert.equal(row.cacheCreationTokens, 998_095);
  assert.ok(Math.abs(row.costUsd - 19.397649) < 1e-9, `cost was ${row.costUsd}`);

  // Four of the five results wrote. The fifth is the corrective duplicate of the fourth
  // (same token counters, headline cost caught up to the per-model sum), so once the
  // fourth has banked the true figure the fifth must add exactly nothing — no phantom
  // cost-only write, no double-counted tokens.
  assert.equal(deltas.length, 4, "the corrective duplicate result must not write again");
  const fourth = deltas[3];
  assert.ok(
    Math.abs(fourth.costUsd - 3.5059411) < 1e-6,
    `the 4th result should bank the corrected cost, got ${fourth.costUsd}`,
  );
});

test("usageAbsolute replaces rather than adds (re-runnable backfill)", () => {
  makeTask("t_abs");
  db.update(tasks).set(usageIncrement(delta)).where(eq(tasks.id, "t_abs")).run();
  const total: UsageTotals = {
    inputTokens: 9,
    outputTokens: 8,
    cacheReadTokens: 7,
    cacheCreationTokens: 6,
    costUsd: 0.5,
  };
  db.update(tasks).set(usageAbsolute(total)).where(eq(tasks.id, "t_abs")).run();
  assert.deepEqual(readUsage("t_abs"), total);
  // Applying it twice is a no-op — the property the backfill relies on.
  db.update(tasks).set(usageAbsolute(total)).where(eq(tasks.id, "t_abs")).run();
  assert.deepEqual(readUsage("t_abs"), total);
});
