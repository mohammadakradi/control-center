/**
 * Specs for schema migrations. The scenario worth protecting is the upgrade of a database that
 * predates migrations: it has tables and real rows, no drizzle bookkeeping, and replaying the
 * initial migration against it would throw — or worse, in some other design, recreate its
 * tables empty. Every assertion here is about *not losing rows*.
 *
 * Each test builds its own throwaway database, never `data/platform.db`.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import BetterSqlite3 from "better-sqlite3";
import { migrateDatabase, readMigrations, schemaGaps } from "../lib/db/migrate";

const repo = resolve(import.meta.dirname, "..");
const migrationsFolder = resolve(repo, "drizzle");
const dirs: string[] = [];

function workspace() {
  const dir = mkdtempSync(join(tmpdir(), "platform-migrate-"));
  dirs.push(dir);
  return { dir, dbPath: join(dir, "platform.db") };
}

/** A database as `drizzle-kit push` would leave it: real tables, no bookkeeping table. */
function legacyDatabase(dbPath: string) {
  execFileSync(
    "npx",
    [
      "drizzle-kit",
      "push",
      "--dialect=sqlite",
      "--schema=./lib/db/schema.ts",
      `--url=${dbPath}`,
      "--force",
    ],
    { cwd: repo, stdio: "pipe" },
  );
  const db = new BetterSqlite3(dbPath);
  db.prepare("INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)").run(
    "user_legacy",
    "legacy@example.com",
    "hash",
  );
  db.prepare("INSERT INTO projects (id, name, path) VALUES (?, ?, ?)").run(
    "proj_legacy",
    "Legacy",
    "/tmp/legacy",
  );
  db.close();
}

test.after(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

test("the journal and the SQL files on disk agree", () => {
  const migrations = readMigrations(migrationsFolder);
  assert.ok(migrations.length > 0, "there should be at least the initial migration");
  for (const m of migrations) {
    assert.ok(m.sql.length > 0, `${m.tag} produced no statements`);
    assert.match(m.hash, /^[0-9a-f]{64}$/, `${m.tag} has no usable hash`);
  }
});

test("a fresh database gets every migration and matches the schema", () => {
  const { dbPath } = workspace();
  const outcome = migrateDatabase({ dbPath, migrationsFolder });

  assert.equal(outcome.created, true);
  assert.equal(outcome.adopted, false);
  assert.equal(outcome.backup, null, "nothing to snapshot when there was no database");
  assert.deepEqual(outcome.applied, readMigrations(migrationsFolder).map((m) => m.tag));

  const db = new BetterSqlite3(dbPath);
  assert.deepEqual(schemaGaps(db), [], "the ORM's tables and columns should all exist");
  db.close();
});

test("running again is a no-op — nothing re-applied, and no pointless snapshot", () => {
  const { dbPath } = workspace();
  migrateDatabase({ dbPath, migrationsFolder });
  const second = migrateDatabase({ dbPath, migrationsFolder });
  assert.deepEqual(second.applied, [], "nothing pending the second time");
  assert.equal(second.created, false);
  // `start` migrates on every launch; copying the database each time would fill the disk.
  assert.equal(second.backup, null, "no changes means no snapshot");
});

test("a pre-migrations database is adopted with its rows intact", () => {
  const { dbPath } = workspace();
  legacyDatabase(dbPath);

  const outcome = migrateDatabase({ dbPath, migrationsFolder });
  assert.equal(outcome.adopted, true, "should adopt rather than replay CREATE TABLEs");
  assert.deepEqual(outcome.applied, [], "the recorded migrations must not run again");
  assert.ok(outcome.backup && existsSync(outcome.backup), "must snapshot before adopting");

  const db = new BetterSqlite3(dbPath);
  assert.equal(
    db.prepare("SELECT email FROM users WHERE id = 'user_legacy'").pluck().get(),
    "legacy@example.com",
    "the existing user must survive adoption",
  );
  assert.equal(db.prepare("SELECT count(*) FROM projects").pluck().get(), 1);
  const recorded = db
    .prepare("SELECT count(*) FROM __drizzle_migrations")
    .pluck()
    .get() as number;
  assert.equal(recorded, readMigrations(migrationsFolder).length, "all migrations recorded");
  assert.deepEqual(schemaGaps(db), []);
  db.close();
});

test("an adopted database is only adopted once", () => {
  const { dbPath } = workspace();
  legacyDatabase(dbPath);
  migrateDatabase({ dbPath, migrationsFolder });
  const second = migrateDatabase({ dbPath, migrationsFolder });
  assert.equal(second.adopted, false);
  assert.deepEqual(second.applied, []);
});

test("a pending migration applies to an adopted database without touching its rows", () => {
  const { dir, dbPath } = workspace();
  legacyDatabase(dbPath);
  migrateDatabase({ dbPath, migrationsFolder });

  // A later release adds a column. Stage a migrations folder with the real initial migration
  // plus a synthetic 0001 — the shape of every future upgrade.
  const staged = join(dir, "drizzle");
  execFileSync("cp", ["-R", migrationsFolder, staged]);
  const journalPath = join(staged, "meta/_journal.json");
  const journal = JSON.parse(
    execFileSync("cat", [journalPath], { encoding: "utf8" }),
  ) as { entries: { idx: number; version: string; when: number; tag: string }[] };
  const last = journal.entries[journal.entries.length - 1];
  journal.entries.push({
    idx: last.idx + 1,
    version: last.version,
    when: last.when + 1000,
    tag: "0001_add_probe",
  });
  execFileSync("sh", [
    "-c",
    `printf '%s' '${JSON.stringify(journal).replace(/'/g, "'\\''")}' > ${journalPath}`,
  ]);
  execFileSync("sh", [
    "-c",
    `printf 'ALTER TABLE \`projects\` ADD \`probe\` text;' > ${join(staged, "0001_add_probe.sql")}`,
  ]);

  const outcome = migrateDatabase({ dbPath, migrationsFolder: staged });
  assert.deepEqual(outcome.applied, ["0001_add_probe"], "only the new migration runs");

  const db = new BetterSqlite3(dbPath);
  const columns = (db.prepare("PRAGMA table_info(projects)").all() as { name: string }[]).map(
    (c) => c.name,
  );
  assert.ok(columns.includes("probe"), "the new column exists");
  assert.equal(
    db.prepare("SELECT count(*) FROM projects").pluck().get(),
    1,
    "the pre-existing project row survived the migration",
  );
  db.close();
});

test("a database missing a column the schema needs is refused, not silently started", () => {
  const { dbPath } = workspace();
  // A database that predates migrations *and* predates a column — the case where adopting
  // would hand the app a schema it can't query.
  const db = new BetterSqlite3(dbPath);
  db.exec("CREATE TABLE users (id text PRIMARY KEY, email text NOT NULL)");
  db.close();

  assert.throws(
    () => migrateDatabase({ dbPath, migrationsFolder }),
    (err: Error) => {
      assert.match(err.message, /doesn't match the schema/);
      assert.match(err.message, /missing column|missing table/);
      assert.match(err.message, /db:push/, "should say how to recover");
      return true;
    },
  );
});

test("snapshots land in data/backup, and can be turned off", () => {
  const { dir, dbPath } = workspace();
  legacyDatabase(dbPath); // adoption is a change, so it snapshots
  const outcome = migrateDatabase({ dbPath, migrationsFolder });
  assert.ok(outcome.backup);
  const backups = readdirSync(join(dir, "backup"));
  assert.ok(
    backups.some((f) => f.startsWith("platform-pre-migrate-")),
    `expected a snapshot in ${join(dir, "backup")}, found ${backups.join(", ") || "nothing"}`,
  );

  const { dbPath: other } = workspace();
  legacyDatabase(other);
  assert.equal(migrateDatabase({ dbPath: other, migrationsFolder, backup: false }).backup, null);
});
