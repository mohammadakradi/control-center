import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { projectAgents, tasks } from "@/lib/db/schema";
import { daemonStartTask } from "@/lib/daemon-client";
import { newId } from "@/lib/util";

export const dynamic = "force-dynamic";

// GET /api/tasks?projectId=... — list tasks (optionally for one project).
export async function GET(request: Request) {
  const projectId = new URL(request.url).searchParams.get("projectId");
  const rows = projectId
    ? db
        .select()
        .from(tasks)
        .where(eq(tasks.projectId, projectId))
        .orderBy(desc(tasks.createdAt))
        .all()
    : db.select().from(tasks).orderBy(desc(tasks.createdAt)).all();
  return NextResponse.json(rows);
}

// POST /api/tasks { projectId, agentId, command, requestText } — create and dispatch a task.
export async function POST(request: Request) {
  const body = (await request.json()) as {
    projectId?: string;
    agentId?: string;
    command?: string;
    requestText?: string;
    model?: string;
  };
  if (!body.projectId || !body.agentId || !body.command) {
    return NextResponse.json(
      { error: "projectId, agentId and command are required" },
      { status: 400 },
    );
  }

  const model = ["auto", "sonnet", "opus"].includes(body.model ?? "")
    ? (body.model as string)
    : "auto";

  const id = newId("task");
  db.insert(tasks)
    .values({
      id,
      projectId: body.projectId,
      agentId: body.agentId,
      command: body.command,
      requestText: body.requestText ?? "",
      status: "queued",
      model,
    })
    .run();

  // Ensure the agent is linked to the project.
  db.insert(projectAgents)
    .values({ projectId: body.projectId, agentId: body.agentId })
    .onConflictDoNothing()
    .run();

  try {
    await daemonStartTask(id);
  } catch (err) {
    db.update(tasks)
      .set({ status: "failed", error: (err as Error).message })
      .where(eq(tasks.id, id))
      .run();
    return NextResponse.json(
      { error: (err as Error).message, taskId: id },
      { status: 502 },
    );
  }

  return NextResponse.json(
    db.select().from(tasks).where(eq(tasks.id, id)).get(),
    { status: 201 },
  );
}
