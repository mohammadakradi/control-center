import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { gitFileDiff } from "@/lib/git";
import { memberPath } from "@/lib/workspace";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/projects/:id/diff?path=<file>&member=<rel> — unified diff for one file.
export async function GET(req: Request, { params }: Ctx) {
  const { id } = await params;
  const project = db.select().from(projects).where(eq(projects.id, id)).get();
  if (!project)
    return NextResponse.json({ error: "not found" }, { status: 404 });

  const url = new URL(req.url);
  const path = url.searchParams.get("path");
  const member = url.searchParams.get("member") ?? undefined;
  // Keep paths inside the repo (the file list only ever yields relative paths).
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

  return NextResponse.json({ path, diff: gitFileDiff(cwd, path) });
}
