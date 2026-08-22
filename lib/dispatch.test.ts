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

// -------------------------------------------------- offering the parallel choice

/** A live run in a project's own checkout — what makes the checkout busy. */
function liveTask(id: string, projectId: string, workdir: string | null = null) {
  db.insert(schema.tasks)
    .values({
      id,
      projectId,
      agentId: "fe@bundled",
      userId: "user_local",
      command: "task",
      status: "running",
      workdir,
    })
    .run();
  return () => db.delete(schema.tasks).where(eq(schema.tasks.id, id)).run();
}

test("the offer no longer depends on busyness — isolation is the default wherever it can work", () => {
  // 2026-08-22: the offer used to require a busy checkout at render time, which made it a
  // page-load snapshot (the first dispatch against a free checkout never saw it) and let a
  // feature-linked run land in the checkout, check the feature branch out there, and block
  // every isolated sibling's merge-back. Now the offer is exactly "where the dispatch accepts
  // the flag": busy, free, or busy-only-with-isolated-runs must all answer the same.
  db.insert(schema.projects)
    .values({ id: "p_busy", name: "Busy", path: join(root, "busy"), isGit: true })
    .run();
  const project = { id: "p_busy", isGit: true, isWorkspace: false };

  assert.equal(dispatch.parallelOffer(project), true, "offered on a free checkout too");

  const dropIsolated = liveTask("task_isolated", "p_busy", join(root, "worktrees", "t1"));
  assert.equal(dispatch.parallelOffer(project), true, "an isolated run changes nothing");

  const dropCheckout = liveTask("task_in_checkout", "p_busy");
  assert.equal(dispatch.parallelOffer(project), true, "a busy checkout changes nothing");

  dropIsolated();
  dropCheckout();
});

test("the offer and the dispatch's refusal cannot drift apart", async () => {
  // The whole reason `parallelOffer` lives beside `createAndStartTask`: offering the flag where
  // the dispatch answers 400 turns a click into an error the user can do nothing about, and
  // withholding it where the dispatch would take it queues a task for no reason. So assert the
  // two agree on the same rows rather than restating either one's logic.
  //
  // The token gate is asserted rather than assumed. `dispatchRefusal` runs *before* the parallel
  // check, so a missing `ALLOW_SHARED_TOKEN_FALLBACK` turns every case below into a 412 and this
  // spec would read "the flag was accepted" for all three — a silent false pass for the two that
  // must be refused. Another test in this file deletes that variable and restores it in a
  // `finally`, so the value is process-global state this spec shares; review caught it failing
  // once, non-reproducibly, which is exactly what that coupling looks like. Set it here so this
  // spec doesn't depend on execution order, and check it below so a 412 is a loud, named failure
  // rather than a mystery.
  process.env.ALLOW_SHARED_TOKEN_FALLBACK = "1";
  db.insert(schema.projects)
    .values([
      { id: "p_off_git", name: "Git", path: join(root, "off-git"), isGit: true },
      { id: "p_off_plain", name: "Plain", path: join(root, "off-plain"), isGit: false },
      {
        id: "p_off_ws",
        name: "WS",
        path: join(root, "off-ws"),
        isGit: true,
        isWorkspace: true,
      },
    ])
    .run();

  for (const id of ["p_off_git", "p_off_plain", "p_off_ws"]) {
    // Make every one of them busy, so the only thing left deciding the offer is the project.
    const drop = liveTask(`task_busy_${id}`, id);
    const project = db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, id))
      .get()!;
    const offered = dispatch.parallelOffer(project);

    const outcome = await dispatch.createAndStartTask({
      projectId: id,
      agentId: "fe@bundled",
      command: "task",
      userId: "user_local",
      parallel: true,
    });
    // The runner is unreachable, so an *accepted* flag fails at 502 with a row behind it —
    // that is what distinguishes it from the 400 the flag itself is refused with. Matched on
    // the message, not on 400 alone: another 400 added ahead of the parallel check would
    // otherwise let this spec keep passing while no longer testing what it says (raised by
    // review — the coupling should be explicit, not incidental).
    assert.equal(outcome.ok, false, `${id}: the runner is unreachable, nothing can succeed`);
    if (outcome.ok) return;
    assert.notEqual(
      outcome.status,
      412,
      `${id}: the token gate closed under this spec (ALLOW_SHARED_TOKEN_FALLBACK), so it never reached the parallel check — this is a test-setup failure, not a drift`,
    );
    const refusedTheFlag = outcome.status === 400 && /Parallel runs/.test(outcome.error);
    assert.equal(
      offered,
      !refusedTheFlag,
      `${id}: offered=${offered} but the dispatch answered ${outcome.status} ${outcome.error}`,
    );
    // And the accepted case really did get past the flag rather than failing some other way.
    if (offered) {
      assert.equal(outcome.status, 502, `${id}: expected the unreachable runner, not a refusal`);
    }
    drop();
  }
});

test("a non-git project and a workspace are never offered the choice, busy or not", () => {
  // Cheap first: neither needs the query, and both are the dispatch's own refusals.
  assert.equal(
    dispatch.parallelOffer({ id: "p_off_plain", isGit: false, isWorkspace: false }),
    false,
  );
  assert.equal(
    dispatch.parallelOffer({ id: "p_off_ws", isGit: true, isWorkspace: true }),
    false,
  );
});

// ------------------------------------------------------------------ features

test("a task's feature is stored on the row the runner reads", async () => {
  const feature = db
    .insert(schema.features)
    .values({ id: "f_disp", projectId: "p1", name: "Dispatchable", branch: "feature/disp" })
    .returning()
    .get();

  const outcome = await dispatch.createAndStartTask({
    projectId: "p1",
    agentId: "swe@swe-agent-local",
    command: "task",
    userId: "user_local",
    featureId: feature.id,
  });
  assert.equal(outcome.ok, false, "the runner is unreachable, but the row is written first");
  if (!outcome.ok) {
    const row = db
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.id, outcome.taskId!))
      .get()!;
    assert.equal(row.featureId, "f_disp");
    // "pending" from the moment a feature is linked, before the runner has even decided how
    // the task will run — so a queued or checkout-bound feature task reads as something,
    // not identically to a task with no feature at all.
    assert.equal(row.mergeState, "pending");
  }
});

test("mergeState stays null with no feature — there is nothing to merge", async () => {
  const outcome = await dispatch.createAndStartTask({
    projectId: "p1",
    agentId: "swe@swe-agent-local",
    command: "task",
    userId: "user_local",
  });
  assert.equal(outcome.ok, false);
  if (!outcome.ok) {
    const row = db
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.id, outcome.taskId!))
      .get()!;
    assert.equal(row.featureId, null);
    assert.equal(row.mergeState, null);
  }
});

test("no feature is the default, not an error", async () => {
  const outcome = await dispatch.createAndStartTask({
    projectId: "p1",
    agentId: "swe@swe-agent-local",
    command: "task",
    userId: "user_local",
  });
  assert.equal(outcome.ok, false);
  if (!outcome.ok) {
    const row = db
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.id, outcome.taskId!))
      .get()!;
    assert.equal(row.featureId, null);
  }
});

test("a feature from another project is refused before any task row exists", async () => {
  // The forgery that matters: a *real* feature id, belonging to a project the caller isn't
  // dispatching into. Silently dropping the link would hide the run from every grouped view;
  // storing it would put this project's work on another repo's feature branch once the runner
  // starts merging. So it is refused, like the `parallel` flag on a non-git project.
  db.insert(schema.projects).values({ id: "p_other", name: "Other", path: join(root, "o") }).run();
  db.insert(schema.features)
    .values({
      id: "f_elsewhere",
      projectId: "p_other",
      name: "Someone else's",
      branch: "feature/elsewhere",
    })
    .run();

  const before = db.select().from(schema.tasks).all().length;
  const outcome = await dispatch.createAndStartTask({
    projectId: "p1",
    agentId: "swe@swe-agent-local",
    command: "task",
    userId: "user_local",
    featureId: "f_elsewhere",
  });
  assert.equal(outcome.ok, false);
  if (!outcome.ok) {
    assert.equal(outcome.status, 400);
    assert.match(outcome.error, /feature of this project/);
    assert.equal(outcome.taskId, undefined, "refused before the row, so there is nothing to link");
  }
  assert.equal(db.select().from(schema.tasks).all().length, before, "no row was created");
});

test("a featureId naming nothing at all is refused the same way", async () => {
  const outcome = await dispatch.createAndStartTask({
    projectId: "p1",
    agentId: "swe@swe-agent-local",
    command: "task",
    userId: "user_local",
    featureId: "f_does_not_exist",
  });
  assert.equal(outcome.ok, false);
  if (!outcome.ok) assert.equal(outcome.status, 400);
});
