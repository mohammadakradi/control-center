/**
 * `pnpm cc:export` — package this install's data into a portable archive.
 *
 *   pnpm cc:export                       # → dist/control-center-data-<timestamp>.tar.gz
 *   pnpm cc:export --out ~/backup.tar.gz
 *   pnpm cc:export --include-tokens      # also carries your Anthropic token (see below)
 *
 * Carries: projects, agents, tasks and their transcripts (which is where usage and cost live),
 * task attachments, and accounts. Never carries sessions — those are live login cookies.
 *
 * `--include-tokens` decrypts your stored Anthropic token into the archive so the destination
 * can re-encrypt it under its own key. That makes the file a credential: it is written 0600,
 * and it does not belong in a repo, a shared drive, or an issue attachment.
 */
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, resolve } from "node:path";
import { DATA_DIR } from "../lib/config";
import { APP_VERSION } from "../lib/version";
import BetterSqlite3 from "better-sqlite3";
import { getUserToken, secretsConfigured } from "../lib/secrets";
import {
  buildExportDatabase,
  countFiles,
  writeManifest,
  type ExportedToken,
} from "../lib/data-transfer";

const args = process.argv.slice(2);
const includeTokens = args.includes("--include-tokens");
const outArg = args.indexOf("--out");
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const outPath = resolve(
  outArg >= 0 && args[outArg + 1]
    ? args[outArg + 1]
    : resolve(process.cwd(), "dist", `control-center-data-${stamp}.tar.gz`),
);

const repo = resolve(import.meta.dirname, "..");
const sourceDb = process.env.PLATFORM_DB ?? resolve(DATA_DIR, "platform.db");
const work = mkdtempSync(resolve(tmpdir(), "cc-export-"));
const stageName = `control-center-data-${stamp}`;
const stage = resolve(work, stageName);

try {
  mkdirSync(stage, { recursive: true });
  console.log(`Exporting from ${sourceDb}`);

  const { tables, warnings, migrations } = buildExportDatabase({
    sourceDb,
    destDb: resolve(stage, "platform.db"),
    migrationsFolder: resolve(repo, "drizzle"),
  });

  for (const t of tables) {
    console.log(`  ${t.table.padEnd(15)} ${t.copied} row(s)${t.skipped ? ` — ${t.skipped} unreadable` : ""}`);
  }

  // Attachments referenced by the exported tasks.
  const uploadsSrc = resolve(DATA_DIR, "uploads");
  let uploads = 0;
  if (existsSync(uploadsSrc)) {
    cpSync(uploadsSrc, resolve(stage, "uploads"), { recursive: true });
    uploads = countFiles(resolve(stage, "uploads"));
    console.log(`  ${"uploads".padEnd(15)} ${uploads} file(s)`);
  }

  if (includeTokens) {
    if (!secretsConfigured()) {
      console.warn("  SECRETS_MASTER_KEY isn't set — no tokens could be read; exporting without.");
    } else {
      const carried: ExportedToken[] = [];
      const src = new BetterSqlite3(sourceDb, { readonly: true });
      const userIds = src.prepare("SELECT id FROM users").pluck().all() as string[];
      src.close();
      for (const id of userIds) {
        const owned = getUserToken(id);
        if (owned) carried.push({ userId: id, kind: owned.kind, token: owned.token });
      }
      writeFileSync(resolve(stage, "tokens.json"), JSON.stringify(carried, null, 2));
      console.log(`  ${"tokens".padEnd(15)} ${carried.length} (DECRYPTED — treat this archive as a secret)`);
    }
  }

  writeManifest(resolve(stage, "manifest.json"), {
    app: "control-center",
    version: APP_VERSION,
    exportedAt: new Date().toISOString(),
    migrations,
    tables,
    uploads,
    includesTokens: includeTokens && existsSync(resolve(stage, "tokens.json")),
    warnings,
  });

  mkdirSync(dirname(outPath), { recursive: true });
  execFileSync("tar", ["-czf", outPath, "-C", work, stageName]);
  // Even without tokens this is your whole history; without a mode a fresh file would be
  // world-readable on a shared machine.
  chmodSync(outPath, 0o600);

  console.log(`\nWrote ${outPath}`);
  if (warnings.length > 0) {
    console.log("\nWarnings:");
    for (const w of warnings) console.log(`  - ${w}`);
  }
  console.log(
    `\nImport it with:\n  control-center import ${basename(outPath)}` +
      (includeTokens ? "\n\nThis archive contains a decrypted Anthropic token." : ""),
  );
} finally {
  rmSync(work, { recursive: true, force: true });
}
