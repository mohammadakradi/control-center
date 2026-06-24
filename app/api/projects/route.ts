import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { pathExists, scanProject } from "@/lib/discovery/projects";
import { newId } from "@/lib/util";

export const dynamic = "force-dynamic";

const getById = (id: string) =>
  db.select().from(projects).where(eq(projects.id, id)).get();

// GET /api/projects — list registered projects.
export async function GET() {
  const list = db
    .select()
    .from(projects)
    .orderBy(desc(projects.createdAt))
    .all();
  return NextResponse.json(list);
}

// POST /api/projects { path } — register a local folder as a project.
export async function POST(request: Request) {
  const { path } = (await request.json()) as { path?: string };
  if (!path?.trim()) {
    return NextResponse.json({ error: "path is required" }, { status: 400 });
  }
  if (!pathExists(path)) {
    return NextResponse.json(
      { error: `Folder not found: ${path}` },
      { status: 400 },
    );
  }
  const scan = scanProject(path);
  const existing = db
    .select()
    .from(projects)
    .all()
    .find((p) => p.path === scan.path);

  if (existing) {
    db.update(projects)
      .set({
        isGit: scan.isGit,
        defaultBranch: scan.defaultBranch,
        onboarded: scan.onboarded,
        isWorkspace: scan.isWorkspace,
        members: scan.members,
      })
      .where(eq(projects.id, existing.id))
      .run();
    return NextResponse.json(getById(existing.id), { status: 200 });
  }

  const id = newId("proj");
  db.insert(projects)
    .values({
      id,
      name: scan.name,
      path: scan.path,
      isGit: scan.isGit,
      defaultBranch: scan.defaultBranch,
      onboarded: scan.onboarded,
      isWorkspace: scan.isWorkspace,
      members: scan.members,
    })
    .run();
  return NextResponse.json(getById(id), { status: 201 });
}
