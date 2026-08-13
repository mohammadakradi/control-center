/**
 * The `add_backlog_item` MCP tool. What's worth asserting here isn't the happy path — it's the
 * refusals, because this tool is reachable by a model: it must not be able to write into another
 * project's backlog, fill the disk, or take the session down by making the handler throw.
 *
 * Runs against a throwaway SQLite file built from the real schema via `drizzle-kit push`, never
 * the app's own `data/platform.db`.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, before } from "node:test";
import assert from "node:assert/strict";

const dir = mkdtempSync(join(tmpdir(), "platform-backlog-tool-test-"));
const dbFile = join(dir, "test.db");

// Point the shared connection at the throwaway file BEFORE lib/db is imported.
process.env.PLATFORM_DB = dbFile;

type Db = typeof import("../lib/db").db;
type Schema = typeof import("../lib/db/schema");
let db: Db;
let backlogItems: Schema["backlogItems"];
let eq: typeof import("drizzle-orm").eq;
let makeBacklogTool: typeof import("./backlog-tool").makeBacklogTool;
let MAX_AGENT_ITEMS_PER_TASK: number;
let MAX_AGENT_DESCRIPTION_LENGTH: number;
let MAX_TITLE_LENGTH: number;
let MAX_DESCRIPTION_LENGTH: number;
let MAX_ITEMS_PER_PROJECT: number;

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
  ({ backlogItems } = await import("../lib/db/schema"));
  ({ eq } = await import("drizzle-orm"));

  // Guard: if the env override ever stopped working, fail loudly rather than writing to the
  // real database.
  const file = (db.$client as { name: string }).name;
  assert.equal(file, dbFile, `refusing to run: connected to ${file}`);

  ({ makeBacklogTool, MAX_AGENT_ITEMS_PER_TASK, MAX_AGENT_DESCRIPTION_LENGTH } = await import(
    "./backlog-tool"
  ));
  ({ MAX_TITLE_LENGTH, MAX_DESCRIPTION_LENGTH, MAX_ITEMS_PER_PROJECT } = await import(
    "../lib/backlog"
  ));

  // `projects.path` is unique, so each fixture needs its own directory.
  const { projects } = await import("../lib/db/schema");
  db.insert(projects).values({ id: "p1", name: "One", path: join(dir, "one") }).run();
  db.insert(projects).values({ id: "p2", name: "Two", path: join(dir, "two") }).run();
  db.insert(projects).values({ id: "pfull", name: "Full", path: join(dir, "full") }).run();
});

after(() => rmSync(dir, { recursive: true, force: true }));

/** The tool as one session sees it, plus the transcript lines it produced. */
function session(projectId = "p1") {
  const logs: string[] = [];
  const def = makeBacklogTool({ projectId, onLog: (m) => logs.push(m) });
  const call = (args: Record<string, unknown>) =>
    def.handler(args as never, undefined) as Promise<{
      content: { type: string; text: string }[];
      isError?: boolean;
    }>;
  return { def, call, logs };
}

const textOf = (r: { content: { text: string }[] }) => r.content[0].text;

function itemsIn(projectId: string) {
  return db.select().from(backlogItems).where(eq(backlogItems.projectId, projectId)).all();
}

test("records an item as agent-sourced, unstarted, and not file-backed", async () => {
  const { call, logs } = session();
  const res = await call({ title: "Add CSRF checks to mutating routes" });

  assert.equal(res.isError, undefined);
  const rows = itemsIn("p1");
  assert.equal(rows.length, 1);
  const item = rows[0];
  assert.equal(item.title, "Add CSRF checks to mutating routes");
  assert.equal(item.source, "agent");
  assert.equal(item.status, "todo");
  // Nothing here is a human's decision, and no file owns it — so neither the override nor a
  // sync key may be set, or the sync/reflection rules would treat it as something it isn't.
  assert.equal(item.statusOverride, false);
  assert.equal(item.sourcePath, null);
  assert.equal(item.linkedTaskId, null);
  // The model needs the id back to be able to refer to what it filed.
  assert.match(textOf(res), new RegExp(item.id));
  assert.deepEqual(logs, ['📋 Added to the backlog: "Add CSRF checks to mutating routes"']);
});

test("stores description and assignee, and leaves assignee unset when omitted", async () => {
  const { call } = session();
  await call({
    title: "Extract a shared Chip base",
    description: "Three components repeat the same badge markup.",
    assignee: "fe",
  });
  await call({ title: "Rotate the vault master key" });

  const [chip] = itemsIn("p1").filter((i) => i.title === "Extract a shared Chip base");
  assert.equal(chip.assignee, "fe");
  assert.equal(chip.description, "Three components repeat the same badge markup.");

  const [rotate] = itemsIn("p1").filter((i) => i.title === "Rotate the vault master key");
  assert.equal(rotate.assignee, null);
  assert.equal(rotate.description, "");
});

test("an unscopable finding can be filed to pm for investigation", async () => {
  // The escalation path: an agent that knows something is wrong but not what the fix is hands
  // it to pm rather than inventing a task nobody can act on. The run route dispatches a
  // pm-assigned item as `/pm:plan`.
  const { call, def } = session();
  // Asked of the schema itself: the enum is the only thing standing between the model and an
  // assignee the backlog can't route to.
  const assignee = (def.inputSchema as Record<string, { safeParse(v: unknown): { success: boolean } }>)
    .assignee;
  for (const ok of ["fe", "swe", "pm", undefined]) {
    assert.equal(assignee.safeParse(ok).success, true, `${ok} must be accepted`);
  }
  for (const bad of ["dba", "PM", "pm ", ""]) {
    assert.equal(assignee.safeParse(bad).success, false, `${bad} must be rejected`);
  }

  await call({
    title: "Uploads intermittently fail on the installed app",
    description: "Seen twice; couldn't reproduce. Needs someone to scope it properly.",
    assignee: "pm",
  });
  const [item] = itemsIn("p1").filter((i) => i.assignee === "pm");
  assert.ok(item, "pm must be storable as an assignee");
  assert.equal(item.status, "todo");
});

test("takes no project argument — a forged one cannot redirect the write", async () => {
  // The schema is the contract the model sees: if a project key ever appears in it, an agent
  // can file work into a backlog that isn't the one it's working in.
  assert.deepEqual(Object.keys(session().def.inputSchema), [
    "title",
    "description",
    "assignee",
  ]);

  const { call } = session("p1");
  await call({ title: "Scoped to the session's project", projectId: "p2", project_id: "p2" });

  assert.equal(itemsIn("p2").length, 0);
  assert.equal(
    itemsIn("p1").filter((i) => i.title === "Scoped to the session's project").length,
    1,
  );
});

test("scrubs the task's credentials out of what it stores", async () => {
  // The row is readable by every workspace and travels in export archives, so it must not be
  // usable as a place to park the owner's token — `record()`'s transcript scrubbing doesn't
  // cover a database write.
  const logs: string[] = [];
  const def = makeBacklogTool({
    projectId: "p1",
    onLog: (m) => logs.push(m),
    redact: (text) => text.replaceAll("sk-ant-oat01-SECRET", "[redacted]"),
  });
  await def.handler(
    {
      title: "Purge sk-ant-oat01-SECRET from the logs",
      description: "The token sk-ant-oat01-SECRET is in the log output.",
    } as never,
    undefined,
  );

  const [item] = itemsIn("p1").filter((i) => i.title.startsWith("Purge "));
  assert.equal(item.title, "Purge [redacted] from the logs");
  assert.equal(item.description, "The token [redacted] is in the log output.");
  assert.ok(!logs.join(" ").includes("sk-ant-oat01-SECRET"), logs.join(" "));
});

test("collapses control characters in a title rather than refusing", async () => {
  const { call } = session();
  const res = await call({ title: "Line one\nLine\ttwo" });

  assert.equal(res.isError, undefined);
  // A newline in a title would forge a line in the preamble a dispatched run is handed.
  const titles = itemsIn("p1").map((i) => i.title);
  assert.ok(titles.includes("Line one Line two"), titles.join(" | "));
});

test("refuses an empty title and writes nothing", async () => {
  const { call, logs } = session();
  const before = itemsIn("p1").length;
  const res = await call({ title: "   " });

  assert.equal(res.isError, true);
  assert.match(textOf(res), /title cannot be empty/);
  assert.equal(itemsIn("p1").length, before);
  // A refusal is logged too: "the agent said it filed it" must never be silent.
  assert.match(logs[0], /not added/);
});

test("refuses an over-long title or description", async () => {
  const { call } = session();
  const before = itemsIn("p1").length;

  const long = await call({ title: "x".repeat(MAX_TITLE_LENGTH + 1) });
  assert.equal(long.isError, true);
  assert.match(textOf(long), new RegExp(`${MAX_TITLE_LENGTH} characters`));

  const fat = await call({
    title: "Reasonable title",
    description: "y".repeat(MAX_DESCRIPTION_LENGTH + 1),
  });
  assert.equal(fat.isError, true);

  // An agent gets a much smaller body allowance than a person typing: it can max the field out
  // on every call, and the whole backlog is returned on every load.
  assert.ok(MAX_AGENT_DESCRIPTION_LENGTH < MAX_DESCRIPTION_LENGTH);
  const wordy = await call({
    title: "Also reasonable",
    description: "z".repeat(MAX_AGENT_DESCRIPTION_LENGTH + 1),
  });
  assert.equal(wordy.isError, true);
  assert.match(textOf(wordy), new RegExp(`${MAX_AGENT_DESCRIPTION_LENGTH} characters`));

  const atLimit = await call({
    title: "Right at the limit",
    description: "z".repeat(MAX_AGENT_DESCRIPTION_LENGTH),
  });
  assert.equal(atLimit.isError, undefined, textOf(atLimit));

  assert.equal(itemsIn("p1").length, before + 1);
});

test("answers a repeated add with the item already on the list", async () => {
  const { call } = session();
  const first = await call({ title: "Dedupe me", description: "original" });
  const second = await call({ title: "Dedupe me", description: "retried" });

  const rows = itemsIn("p1").filter((i) => i.title === "Dedupe me");
  assert.equal(rows.length, 1, "a retried tool call must not produce a second item");
  // Not an error: the work IS on the backlog, which is what the caller wanted.
  assert.equal(second.isError, undefined);
  assert.match(textOf(second), /Already in this project's backlog/);
  assert.match(textOf(second), new RegExp(rows[0].id));
  assert.match(textOf(first), /Added to this project/);
  assert.equal(rows[0].description, "original", "the first add's body is not overwritten");
});

test("a closed item does not block filing the same work again", async () => {
  const { call } = session();
  await call({ title: "Recurring chore" });
  db.update(backlogItems)
    .set({ status: "done" })
    .where(eq(backlogItems.title, "Recurring chore"))
    .run();

  await call({ title: "Recurring chore" });
  assert.equal(itemsIn("p1").filter((i) => i.title === "Recurring chore").length, 2);
});

test("caps how many items one task may add, per session", async () => {
  const { call } = session("p2");
  for (let i = 0; i < MAX_AGENT_ITEMS_PER_TASK; i += 1) {
    const ok = await call({ title: `Item ${i}` });
    assert.equal(ok.isError, undefined, `add ${i} should have succeeded`);
  }
  const over = await call({ title: "One too many" });

  assert.equal(over.isError, true);
  assert.match(textOf(over), /limit for one run/);
  assert.equal(itemsIn("p2").length, MAX_AGENT_ITEMS_PER_TASK);

  // The allowance is per launch, not per project — a continued task gets its own.
  const next = session("p2");
  assert.equal((await next.call({ title: "Fresh session" })).isError, undefined);
  assert.equal(itemsIn("p2").length, MAX_AGENT_ITEMS_PER_TASK + 1);
});

test("refuses once the project's backlog is full", async () => {
  db.transaction((tx) => {
    for (let i = 0; i < MAX_ITEMS_PER_PROJECT; i += 1) {
      tx.insert(backlogItems)
        .values({ id: `bli_fill_${i}`, projectId: "pfull", title: `Filler ${i}` })
        .run();
    }
  });

  const res = await session("pfull").call({ title: "No room" });
  assert.equal(res.isError, true);
  assert.match(textOf(res), /backlog is full/);
  assert.equal(itemsIn("pfull").length, MAX_ITEMS_PER_PROJECT);
});

test("refuses — rather than orphaning a row — when the project is gone", async () => {
  const res = await session("p_deleted").call({ title: "Nowhere to put this" });

  assert.equal(res.isError, true);
  assert.match(textOf(res), /no longer registered/);
  assert.equal(itemsIn("p_deleted").length, 0);
});

test("is registered on the platform MCP server alongside the gate tool", async () => {
  // Asserted here rather than in its own file because this spec already has PLATFORM_DB
  // pointed at a throwaway database — importing the server pulls in lib/db.
  const { makePlatformServer, platformTools } = await import("./platform-mcp");
  const opts = {
    onGate: async () => ({ allow: true }),
    backlog: { projectId: "p1" },
  };

  assert.deepEqual(
    platformTools(opts).map((t) => t.name),
    ["request_approval", "add_backlog_item"],
  );
  // And the SDK accepts the pair: a malformed tool definition throws here, at server
  // construction, not at the point the definition was built.
  const server = makePlatformServer(opts);
  assert.equal(server.type, "sdk");
  assert.equal(server.name, "swe-platform");
});

test("a transcript line that fails neither fails the add nor escapes the handler", async () => {
  // `onLog` is `record()`, which writes to the database, so it can fail on its own. Two things
  // must not happen: the caller being told the add failed when the row is committed, and the
  // throw escaping — the handler's own catch calls refuse(), which logs, so an unguarded log
  // would rethrow out of the catch and reject the handler, taking the whole task down.
  const def = makeBacklogTool({
    projectId: "p1",
    onLog: () => {
      throw new Error("task_events write failed");
    },
  });
  const call = (args: Record<string, unknown>) =>
    def.handler(args as never, undefined) as Promise<{
      content: { text: string }[];
      isError?: boolean;
    }>;

  const ok = await call({ title: "Survives a broken transcript" });
  assert.equal(ok.isError, undefined, textOf(ok));
  assert.match(textOf(ok), /Added to this project/);
  assert.equal(
    itemsIn("p1").filter((i) => i.title === "Survives a broken transcript").length,
    1,
    "the row must be reported as added because it was added",
  );

  // The refusal path logs too, so it has to survive the same failure.
  const bad = await call({ title: "" });
  assert.equal(bad.isError, true);
  assert.match(textOf(bad), /title cannot be empty/);
});

test("a retry after the per-task cap still gets the idempotent answer", async () => {
  const { call } = session("p2");
  await call({ title: "Filed early" });
  for (let i = 1; i < MAX_AGENT_ITEMS_PER_TASK; i += 1) {
    await call({ title: `Filler ${i}` });
  }

  // The allowance is spent, but this call asks for something already on the list — answering
  // "you've added too many" would be a worse answer than "it's already there".
  const retry = await call({ title: "Filed early" });
  assert.equal(retry.isError, undefined, textOf(retry));
  assert.match(retry.content[0].text, /Already in this project's backlog/);

  const fresh = await call({ title: "Genuinely new" });
  assert.equal(fresh.isError, true, "a new item is still refused once the allowance is spent");
});

test("never throws out of the handler, even on input the schema would have rejected", async () => {
  const { call } = session();
  // A rejected MCP handler surfaces as a session-level error — it takes the whole task down,
  // not just the tool call. So every path, including ones only reachable if the zod schema is
  // ever loosened, has to come back as an ordinary isError result.
  const res = await call({ title: 42 });

  assert.equal(res.isError, true);
  assert.match(textOf(res), /title must be a string/);
});
