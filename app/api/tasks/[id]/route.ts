import { NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { agents, projects, taskEvents } from "@/lib/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { findOwnedTask } from "@/lib/task-access";

export const dynamic = "force-dynamic";

// GET /api/tasks/:id — task detail + full event log (for history / replay).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  const task = findOwnedTask(id, user.id);
  if (!task) return NextResponse.json({ error: "not found" }, { status: 404 });

  const project = db
    .select()
    .from(projects)
    .where(eq(projects.id, task.projectId))
    .get();
  const agent = db.select().from(agents).where(eq(agents.id, task.agentId)).get();
  const events = db
    .select()
    .from(taskEvents)
    .where(eq(taskEvents.taskId, id))
    .orderBy(asc(taskEvents.id))
    .all();

  return NextResponse.json({ task, project, agent, events });
}
