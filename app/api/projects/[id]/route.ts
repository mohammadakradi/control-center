import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { agents, projectAgents, projects, tasks } from "@/lib/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { ownedBy } from "@/lib/task-access";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/projects/:id — project detail with linked agents and task history.
export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  // Only this owner's runs — sign-in is optional, so the alternative is showing a visitor
  // everyone's history.
  const user = await getCurrentUser();
  const project = db.select().from(projects).where(eq(projects.id, id)).get();
  if (!project)
    return NextResponse.json({ error: "not found" }, { status: 404 });

  const linkedAgents = db
    .select({ agent: agents })
    .from(projectAgents)
    .innerJoin(agents, eq(projectAgents.agentId, agents.id))
    .where(eq(projectAgents.projectId, id))
    .all()
    .map((r) => r.agent);

  const taskList = db
    .select()
    .from(tasks)
    .where(and(eq(tasks.projectId, id), ownedBy(user.id)))
    .orderBy(desc(tasks.createdAt))
    .all();

  return NextResponse.json({ project, agents: linkedAgents, tasks: taskList });
}

// PATCH /api/projects/:id — update editable project metadata (currently the
// display name). The name is cosmetic; the on-disk path is the stable identity,
// and a rename survives rescans (refreshProject never overwrites `name`).
export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const project = db.select().from(projects).where(eq(projects.id, id)).get();
  if (!project)
    return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as { name?: unknown };
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name)
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  if (name.length > 100)
    return NextResponse.json(
      { error: "name must be 100 characters or fewer" },
      { status: 400 },
    );

  db.update(projects).set({ name }).where(eq(projects.id, id)).run();
  return NextResponse.json({ ok: true, name });
}

// DELETE /api/projects/:id — unregister a project (cascades links + tasks).
export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  db.delete(projects).where(eq(projects.id, id)).run();
  return NextResponse.json({ ok: true });
}
