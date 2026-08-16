/**
 * Specs for dispatch — the single path a task is created and started on, shared by
 * `POST /api/tasks` and the backlog's run action.
 *
 * Three things here are load-bearing and were previously untested: which agent a namespace
 * resolves to (the only thing deciding who takes a backlog item), the model allowlist, and the
 * bookkeeping when the runner won't accept the task — a row left `failed` and visible, not a
 * row left `queued` forever.
 *
 * The runner is deliberately pointed at a dead port, so the failure path is exercised for real
 * rather than stubbed. Runs against a throwaway SQLite file built from the committed
 * migrations — never `data/platform.db`.
 */
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = mkdtempSync(join(tmpdir(), "platform-dispatch-test-"));
const dbFile = join(root, "test.db");

// All three must be set before lib/db, lib/config or lib/secrets are imported.
process.env.PLATFORM_DB = dbFile;
// Port 1 is privileged and nothing listens there: `daemonStartTask` fails fast.
process.env.RUNNER_URL = "http://127.0.0.1:1";
// Make the token gate pass without touching the real vault (the runner is authoritative
// anyway, and this mirrors the documented dev-only escape hatch).
process.env.ALLOW_SHARED_TOKEN_FALLBACK = "1";

type Dispatch = typeof import("./dispatch");
type Schema = typeof import("./db/schema");
let dispatch: Dispatch;
let db: typeof import("./db").db;
let schema: Schema;
let eq: typeof import("drizzle-orm").eq;

before(async () => {
  const { migrateDatabase } = await import("./db/migrate");
  migrateDatabase({
    dbPath: dbFile,
    migrationsFolder: resolve(import.meta.dirname, "..", "drizzle"),
    backup: false,
  });

  dispatch = await import("./dispatch");
  ({ db } = await import("./db"));
  schema = await import("./db/schema");
  ({ eq } = await import("drizzle-orm"));

  const file = (db.$client as { name: string }).name;
  assert.equal(file, dbFile, `refusing to run: connected to ${file}`);

  db.insert(schema.projects).values({ id: "p1", name: "P1", path: root }).run();
  // One namespace present twice — the app bundles a copy of each agent, and a developer may
  // also have the live plugin registered through the CLI.
  db.insert(schema.agents)
    .values({
      id: "swe@bundled",
      name: "swe",
      namespace: "swe",
      sourcePath: join(root, "bundled"),
      pluginId: "swe",
      scope: "bundled",
      version: "0.1.0",
    })
    .run();
  db.insert(schema.agents)
    .values({
      id: "swe@swe-agent-local",
      name: "swe",
      namespace: "swe",
      sourcePath: join(root, "live"),
      pluginId: "swe",
      scope: "user",
      version: "9.9.9",
    })
    .run();
  // A namespace that exists only as the bundled copy.
  db.insert(schema.agents)
    .values({
      id: "fe@bundled",
      name: "fe",
      namespace: "fe",
      sourcePath: join(root, "fe"),
      pluginId: "fe",
      scope: "bundled",
    })
    .run();
});

after(() => rmSync(root, { recursive: true, force: true }));

test("a registered plugin beats the bundled copy of the same namespace", () => {
  // On a machine where these agents are being developed, the live source directory is what
  // should run — the same precedence lib/discovery/agents.ts applies.
  assert.deepEqual(dispatch.agentForNamespace("swe"), { id: "swe@swe-agent-local" });
});

test("a namespace that only exists as the bundle still resolves", () => {
  assert.deepEqual(dispatch.agentForNamespace("fe"), { id: "fe@bundled" });
});

test("an unknown namespace resolves to null, so the caller can fall back", () => {
  assert.equal(dispatch.agentForNamespace("pm"), null);
  assert.equal(dispatch.agentForNamespace(""), null);
});

test("the model allowlist passes known labels and falls back to routing", () => {
  for (const model of ["auto", "fable-5", "opus-5", "sonnet-5", "opus-4.8", "sonnet", "opus"]) {
    assert.equal(dispatch.resolveModel(model), model);
  }
  for (const bogus of ["gpt-4", "", undefined, null, "OPUS-5", "opus-5; drop table"]) {
    assert.equal(dispatch.resolveModel(bogus), "auto", `${bogus} must not reach the SDK`);
  }
});

test("a task that can't be started is left failed, with the reason and its id", async () => {
  const outcome = await dispatch.createAndStartTask({
    projectId: "p1",
    agentId: "swe@swe-agent-local",
    command: "task",
    userId: "user_local",
    requestText: "does not matter, the runner is unreachable",
  });

  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.equal(outcome.status, 502);
  assert.ok(outcome.taskId, "the caller needs the id to link to the failed run");
  assert.ok(outcome.error.length > 0);

  const row = db.select().from(schema.tasks).where(eq(schema.tasks.id, outcome.taskId!)).get()!;
  assert.equal(row.status, "failed", "never left queued — nothing is coming to run it");
  assert.ok(row.error, "the reason is recorded on the row, not just returned");
  assert.equal(row.userId, "user_local", "still stamped to whoever asked for it");
  // The agent's version at dispatch time is snapshotted, and the project↔agent link is made.
  assert.equal(row.agentVersion, "9.9.9");
  assert.ok(
    db
      .select()
      .from(schema.projectAgents)
      .where(eq(schema.projectAgents.projectId, "p1"))
      .get(),
  );
});

test("a pre-allocated id is honoured — uploads are already stored under it", async () => {
  const outcome = await dispatch.createAndStartTask({
    taskId: "task_preallocated",
    projectId: "p1",
    agentId: "fe@bundled",
    command: "task",
    userId: "user_local",
  });
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.equal(outcome.taskId, "task_preallocated");
  assert.ok(
    db.select().from(schema.tasks).where(eq(schema.tasks.id, "task_preallocated")).get(),
  );
});

test("a caller-supplied title is stored, which is what suppresses the naming call", async () => {
  // The runner only names a task whose row has no title, so storing one here is the whole
  // mechanism by which a backlog run avoids paying for a Haiku summary of its own request.
  const outcome = await dispatch.createAndStartTask({
    projectId: "p1",
    agentId: "fe@bundled",
    command: "task",
    userId: "user_local",
    requestText: "implement the thing",
    title: "Add Invoice Approval Flow",
  });
  assert.equal(outcome.ok, false); // runner is unreachable; the row still exists
  if (outcome.ok) return;
  const row = db.select().from(schema.tasks).where(eq(schema.tasks.id, outcome.taskId!)).get()!;
  assert.equal(row.title, "Add Invoice Approval Flow");
});

test("a title is normalised, and a useless one stays null so the runner still names it", async () => {
  const cases: [string | null | undefined, string | null][] = [
    ["  Spaced   out\n title ", "Spaced out title"],
    ["   ", null],
    ["", null],
    [null, null],
    [undefined, null],
    ["x".repeat(200), "x".repeat(80)],
    // Cut by code point: slicing UTF-16 units would end this mid-surrogate-pair and render a
    // replacement character in every task list.
    [`${"🙂".repeat(90)}tail`, "🙂".repeat(80)],
    [`${"e".repeat(79)}🙂 more`, `${"e".repeat(79)}🙂`],
  ];
  for (const [given, want] of cases) {
    const outcome = await dispatch.createAndStartTask({
      projectId: "p1",
      agentId: "fe@bundled",
      command: "task",
      userId: "user_local",
      title: given,
    });
    assert.equal(outcome.ok, false);
    if (outcome.ok) return;
    const row = db.select().from(schema.tasks).where(eq(schema.tasks.id, outcome.taskId!)).get()!;
    assert.equal(row.title, want, `title ${JSON.stringify(given)}`);
  }
});

test("a user who can't run tasks is refused before any row exists", async () => {
  delete process.env.ALLOW_SHARED_TOKEN_FALLBACK;
  try {
    const before = db.select().from(schema.tasks).all().length;
    const refusal = dispatch.dispatchRefusal("user_local");
    assert.ok(refusal, "no token and no fallback must refuse");
    assert.equal(refusal!.status, 412);
    assert.equal(refusal!.needsToken, true);

    const outcome = await dispatch.createAndStartTask({
      projectId: "p1",
      agentId: "fe@bundled",
      command: "task",
      userId: "user_local",
    });
    assert.equal(outcome.ok, false);
    if (!outcome.ok) assert.equal(outcome.status, 412);
    assert.equal(
      db.select().from(schema.tasks).all().length,
      before,
      "a refused dispatch must not leave a task row behind",
    );
  } finally {
    process.env.ALLOW_SHARED_TOKEN_FALLBACK = "1";
  }
});

test("the parallel flag is refused where no worktree can exist, before any row is made", async () => {
  const rows = db.select().from(schema.tasks).all().length;

  // p1 is not a git repo — there is nothing to make a worktree of.
  const nonGit = await dispatch.createAndStartTask({
    projectId: "p1",
    agentId: "fe@bundled",
    command: "task",
    userId: "user_local",
    parallel: true,
  });
  assert.equal(nonGit.ok, false);
  if (!nonGit.ok) {
    assert.equal(nonGit.status, 400);
    assert.match(nonGit.error, /git repository/);
  }

  // A workspace spans several member repos — "the" worktree is ambiguous.
  db.insert(schema.projects)
    .values({ id: "p_ws", name: "WS", path: join(root, "ws"), isGit: true, isWorkspace: true })
    .run();
  const ws = await dispatch.createAndStartTask({
    projectId: "p_ws",
    agentId: "fe@bundled",
    command: "task",
    userId: "user_local",
    parallel: true,
  });
  assert.equal(ws.ok, false);
  if (!ws.ok) {
    assert.equal(ws.status, 400);
    assert.match(ws.error, /workspace/);
  }

  assert.equal(
    db.select().from(schema.tasks).all().length,
    rows,
    "a refused parallel dispatch must not leave a task row behind",
  );
});

test("the parallel flag is stored on a git project's task; the default stays false", async () => {
  db.insert(schema.projects)
    .values({ id: "p_git", name: "Git", path: join(root, "git-proj"), isGit: true })
    .run();

  const flagged = await dispatch.createAndStartTask({
    projectId: "p_git",
    agentId: "fe@bundled",
    command: "task",
    userId: "user_local",
    parallel: true,
  });
  assert.equal(flagged.ok, false); // runner unreachable; the row still exists
  if (!flagged.ok) {
    const row = db
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.id, flagged.taskId!))
      .get()!;
    assert.equal(row.parallel, true, "the runner reads the opt-in off the row");
  }

  const plain = await dispatch.createAndStartTask({
    projectId: "p_git",
    agentId: "fe@bundled",
    command: "task",
    userId: "user_local",
  });
  assert.equal(plain.ok, false);
  if (!plain.ok) {
    const row = db
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.id, plain.taskId!))
      .get()!;
    assert.equal(row.parallel, false, "queueing stays the default");
  }
});
