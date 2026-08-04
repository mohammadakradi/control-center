/**
 * `pnpm cc:import <archive>` — load an exported archive into this install.
 *
 *   control-center import ~/control-center-data-2026-08-04.tar.gz
 *   control-center import archive.tar.gz --claim-as-local
 *
 * Replaces this install's database and attachments with the archive's, after snapshotting what
 * was there. Refuses to run against a newer archive than this app understands, and refuses
 * while the app is running — importing a database out from under a live process is how you get
 * a half-written one.
 *
 * Imported tasks keep their original owner, so signing in with the same account shows your
 * history exactly as it was. `--claim-as-local` instead hands everything to the local
 * workspace, so it's all there without signing in.
 */
import { execFileSync } from "node:child_process";
import BetterSqlite3 from "better-sqlite3";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { DATA_DIR } from "../lib/config";
import { LOCAL_USER_ID } from "../lib/identity";
import { migrateDatabase, readMigrations } from "../lib/db/migrate";
import { setUserToken, secretsConfigured, type TokenKind } from "../lib/secrets";
import {
  checkCompatibility,
  countFiles,
  readManifest,
  type ExportedToken,
} from "../lib/data-transfer";

const args = process.argv.slice(2);
const archive = args.find((a) => !a.startsWith("--"));
const claimAsLocal = args.includes("--claim-as-local");
const force = args.includes("--force");

if (!archive) {
  console.error("usage: control-center import <archive.tar.gz> [--claim-as-local]");
  process.exit(1);
}
const archivePath = resolve(archive);
if (!existsSync(archivePath)) {
  console.error(`error: no such archive: ${archivePath}`);
  process.exit(1);
}

const repo = resolve(import.meta.dirname, "..");
const migrationsFolder = resolve(repo, "drizzle");
const targetDb = process.env.PLATFORM_DB ?? resolve(DATA_DIR, "platform.db");
const work = mkdtempSync(resolve(tmpdir(), "cc-import-"));

function fail(message: string): never {
  console.error(`\nerror: ${message}\n`);
  rmSync(work, { recursive: true, force: true });
  process.exit(1);
}

try {
  execFileSync("tar", ["-xzf", archivePath, "-C", work]);
  const roots = readdirSync(work);
  const root = roots.length === 1 ? resolve(work, roots[0]) : work;
  const manifestPath = resolve(root, "manifest.json");
  if (!existsSync(manifestPath)) fail("the archive has no manifest.json — is it a Control Center export?");

  const manifest = readManifest(manifestPath);
  const compat = checkCompatibility(manifest, readMigrations(migrationsFolder).map((m) => m.tag));
  if (!compat.ok) fail(compat.reason);

  const rows = manifest.tables.reduce((n, t) => n + t.copied, 0);
  console.log(
    `Archive: Control Center ${manifest.version}, exported ${manifest.exportedAt}\n` +
      `  ${rows} row(s) across ${manifest.tables.length} table(s), ${manifest.uploads} attachment(s)` +
      `${manifest.includesTokens ? ", including tokens" : ""}`,
  );
  for (const w of manifest.warnings ?? []) console.log(`  note: ${w}`);

  // Whatever is here now gets snapshotted before it's replaced — this is destructive.
  if (existsSync(targetDb)) {
    const existing = new BetterSqlite3(targetDb, { readonly: true });
    const taskCount = (() => {
      try {
        return existing.prepare("SELECT COUNT(*) FROM tasks").pluck().get() as number;
      } catch {
        return 0;
      }
    })();
    existing.close();
    if (taskCount > 0 && !force) {
      fail(
        `this install already has ${taskCount} task(s). Importing replaces them.\n` +
          `       Re-run with --force if that's what you want (a snapshot is taken either way).`,
      );
    }
    const backupDir = resolve(DATA_DIR, "backup");
    mkdirSync(backupDir, { recursive: true });
    const dest = resolve(backupDir, `platform-pre-import-${Date.now()}.db`);
    const snap = new BetterSqlite3(targetDb, { readonly: true });
    snap.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
    snap.close();
    console.log(`Snapshot of the current database: ${dest}`);
  }

  // Swap in the archive's database, then bring it up to this app's schema.
  mkdirSync(DATA_DIR, { recursive: true });
  for (const suffix of ["", "-wal", "-shm"]) rmSync(`${targetDb}${suffix}`, { force: true });
  cpSync(resolve(root, "platform.db"), targetDb);

  const outcome = migrateDatabase({ dbPath: targetDb, migrationsFolder, backup: false });
  if (outcome.applied.length > 0) {
    console.log(`Brought the imported database up to date: ${outcome.applied.join(", ")}`);
  }

  const db = new BetterSqlite3(targetDb);
  // Sessions are never exported, but an archive from a future version might carry them —
  // and a login cookie minted elsewhere must not grant access here.
  try {
    const cleared = db.prepare("DELETE FROM sessions").run();
    if (cleared.changes > 0) console.log(`Discarded ${cleared.changes} imported session(s)`);
  } catch {
    /* no sessions table yet — fine */
  }

  if (claimAsLocal) {
    const moved = db.prepare("UPDATE tasks SET user_id = ?").run(LOCAL_USER_ID);
    console.log(`Gave ${moved.changes} task(s) to the local workspace — no sign-in needed.`);
  }
  const owners = db
    .prepare(
      `SELECT u.email, COUNT(t.id) AS n FROM tasks t
       JOIN users u ON u.id = t.user_id GROUP BY t.user_id ORDER BY n DESC`,
    )
    .all() as { email: string; n: number }[];
  db.close();

  const uploadsSrc = resolve(root, "uploads");
  if (existsSync(uploadsSrc)) {
    cpSync(uploadsSrc, resolve(DATA_DIR, "uploads"), { recursive: true });
    console.log(`Restored ${countFiles(resolve(DATA_DIR, "uploads"))} attachment(s)`);
  }

  const tokensFile = resolve(root, "tokens.json");
  if (existsSync(tokensFile)) {
    if (!secretsConfigured()) {
      console.warn("Archive carries tokens but SECRETS_MASTER_KEY isn't set here — skipped.");
    } else {
      const carried = JSON.parse(readFileSync(tokensFile, "utf8")) as ExportedToken[];
      for (const t of carried) setUserToken(t.userId, t.token, t.kind as TokenKind);
      console.log(`Re-encrypted ${carried.length} token(s) under this install's key.`);
    }
  }

  console.log("\nImported. Tasks now belong to:");
  for (const o of owners) console.log(`  ${o.email}: ${o.n}`);
  if (!claimAsLocal && owners.some((o) => o.email !== "local@device")) {
    console.log(
      "\nSign in with that account to see them, or re-import with --claim-as-local to have\n" +
        "everything available without signing in.",
    );
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
