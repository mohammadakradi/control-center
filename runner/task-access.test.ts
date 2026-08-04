/**
 * Specs for per-owner task access.
 *
 * These matter more than they look. Sign-in used to be the gate: `proxy.ts` bounced anyone
 * without a session and every query then read whatever it liked. Sign-in is now optional, so
 * that gate is gone and `lib/task-access.ts` is the only thing keeping one person's tasks and
 * transcripts away from another's. Every assertion here is "someone else's task is invisible",
 * not merely "my task is visible".
 */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repo = resolve(import.meta.dirname, "..");
const dir = mkdtempSync(join(tmpdir(), "platform-access-"));
const dbFile = join(dir, "access.db");

// Point the shared connection at a throwaway file BEFORE lib/db is imported.
process.env.PLATFORM_DB = dbFile;

type Access = typeof import("../lib/task-access");
let findOwnedTask: Access["findOwnedTask"];
let ownedBy: Access["ownedBy"];
let db: typeof import("../lib/db").db;
let schema: typeof import("../lib/db/schema");

const ALICE = "user_alice";
const BOB = "user_bob";
const LOCAL = "user_local";

test.before(async () => {
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
    { cwd: repo, stdio: "pipe" },
  );

  ({ findOwnedTask, ownedBy } = await import("../lib/task-access"));
  ({ db } = await import("../lib/db"));
  schema = await import("../lib/db/schema");

  const file = (db.$client as { name: string }).name;
  assert.equal(file, dbFile, `refusing to run: connected to ${file}`);

  for (const [id, email] of [
    [ALICE, "alice@example.com"],
    [BOB, "bob@example.com"],
    [LOCAL, "local@device"],
  ]) {
    db.insert(schema.users).values({ id, email, passwordHash: "!" }).run();
  }
  db.insert(schema.projects).values({ id: "p1", name: "P", path: dir }).run();
  db.insert(schema.agents)
    .values({ id: "a1", name: "A", namespace: "swe", sourcePath: dir, pluginId: "a" })
    .run();

  for (const [id, owner] of [
    ["task_alice", ALICE],
    ["task_bob", BOB],
    ["task_local", LOCAL],
  ]) {
    db.insert(schema.tasks)
      .values({
        id,
        projectId: "p1",
        agentId: "a1",
        command: "task",
        requestText: "x",
        status: "done",
        userId: owner,
      })
      .run();
  }
});

test.after(() => rmSync(dir, { recursive: true, force: true }));

test("you get your own task", () => {
  assert.equal(findOwnedTask("task_alice", ALICE)?.id, "task_alice");
  assert.equal(findOwnedTask("task_bob", BOB)?.id, "task_bob");
});

test("someone else's task is null — the id is not enough", () => {
  assert.equal(findOwnedTask("task_alice", BOB), null);
  assert.equal(findOwnedTask("task_bob", ALICE), null);
});

test("the local workspace and a signed-in account are separate owners", () => {
  // The whole point of optional sign-in: opening the app without an account must not show,
  // stream, or let you stop the tasks of someone who did sign in.
  assert.equal(findOwnedTask("task_alice", LOCAL), null, "local must not see Alice's task");
  assert.equal(findOwnedTask("task_local", ALICE), null, "Alice must not see local's task");
  assert.equal(findOwnedTask("task_local", LOCAL)?.id, "task_local");
});

test("a task that doesn't exist is indistinguishable from one you can't have", () => {
  // Both null, so a caller can only ever answer 404 — probing ids can't enumerate other
  // people's work.
  assert.equal(findOwnedTask("task_nope", ALICE), null);
  assert.equal(findOwnedTask("task_bob", ALICE), null);
});

test("ownedBy scopes a list query to one owner", async () => {
  const { desc } = await import("drizzle-orm");
  const mine = db
    .select()
    .from(schema.tasks)
    .where(ownedBy(ALICE))
    .orderBy(desc(schema.tasks.createdAt))
    .all();
  assert.deepEqual(
    mine.map((t) => t.id),
    ["task_alice"],
    "a list must never leak rows owned by anyone else",
  );
});

test("an ownerless task belongs to nobody, including the local workspace", () => {
  // Legacy rows are given an owner by drizzle/0001_local_workspace.sql on upgrade. Should one
  // ever appear anyway, it must stay invisible rather than defaulting into someone's view.
  db.insert(schema.tasks)
    .values({
      id: "task_orphan",
      projectId: "p1",
      agentId: "a1",
      command: "task",
      requestText: "x",
      status: "done",
    })
    .run();
  for (const who of [ALICE, BOB, LOCAL]) {
    assert.equal(findOwnedTask("task_orphan", who), null, `${who} must not see an orphan`);
  }
});
