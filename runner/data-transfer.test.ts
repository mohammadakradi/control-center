/**
 * Specs for moving data between installs.
 *
 * The two properties that matter: nothing is lost that should travel (tasks, transcripts and
 * the usage figures hanging off them), and nothing travels that shouldn't (sessions — live
 * login cookies — and tokens unless explicitly asked for). The third is that a damaged source
 * costs you the damaged rows and not the export.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import BetterSqlite3 from "better-sqlite3";
import { buildExportDatabase, checkCompatibility } from "../lib/data-transfer";
import { migrateDatabase } from "../lib/db/migrate";

const repo = resolve(import.meta.dirname, "..");
const migrationsFolder = resolve(repo, "drizzle");
const dirs: string[] = [];

function workspace() {
  const dir = mkdtempSync(join(tmpdir(), "platform-transfer-"));
  dirs.push(dir);
  return dir;
}

/** A populated source install: two owners, a project, an agent, tasks with usage, a
 *  transcript, and a live session that must not travel. */
function sourceInstall(): string {
  const dir = workspace();
  const dbPath = join(dir, "platform.db");
  migrateDatabase({ dbPath, migrationsFolder, backup: false });
  const db = new BetterSqlite3(dbPath);
  db.prepare("INSERT INTO users (id, email, password_hash) VALUES (?,?,?)").run(
    "user_a",
    "a@example.com",
    "hash",
  );
  db.prepare("INSERT INTO projects (id, name, path) VALUES (?,?,?)").run("p1", "P", dir);
  db.prepare(
    "INSERT INTO agents (id, name, namespace, source_path, plugin_id) VALUES (?,?,?,?,?)",
  ).run("a1", "A", "swe", dir, "plug");
  db.prepare(
    `INSERT INTO tasks (id, project_id, agent_id, command, request_text, status, user_id,
       usage_input_tokens, usage_output_tokens, usage_cost_usd)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
  ).run("t1", "p1", "a1", "task", "do it", "done", "user_a", 1234, 567, 0.42);
  db.prepare(
    "INSERT INTO task_events (task_id, type, payload, ts) VALUES (?,?,?,?)",
  ).run("t1", "text", JSON.stringify({ text: "hello" }), Date.now());
  db.prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES (?,?,?)").run(
    "session_hash",
    "user_a",
    Date.now() + 100000,
  );
  db.close();
  return dbPath;
}

test.after(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

test("an export carries tasks, transcripts and their usage figures", () => {
  const sourceDb = sourceInstall();
  const destDb = join(workspace(), "export.db");
  const { tables } = buildExportDatabase({
    sourceDb,
    destDb,
    migrationsFolder,
  });

  const byTable = Object.fromEntries(tables.map((t) => [t.table, t.copied]));
  assert.equal(byTable.tasks, 1);
  assert.equal(byTable.task_events, 1, "the transcript travels — it's where usage is recomputed from");
  assert.equal(byTable.projects, 1);

  const db = new BetterSqlite3(destDb);
  const task = db.prepare("SELECT * FROM tasks WHERE id = 't1'").get() as Record<string, number>;
  assert.equal(task.usage_input_tokens, 1234, "usage must survive — the whole point of exporting");
  assert.equal(task.usage_output_tokens, 567);
  assert.equal(task.usage_cost_usd, 0.42);
  db.close();
});

test("sessions never travel", () => {
  const sourceDb = sourceInstall();
  const destDb = join(workspace(), "export.db");
  buildExportDatabase({ sourceDb, destDb, migrationsFolder });

  const db = new BetterSqlite3(destDb);
  const sessions = db.prepare("SELECT COUNT(*) FROM sessions").pluck().get() as number;
  db.close();
  assert.equal(sessions, 0, "a login cookie copied to another machine would grant access there");
});

test("owners travel with their tasks", () => {
  const sourceDb = sourceInstall();
  const destDb = join(workspace(), "export.db");
  buildExportDatabase({ sourceDb, destDb, migrationsFolder });

  const db = new BetterSqlite3(destDb);
  const owner = db.prepare("SELECT user_id FROM tasks WHERE id='t1'").pluck().get();
  const emails = db.prepare("SELECT email FROM users ORDER BY email").pluck().all();
  db.close();
  assert.equal(owner, "user_a");
  assert.ok((emails as string[]).includes("a@example.com"), "the account has to exist to sign into");
  assert.ok((emails as string[]).includes("local@device"), "and so does the local workspace");
});

test("a damaged table costs its rows, not the export", () => {
  const sourceDb = sourceInstall();
  // Simulate the failure the row-by-row copy exists for: make one table unreadable while
  // leaving the rest of the database perfectly fine.
  const db = new BetterSqlite3(sourceDb);
  db.exec("DROP TABLE task_events");
  db.exec("CREATE VIEW task_events AS SELECT * FROM nonexistent_table");
  db.close();

  const destDb = join(workspace(), "export.db");
  const { tables, warnings } = buildExportDatabase({
    sourceDb,
    destDb,
    migrationsFolder,
  });

  const events = tables.find((t) => t.table === "task_events");
  assert.equal(events?.copied, 0, "nothing readable in the broken table");
  assert.ok(
    warnings.some((w) => w.includes("task_events")),
    `the loss must be reported, not silent — got ${JSON.stringify(warnings)}`,
  );
  // …and everything else still made it.
  assert.equal(tables.find((t) => t.table === "tasks")?.copied, 1);

  const out = new BetterSqlite3(destDb);
  assert.equal(out.prepare("SELECT COUNT(*) FROM tasks").pluck().get(), 1);
  out.close();
});

test("an archive from a newer app is refused rather than half-understood", () => {
  const manifest = {
    app: "control-center" as const,
    version: "9.9.9",
    exportedAt: "now",
    migrations: ["0000_init", "0001_local_workspace", "0002_from_the_future"],
    tables: [],
    uploads: 0,
    includesTokens: false,
    warnings: [],
  };
  const verdict = checkCompatibility(manifest, ["0000_init", "0001_local_workspace"]);
  assert.equal(verdict.ok, false);
  if (!verdict.ok) {
    assert.match(verdict.reason, /0002_from_the_future/);
    assert.match(verdict.reason, /Update first/);
  }

  const fine = checkCompatibility(
    { ...manifest, migrations: ["0000_init"] },
    ["0000_init", "0001_local_workspace"],
  );
  assert.equal(fine.ok, true, "an older archive is fine — migrations bring it forward");
});
