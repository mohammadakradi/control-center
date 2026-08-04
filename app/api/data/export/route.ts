import { NextResponse } from "next/server";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { count, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { LOCAL_USER_ID } from "@/lib/identity";
import { DATA_DIR } from "@/lib/config";
import { APP_VERSION } from "@/lib/version";
import {
  buildExportDatabase,
  countFiles,
  installWideDataOpAllowed,
  writeManifest,
} from "@/lib/data-transfer";

/** Accounts other than the local workspace. */
function accountCount(): number {
  const [{ n }] = db.select({ n: count() }).from(users).where(ne(users.id, LOCAL_USER_ID)).all();
  return n;
}

export const dynamic = "force-dynamic";

// POST /api/data/export — write a portable archive of this install and report where it went.
// Tokens are never included from the UI (the CLI's --include-tokens is deliberate and warned).
export async function POST() {
  const allowed = installWideDataOpAllowed(accountCount(), "export");
  if (!allowed.ok) return NextResponse.json({ error: allowed.reason }, { status: 403 });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const name = `control-center-data-${stamp}`;
  const outDir = resolve(DATA_DIR, "exports");
  const outPath = resolve(outDir, `${name}.tar.gz`);
  const work = mkdtempSync(resolve(tmpdir(), "cc-ui-export-"));
  const stage = resolve(work, name);

  try {
    mkdirSync(stage, { recursive: true });
    const { tables, warnings, migrations } = buildExportDatabase({
      sourceDb: process.env.PLATFORM_DB ?? resolve(DATA_DIR, "platform.db"),
      destDb: resolve(stage, "platform.db"),
      migrationsFolder: resolve(process.cwd(), "drizzle"),
    });

    const uploadsSrc = resolve(DATA_DIR, "uploads");
    let uploads = 0;
    try {
      const { cpSync, existsSync } = await import("node:fs");
      if (existsSync(uploadsSrc)) {
        cpSync(uploadsSrc, resolve(stage, "uploads"), { recursive: true });
        uploads = countFiles(resolve(stage, "uploads"));
      }
    } catch {
      warnings.push("attachments could not be copied");
    }

    writeManifest(resolve(stage, "manifest.json"), {
      app: "control-center",
      version: APP_VERSION,
      exportedAt: new Date().toISOString(),
      migrations,
      tables,
      uploads,
      includesTokens: false,
      warnings,
    });

    mkdirSync(outDir, { recursive: true });
    execFileSync("tar", ["-czf", outPath, "-C", work, name]);

    return NextResponse.json({
      path: outPath,
      bytes: statSync(outPath).size,
      rows: tables.reduce((n, t) => n + t.copied, 0),
      tables,
      uploads,
      warnings,
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
