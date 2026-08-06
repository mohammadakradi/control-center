/**
 * Agent discovery: the plugins bundled with the app, and how a discovered agent lands in the DB.
 *
 * The bundle is what a fresh install has — a new device carries neither the agent directories
 * nor the Claude Code marketplace entries pointing at them, so without it the agent list is
 * empty and nothing can be dispatched. The DB tests cover the risky half: an agent arriving
 * under a different plugin id than last time must reuse its row, because `tasks.agent_id` is
 * ON DELETE CASCADE and a second row would strand (or a prune would destroy) its history.
 *
 * Runs against a throwaway SQLite file built from the real schema — never `data/platform.db`.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test, { after, before } from "node:test";
import assert from "node:assert/strict";

const dir = mkdtempSync(join(tmpdir(), "platform-agents-test-"));
const dbFile = join(dir, "test.db");
const repoRoot = resolve(import.meta.dirname, "../..");

// Point the shared connection at the throwaway file BEFORE lib/db is imported.
process.env.PLATFORM_DB = dbFile;

type Mod = typeof import("./agents");
let discoverBundledAgents: Mod["discoverBundledAgents"];
let syncAgents: Mod["syncAgents"];
let db: (typeof import("../db"))["db"];
let schema: typeof import("../db/schema");

/** A plugin directory on disk, as `claude plugin` lays one out. */
function writePlugin(
  root: string,
  name: string,
  manifest: Record<string, unknown>,
  commands: Record<string, string> = {},
) {
  const pluginDir = join(root, name);
  mkdirSync(join(pluginDir, ".claude-plugin"), { recursive: true });
  writeFileSync(
    join(pluginDir, ".claude-plugin/plugin.json"),
    JSON.stringify(manifest),
  );
  if (Object.keys(commands).length) mkdirSync(join(pluginDir, "commands"));
  for (const [file, body] of Object.entries(commands)) {
    writeFileSync(join(pluginDir, "commands", file), body);
  }
  return pluginDir;
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
    { cwd: repoRoot, stdio: "pipe" },
  );

  ({ db } = await import("../db"));
  schema = await import("../db/schema");
  ({ discoverBundledAgents, syncAgents } = await import("./agents"));

  // Guard: if the env override ever stopped working, fail loudly rather than writing the
  // real database.
  const file = (db.$client as { name: string }).name;
  assert.equal(file, dbFile, `refusing to run: connected to ${file}`);

  db.insert(schema.projects)
    .values({ id: "p1", name: "P", path: dir })
    .run();
});

after(() => rmSync(dir, { recursive: true, force: true }));

test("the shipped bundle carries swe, fe and pm with their commands", () => {
  const found = discoverBundledAgents(join(repoRoot, "agents"));
  const byNamespace = new Map(found.map((a) => [a.namespace, a]));

  assert.deepEqual([...byNamespace.keys()].sort(), ["fe", "pm", "swe"]);
  for (const [namespace, agent] of byNamespace) {
    assert.equal(agent.id, `${namespace}@bundled`);
    assert.equal(agent.sourcePath, join(repoRoot, "agents", namespace));
    assert.ok(agent.version, `${namespace} has no version`);
    // The runner dispatches `/<namespace>:<command>`; no commands means nothing to run.
    assert.ok(
      (agent.commands ?? []).some((c) => c.full === `/${namespace}:task`) ||
        (agent.commands ?? []).length > 0,
      `${namespace} exposes no commands`,
    );
  }
});

test("bundled discovery reads the manifest and skips non-plugin directories", () => {
  const root = join(dir, "bundle");
  mkdirSync(root, { recursive: true });
  writePlugin(
    root,
    "demo",
    { name: "dx", version: "1.2.3", description: "Demo agent" },
    {
      "task.md": "---\ndescription: Do a task\nargument-hint: <what>\n---\nbody",
      "notes.txt": "ignored — not a command",
    },
  );
  mkdirSync(join(root, "not-a-plugin"), { recursive: true });

  const found = discoverBundledAgents(root);
  assert.equal(found.length, 1);
  const [agent] = found;
  // The manifest name wins over the directory name — it's what the slash command uses.
  assert.equal(agent.namespace, "dx");
  assert.equal(agent.id, "dx@bundled");
  assert.equal(agent.pluginId, "dx@bundled");
  assert.equal(agent.scope, "bundled");
  assert.equal(agent.version, "1.2.3");
  assert.equal(agent.description, "Demo agent");
  assert.deepEqual(agent.commands, [
    {
      name: "task",
      full: "/dx:task",
      description: "Do a task",
      argumentHint: "<what>",
    },
  ]);
});

test("a missing bundle is not an error", () => {
  assert.deepEqual(discoverBundledAgents(join(dir, "nope")), []);
});

test("an agent re-discovered under a new plugin id keeps its row and history", () => {
  // Existing install: swe came from a CLI-registered local marketplace, and has run a task.
  db.insert(schema.agents)
    .values({
      id: "swe@swe-agent-local",
      name: "swe",
      namespace: "swe",
      sourcePath: "/Users/someone/Dev/agent/swe-agent",
      pluginId: "swe@swe-agent-local",
      scope: "user",
    })
    .run();
  db.insert(schema.tasks)
    .values({
      id: "t1",
      projectId: "p1",
      agentId: "swe@swe-agent-local",
      command: "task",
    })
    .run();

  // That marketplace is gone (moved to another device); only the bundled copy is left.
  syncAgents([
    {
      id: "swe@bundled",
      name: "swe",
      namespace: "swe",
      version: "0.8.0",
      sourcePath: "/app/agents/swe",
      pluginId: "swe@bundled",
      scope: "bundled",
      commands: [],
    },
  ]);

  const rows = db.select().from(schema.agents).all();
  assert.equal(rows.length, 1, "a second row would strand the task's history");
  assert.equal(rows[0].id, "swe@swe-agent-local", "the row id is the FK target");
  assert.equal(rows[0].sourcePath, "/app/agents/swe");
  assert.equal(rows[0].pluginId, "swe@bundled");
  assert.equal(rows[0].scope, "bundled");
  assert.equal(rows[0].version, "0.8.0");
  assert.equal(db.select().from(schema.tasks).all().length, 1);
});

test("an agent that is gone is pruned only when it has no tasks", () => {
  db.insert(schema.agents)
    .values({
      id: "fe@bundled",
      name: "fe",
      namespace: "fe",
      sourcePath: "/app/agents/fe",
      pluginId: "fe@bundled",
    })
    .run();

  syncAgents([]); // nothing discovered at all

  const namespaces = db
    .select()
    .from(schema.agents)
    .all()
    .map((a) => a.namespace);
  assert.deepEqual(namespaces, ["swe"], "fe had no history; swe does");
});
