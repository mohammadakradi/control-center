import { NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { agents, projects, taskEvents } from "@/lib/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { parseFeatureRef, setTaskFeature } from "@/lib/features";
import { findOwnedTask } from "@/lib/task-access";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/tasks/:id — task detail + full event log (for history / replay).
export async function GET(_req: Request, { params }: Ctx) {
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

/**
 * PATCH /api/tasks/:id — move the task into a feature, or out of one with `featureId: null`.
 *
 * Owner-scoped, unlike the project-side feature routes: a task and its transcript are private,
 * so "not yours" and "doesn't exist" must answer identically (lib/task-access). The feature has
 * to be one of the task's *own* project's — a feature groups work on one repo, and once the
 * runner merges a feature's branches a cross-project link would target another repo entirely.
 *
 * Deliberately narrow: nothing else about a task is a user's to edit here. Its status belongs
 * to the run, its request text is what the agent was handed, and its usage is accounting.
 */
export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const user = await getCurrentUser();
  const task = findOwnedTask(id, user.id);
  if (!task) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || !("featureId" in body)) {
    return NextResponse.json({ error: "featureId is required" }, { status: 400 });
  }

  const parsed = parseFeatureRef(task.projectId, body.featureId);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  return NextResponse.json(setTaskFeature(task.id, parsed.value ?? null));
}
