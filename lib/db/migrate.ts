/**
 * Schema migrations — the part that has to be right, or an update eats someone's data.
 *
 * Versioned SQL files in `drizzle/` are the source of truth. `drizzle-kit push` (diffing the
 * schema against a live database) stays dev-only and must never run against a user's install:
 * it has historically rebuilt the `tasks` table and dropped the `user_id` foreign key with it.
 *
 * Three cases, all handled here:
 *   1. no database yet             → apply every migration
 *   2. database with bookkeeping   → apply whatever is pending (usually nothing)
 *   3. database WITHOUT bookkeeping → it predates migrations (it was created by `push`).
 *      Adopt it: record the existing migrations as already applied, rather than re-running
 *      CREATE TABLEs that would fail against tables that are already there.
 *
 * Case 3 is the dangerous one, so it doesn't guess. It snapshots the database first, and
 * afterwards verifies the live schema really does have every table and column the code needs —
 * refusing to hand back a database that would fail on the first query.
 */
import BetterSqlite3 from "better-sqlite3";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { getTableColumns, getTableName, is } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { SQLiteTable } from "drizzle-orm/sqlite-core";
import { DATA_DIR } from "../config";
import * as schema from "./schema";

/** Drizzle's own bookkeeping table. Name and shape must match `SQLiteDialect.migrate()`. */
const MIGRATIONS_TABLE = "__drizzle_migrations";

export type MigrationOutcome = {
  dbPath: string;
  /** The database file didn't exist before this run. */
  created: boolean;
  /** A pre-migrations database was adopted (its migrations recorded, not re-run). */
  adopted: boolean;
  /** Migration tags applied by this run, in order. */
  applied: string[];
  /** Snapshot taken before touching an existing database, if any. */
  backup: string | null;
};

type MigrationFile = { sql: string[]; folderMillis: number; hash: string; tag: string };

/** Every table the ORM knows about, so we can check the database really provides them.
 *  Widened to `unknown[]` first: each export has its own precise table type, and a predicate
 *  narrowing to the generic `SQLiteTable` isn't assignable to that union. */
function schemaTables(): SQLiteTable[] {
  return (Object.values(schema) as unknown[]).filter((v): v is SQLiteTable =>
    is(v, SQLiteTable),
  );
}

/**
 * Read `drizzle/` the same way drizzle's migrator does — same statement splitting and the same
 * `hash`, so the rows we write while adopting are indistinguishable from rows it would write.
 * (Reimplemented rather than imported from `drizzle-orm/migrator` so a change to that internal
 * module surfaces here as a failing spec instead of a silently re-applied migration.)
 */
export function readMigrations(folder: string): MigrationFile[] {
  const journalPath = resolve(folder, "meta/_journal.json");
  if (!existsSync(journalPath)) {
    throw new Error(`no migrations found at ${folder} (missing meta/_journal.json)`);
  }
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
    entries?: { when: number; tag: string; breakpoints?: boolean }[];
  };
  return (journal.entries ?? []).map((entry) => {
    const file = resolve(folder, `${entry.tag}.sql`);
    if (!existsSync(file)) {
      throw new Error(`migration ${entry.tag} is in the journal but ${file} is missing`);
    }
    const query = readFileSync(file, "utf8").replace(/\r\n/g, "\n");
    return {
      sql: query.split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean),
      folderMillis: entry.when,
      hash: createHash("sha256").update(query).digest("hex"),
      tag: entry.tag,
    };
  });
}

function hasTable(db: BetterSqlite3.Database, name: string): boolean {
  return Boolean(
    db
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
      .pluck()
      .get(name),
  );
}

/** Consistent snapshot of a live (WAL) database — the supported way to copy one. */
function snapshot(db: BetterSqlite3.Database, dbPath: string): string {
  const dir = resolve(dirname(dbPath), "backup");
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dest = resolve(dir, `platform-pre-migrate-${stamp}.db`);
  db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
  return dest;
}

/**
 * Data invariants, enforced on every run rather than once in the migration chain.
 *
 * Adoption (case 3 above) records existing migrations as applied without executing them, which
 * is right for schema changes — the tables are already there — and *wrong* for migrations that
 * move data. `0001_local_workspace.sql` seeds the local identity and gives orphaned tasks an
 * owner; on an adopted database it was marked done without ever running, leaving no local
 * identity and 90 tasks belonging to nobody.
 *
 * So the data rules live here instead, written to be idempotent and safe to re-run forever.
 * Returns a description of anything it changed, for the caller to log.
 */
export function ensureDataInvariants(db: BetterSqlite3.Database): string[] {
  const done: string[] = [];

  // The owner of everything done without signing in. '!' can never match a password.
  const seeded = db
    .prepare(
      `INSERT OR IGNORE INTO users (id, email, password_hash, created_at)
       VALUES ('user_local', 'local@device', '!', unixepoch())`,
    )
    .run();
  if (seeded.changes > 0) done.push("created the local workspace identity");

  // Tasks from before sign-in existed have no owner. With visibility now per-owner they'd
  // belong to nobody and vanish from the UI, so when there is exactly one real account they
  // become its history — private behind that sign-in, not visible to anyone who opens the app.
  const accounts = db
    .prepare("SELECT COUNT(*) FROM users WHERE id != 'user_local'")
    .pluck()
    .get() as number;
  if (accounts === 1) {
    const claimed = db
      .prepare(
        `UPDATE tasks
         SET user_id = (SELECT id FROM users WHERE id != 'user_local' LIMIT 1)
         WHERE user_id IS NULL`,
      )
      .run();
    if (claimed.changes > 0) {
      done.push(`gave ${claimed.changes} ownerless task(s) to the only account`);
    }
  }

  return done;
}

/** What the ORM needs but the database doesn't have. Empty means the two agree. */
export function schemaGaps(db: BetterSqlite3.Database): string[] {
  const gaps: string[] = [];
  for (const table of schemaTables()) {
    const name = getTableName(table);
    const columns = db
      .prepare(`PRAGMA table_info(${JSON.stringify(name)})`)
      .all() as { name: string }[];
    if (columns.length === 0) {
      gaps.push(`missing table "${name}"`);
      continue;
    }
    const present = new Set(columns.map((c) => c.name));
    for (const column of Object.values(getTableColumns(table))) {
      if (!present.has(column.name)) {
        gaps.push(`table "${name}" is missing column "${column.name}"`);
      }
    }
  }
  return gaps;
}

/**
 * Bring the database at `dbPath` up to date. Idempotent and safe to run on every start.
 * Throws on anything it can't handle safely — callers should let that stop the app, because
 * the alternative is serving requests against a schema the code doesn't match.
 */
export function migrateDatabase(
  {
    dbPath = process.env.PLATFORM_DB ?? resolve(DATA_DIR, "platform.db"),
    migrationsFolder = resolve(process.cwd(), "drizzle"),
    backup = true,
    log = () => {},
  }: {
    dbPath?: string;
    migrationsFolder?: string;
    backup?: boolean;
    log?: (message: string) => void;
  } = {},
): MigrationOutcome {
  const migrations = readMigrations(migrationsFolder);
  if (migrations.length === 0) throw new Error(`no migrations in ${migrationsFolder}`);

  const created = !existsSync(dbPath);
  mkdirSync(dirname(dbPath), { recursive: true });

  const db = new BetterSqlite3(dbPath);
  // Foreign keys stay OFF for the duration: SQLite alterations are implemented as
  // create-copy-drop-rename, which trips FK enforcement mid-flight.
  db.pragma("journal_mode = WAL");

  const outcome: MigrationOutcome = {
    dbPath,
    created,
    adopted: false,
    applied: [],
    backup: null,
  };

  try {
    const bookkeeping = hasTable(db, MIGRATIONS_TABLE);
    const appTables = schemaTables().some((t) => hasTable(db, getTableName(t)));
    const willAdopt = !bookkeeping && appTables;

    // Which migrations the migrator will run, decided the way it decides: by the newest
    // recorded `created_at`. Computed up front so we know whether this run changes anything.
    const lastApplied = bookkeeping
      ? (db
          .prepare(`SELECT created_at FROM ${MIGRATIONS_TABLE} ORDER BY created_at DESC LIMIT 1`)
          .pluck()
          .get() as number | undefined)
      : undefined;
    const pending = willAdopt
      ? [] // adoption records them all, so none will actually run
      : migrations.filter((m) => lastApplied === undefined || Number(lastApplied) < m.folderMillis);

    // Snapshot only when this run is about to change something. `start` runs migrations every
    // time, and copying the database on every launch would quietly fill the disk.
    if (!created && backup && (willAdopt || pending.length > 0)) {
      outcome.backup = snapshot(db, dbPath);
      log(`Snapshot: ${outcome.backup}`);
    }

    if (willAdopt) {
      // Adopt a pre-migrations database: same DDL the migrator uses, then one row per
      // migration so it considers them applied instead of replaying their CREATE TABLEs.
      log(`Adopting an existing database (recording ${migrations.length} migration(s))…`);
      db.exec(`CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
        id SERIAL PRIMARY KEY,
        hash text NOT NULL,
        created_at numeric
      )`);
      const insert = db.prepare(
        `INSERT INTO ${MIGRATIONS_TABLE} ("hash", "created_at") VALUES (?, ?)`,
      );
      db.transaction(() => {
        for (const m of migrations) insert.run(m.hash, m.folderMillis);
      })();
      outcome.adopted = true;
    }

    migrate(drizzle(db), { migrationsFolder });
    outcome.applied = pending.map((m) => m.tag);
    for (const tag of outcome.applied) log(`Applied ${tag}`);


    const gaps = schemaGaps(db);
    if (gaps.length > 0) {
      throw new Error(
        `the database at ${dbPath} doesn't match the schema this version expects:\n` +
          gaps.map((g) => `  - ${g}`).join("\n") +
          (outcome.adopted
            ? "\nThis database predates migrations and is missing things the initial migration" +
              " declares, so it can't be adopted automatically." +
              (outcome.backup ? `\nA snapshot was taken at ${outcome.backup}.` : "") +
              "\nBring it up to the current schema once with `pnpm db:push`, then start again."
            : "\nThis usually means a migration is missing from drizzle/ — run `pnpm db:generate`."),
      );
    }

    // Only once the shape is known good: data rules that adoption would otherwise skip,
    // because it records migrations as applied without running them.
    for (const change of ensureDataInvariants(db)) log(change);

    return outcome;
  } finally {
    db.close();
  }
}
