import { NextResponse } from "next/server";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { DATA_DIR } from "@/lib/config";
import { checkCompatibility, readManifest } from "@/lib/data-transfer";
import { readMigrations } from "@/lib/db/migrate";

export const dynamic = "force-dynamic";

/** Where a queued archive waits for the next start. */
export const PENDING_IMPORT = resolve(DATA_DIR, "pending-import.tar.gz");

/**
 * POST /api/data/import — accept an archive and queue it, applied on the next start.
 *
 * Deliberately *queued* rather than applied here. Importing replaces the database, and this
 * request is being served by a process holding that database open — swapping it underneath is
 * how you get a half-written one. So the file is validated now (so a bad archive fails while
 * someone is watching) and applied by `control-center start` before the server comes up.
 */
export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  const file = form?.get("archive");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No archive was uploaded." }, { status: 400 });
  }

  const work = mkdtempSync(resolve(tmpdir(), "cc-ui-import-"));
  try {
    const staged = resolve(work, "upload.tar.gz");
    writeFileSync(staged, Buffer.from(await file.arrayBuffer()));

    // Unpack far enough to read the manifest: a bad or foreign file should be refused now, not
    // at the next launch when nobody's looking at the screen.
    const peek = resolve(work, "peek");
    mkdirSync(peek, { recursive: true });
    try {
      execFileSync("tar", ["-xzf", staged, "-C", peek]);
    } catch {
      return NextResponse.json(
        { error: "That file isn't a readable .tar.gz archive." },
        { status: 400 },
      );
    }
    const roots = readdirSync(peek);
    const root = roots.length === 1 ? resolve(peek, roots[0]) : peek;
    if (!existsSync(resolve(root, "manifest.json"))) {
      return NextResponse.json(
        { error: "No manifest.json inside — is this a Control Center export?" },
        { status: 400 },
      );
    }

    let manifest;
    try {
      manifest = readManifest(resolve(root, "manifest.json"));
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 400 });
    }
    const compat = checkCompatibility(
      manifest,
      readMigrations(resolve(process.cwd(), "drizzle")).map((m) => m.tag),
    );
    if (!compat.ok) return NextResponse.json({ error: compat.reason }, { status: 409 });

    mkdirSync(DATA_DIR, { recursive: true });
    execFileSync("cp", [staged, PENDING_IMPORT]);

    return NextResponse.json({
      queued: true,
      version: manifest.version,
      exportedAt: manifest.exportedAt,
      rows: manifest.tables.reduce((n, t) => n + t.copied, 0),
      uploads: manifest.uploads,
      includesTokens: manifest.includesTokens,
      warnings: manifest.warnings ?? [],
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

// DELETE /api/data/import — change your mind before restarting.
export async function DELETE() {
  rmSync(PENDING_IMPORT, { force: true });
  return NextResponse.json({ queued: false });
}

// GET /api/data/import — is something waiting to be applied?
export async function GET() {
  return NextResponse.json({ queued: existsSync(PENDING_IMPORT) });
}
