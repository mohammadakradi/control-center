/**
 * Moving an install's data between machines — export here, import there.
 *
 * The shape of the problem: the dev checkout and an installed app are two separate databases,
 * two separate `SECRETS_MASTER_KEY`s, and two separate upload directories. An archive has to
 * carry everything that makes the app *yours* (projects, tasks, transcripts, attachments, and
 * the usage figures that hang off them) while carrying nothing that would be dangerous or
 * meaningless somewhere else.
 *
 * Three decisions worth knowing:
 *
 *   1. The database is rebuilt table by table into a fresh file rather than copied. It's slower
 *      than `VACUUM INTO`, but a straight copy dies on the first corrupt page, and one of the
 *      databases this exists to rescue has a corrupt `task_events`. Copying row by row means a
 *      damaged table costs you the unreadable rows and nothing else — and every skipped row is
 *      counted and reported rather than silently dropped.
 *   2. Sessions are never exported. They're live login cookies; carrying them to another
 *      machine would hand out access, and they're worthless there anyway.
 *   3. Tokens are opt-in. They're encrypted per install, so they have to travel decrypted and
 *      be re-encrypted on arrival — which makes the archive a credential. Default is off.
 */
import BetterSqlite3 from "better-sqlite3";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { migrateDatabase, readMigrations } from "./db/migrate";

/** Copied in dependency order so foreign keys resolve; `sessions` is deliberately absent. */
const EXPORTED_TABLES = [
  "users",
  "projects",
  "agents",
  "project_agents",
  "tasks",
  "task_events",
] as const;

/** Rows per read. Small enough that one corrupt page costs little, big enough to be quick. */
const CHUNK = 200;

export type TableReport = {
  table: string;
  copied: number;
  /** Rows the source refused to hand over — corruption, almost always. */
  skipped: number;
};

export type ExportManifest = {
  app: "control-center";
  /** Version of the app that produced the archive. */
  version: string;
  exportedAt: string;
  /** Migration tags the source database had applied — the importer refuses anything newer. */
  migrations: string[];
  tables: TableReport[];
  uploads: number;
  includesTokens: boolean;
  /** Anything the operator should know: skipped rows, missing tables. */
  warnings: string[];
};

export type ExportedToken = { userId: string; kind: string; token: string };

function tableColumns(db: BetterSqlite3.Database, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${JSON.stringify(table)})`).all() as { name: string }[])
    .map((c) => c.name);
}

function tableExists(db: BetterSqlite3.Database, table: string): boolean {
  return Boolean(
    db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").pluck().get(table),
  );
}

/**
 * Copy one table from `src.` (an attached source) into the destination, tolerating unreadable
 * rows. Reads in id-ordered chunks; when a chunk throws, it retries that chunk one row at a
 * time so a single bad page costs one row instead of two hundred.
 */
function copyTable(
  dest: BetterSqlite3.Database,
  table: string,
  onSkip?: (rowid: number, err: Error) => void,
): TableReport {
  const report: TableReport = { table, copied: 0, skipped: 0 };
  if (!tableExists(dest, table)) return report;

  // Only columns both sides have: an older archive may lack a column the current schema added,
  // and an older destination may not know a column the archive carries.
  const destCols = new Set(tableColumns(dest, table));
  const srcCols = (
    dest.prepare(`PRAGMA src.table_info(${JSON.stringify(table)})`).all() as { name: string }[]
  ).map((c) => c.name);
  const cols = srcCols.filter((c) => destCols.has(c));
  if (cols.length === 0) return report;

  const list = cols.map((c) => `"${c}"`).join(", ");
  const insert = dest.prepare(
    `INSERT OR REPLACE INTO "${table}" (${list}) VALUES (${cols.map(() => "?").join(", ")})`,
  );
  const read = dest.prepare(
    `SELECT rowid AS _rid, ${list} FROM src."${table}" WHERE rowid > ? ORDER BY rowid LIMIT ?`,
  );
  const readOne = dest.prepare(
    `SELECT rowid AS _rid, ${list} FROM src."${table}" WHERE rowid = ?`,
  );

  const maxRowid = (() => {
    try {
      return (dest.prepare(`SELECT MAX(rowid) FROM src."${table}"`).pluck().get() as number) ?? 0;
    } catch {
      return -1; // can't even ask; fall back to walking ids
    }
  })();

  let cursor = 0;
  while (true) {
    let rows: Record<string, unknown>[] = [];
    let chunkFailed = false;
    try {
      rows = read.all(cursor, CHUNK) as Record<string, unknown>[];
    } catch {
      chunkFailed = true;
    }

    if (chunkFailed) {
      // Walk the chunk's id range individually; the damage is usually a page or two.
      const end = maxRowid >= 0 ? Math.min(cursor + CHUNK, maxRowid) : cursor + CHUNK;
      for (let rid = cursor + 1; rid <= end; rid++) {
        try {
          const row = readOne.get(rid) as Record<string, unknown> | undefined;
          if (!row) continue;
          insert.run(...cols.map((c) => row[c] as never));
          report.copied++;
        } catch (err) {
          report.skipped++;
          onSkip?.(rid, err as Error);
        }
      }
      cursor = end;
      if (maxRowid >= 0 && cursor >= maxRowid) break;
      if (maxRowid < 0) break; // no way to know where to stop; don't loop forever
      continue;
    }

    if (rows.length === 0) break;
    for (const row of rows) {
      try {
        insert.run(...cols.map((c) => row[c] as never));
        report.copied++;
      } catch (err) {
        report.skipped++;
        onSkip?.(Number(row._rid), err as Error);
      }
      cursor = Math.max(cursor, Number(row._rid));
    }
  }

  return report;
}

/**
 * Build a portable copy of `sourceDb` at `destDb`, plus a manifest describing it.
 * `migrationsFolder` is used to create the destination schema, so the archive always carries a
 * database at the exporting app's schema version.
 */
export function buildExportDatabase({
  sourceDb,
  destDb,
  migrationsFolder,
}: {
  sourceDb: string;
  destDb: string;
  migrationsFolder: string;
}): { tables: TableReport[]; warnings: string[]; migrations: string[] } {
  if (!existsSync(sourceDb)) throw new Error(`no database at ${sourceDb}`);

  // Fresh, fully-migrated destination — never a byte-copy of a file we already distrust.
  migrateDatabase({ dbPath: destDb, migrationsFolder, backup: false });

  const dest = new BetterSqlite3(destDb);
  const warnings: string[] = [];
  try {
    dest.pragma("foreign_keys = OFF"); // rows arrive table by table, not in reference order
    dest.exec(`ATTACH DATABASE '${sourceDb.replace(/'/g, "''")}' AS src`);

    const tables: TableReport[] = [];
    for (const table of EXPORTED_TABLES) {
      if (!tableExists(dest, table)) continue;
      let report: TableReport;
      try {
        report = copyTable(dest, table);
      } catch (err) {
        report = { table, copied: 0, skipped: 0 };
        warnings.push(`${table}: unreadable, exported empty (${(err as Error).message})`);
      }
      if (report.skipped > 0) {
        warnings.push(
          `${table}: ${report.skipped} row(s) could not be read and are missing from this archive`,
        );
      }
      tables.push(report);
    }

    dest.exec("DETACH DATABASE src");
    return { tables, warnings, migrations: readMigrations(migrationsFolder).map((m) => m.tag) };
  } finally {
    dest.close();
  }
}

/** Write the archive's manifest. Kept separate so the CLI owns file layout, not this module. */
export function writeManifest(path: string, manifest: ExportManifest): void {
  writeFileSync(path, JSON.stringify(manifest, null, 2) + "\n");
}

export function readManifest(path: string): ExportManifest {
  const raw = JSON.parse(readFileSync(path, "utf8")) as ExportManifest;
  if (raw?.app !== "control-center") {
    throw new Error("this doesn't look like an Agent Control Center export (bad manifest)");
  }
  return raw;
}

/**
 * Is this archive safe to import here? An archive from a *newer* app carries migrations this
 * install has never seen, so its database is a shape we don't understand — refuse rather than
 * import something we'd then fail to query.
 */
export function checkCompatibility(
  manifest: ExportManifest,
  localMigrations: string[],
): { ok: true } | { ok: false; reason: string } {
  const known = new Set(localMigrations);
  const unknown = (manifest.migrations ?? []).filter((m) => !known.has(m));
  if (unknown.length > 0) {
    return {
      ok: false,
      reason:
        `this archive comes from ${manifest.version}, which has migrations this ` +
        `install doesn't know (${unknown.join(", ")}). Update first, then import.`,
    };
  }
  return { ok: true };
}

/**
 * Export, restore and uninstall all act on the WHOLE install — every workspace's tasks and
 * transcripts. That's what a backup means, and it's fine on a one-person machine. On a shared
 * one it would let anyone who merely opened the app walk off with, or delete, another account's
 * history — so the UI only offers these while there's at most one real account. Past that they
 * stay operator actions at the command line, which needs filesystem access anyway.
 *
 * `accounts` excludes the local workspace.
 */
export function installWideDataOpAllowed(
  accounts: number,
  action: "export" | "restore" | "uninstall",
): { ok: true } | { ok: false; reason: string } {
  if (accounts <= 1) return { ok: true };
  const cli = { export: "control-center export", restore: "control-center import <archive>", uninstall: "control-center uninstall" }[action];
  const what = {
    export: "an export covers all of them — including their tasks and transcripts",
    restore: "a restore would replace all of their data",
    uninstall: "uninstalling would remove all of their data",
  }[action];
  return {
    ok: false,
    reason: `This install has ${accounts} accounts, and ${what}. Run it from the command line instead: ${cli}`,
  };
}

/** Copy the attachments directory, if the archive has one. Returns the file count. */
export function restoreUploads(from: string, to: string): number {
  if (!existsSync(from)) return 0;
  mkdirSync(to, { recursive: true });
  cpSync(from, to, { recursive: true });
  return countFiles(to);
}

export function countFiles(dir: string): number {
  if (!existsSync(dir)) return 0;
  // Cheap recursive count; upload trees here are shallow (one directory per task).
  let n = 0;
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry);
    n += statSync(full).isDirectory() ? countFiles(full) : 1;
  }
  return n;
}
