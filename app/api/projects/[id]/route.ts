import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { agents, projectAgents, projects, tasks } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/projects/:id — project detail with linked agents and task history.
export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
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
    .where(eq(tasks.projectId, id))
    .orderBy(desc(tasks.createdAt))
    .all();

  return NextResponse.json({ project, agents: linkedAgents, tasks: taskList });
}

// DELETE /api/projects/:id — unregister a project (cascades links + tasks).
export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  db.delete(projects).where(eq(projects.id, id)).run();
  return NextResponse.json({ ok: true });
}
