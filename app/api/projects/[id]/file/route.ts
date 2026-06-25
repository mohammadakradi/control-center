import { NextResponse } from "next/server";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { memberPath } from "@/lib/workspace";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const MAX_BYTES = 512 * 1024;

// GET /api/projects/:id/file?path=<file>&member=<rel> — read one in-repo text file.
export async function GET(req: Request, { params }: Ctx) {
  const { id } = await params;
  const project = db.select().from(projects).where(eq(projects.id, id)).get();
  if (!project)
    return NextResponse.json({ error: "not found" }, { status: 404 });

  const url = new URL(req.url);
  const path = url.searchParams.get("path");
  const member = url.searchParams.get("member") ?? undefined;
  // Keep paths inside the repo (mirror of the diff route's guard).
  if (!path || path.startsWith("/") || path.split("/").includes("..")) {
    return NextResponse.json({ error: "invalid path" }, { status: 400 });
  }

  let cwd = project.path;
  if (member) {
    const mp = memberPath(project, member);
    if (!mp)
      return NextResponse.json(
        { error: "unknown workspace member" },
        { status: 400 },
      );
    cwd = mp;
  }

  const abs = resolve(cwd, path);
  if (!abs.startsWith(resolve(cwd))) {
    return NextResponse.json({ error: "invalid path" }, { status: 400 });
  }

  try {
    if (statSync(abs).size > MAX_BYTES) {
      return NextResponse.json({ error: "file too large" }, { status: 413 });
    }
    return NextResponse.json({ path, content: readFileSync(abs, "utf8") });
  } catch {
    return NextResponse.json({ error: "file not found" }, { status: 404 });
  }
}
