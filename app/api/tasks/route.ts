import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { projectAgents, tasks, type Attachment } from "@/lib/db/schema";
import { daemonStartTask } from "@/lib/daemon-client";
import { saveAttachments } from "@/lib/uploads";
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

type TaskFields = {
  projectId?: string;
  agentId?: string;
  command?: string;
  requestText?: string;
  model?: string;
};

// POST /api/tasks — create and dispatch a task.
// Accepts JSON { projectId, agentId, command, requestText, model } OR multipart/form-data
// with the same fields plus one or more `files` (documents/photos attached to the request).
export async function POST(request: Request) {
  const id = newId("task");
  let fields: TaskFields;
  let attachments: Attachment[] = [];

  if (request.headers.get("content-type")?.includes("multipart/form-data")) {
    const form = await request.formData();
    fields = {
      projectId: form.get("projectId")?.toString(),
      agentId: form.get("agentId")?.toString(),
      command: form.get("command")?.toString(),
      requestText: form.get("requestText")?.toString(),
      model: form.get("model")?.toString(),
    };
    const files = form.getAll("files").filter((f): f is File => f instanceof File);
    attachments = await saveAttachments(id, files);
  } else {
    fields = (await request.json()) as TaskFields;
  }

  if (!fields.projectId || !fields.agentId || !fields.command) {
    return NextResponse.json(
      { error: "projectId, agentId and command are required" },
      { status: 400 },
    );
  }

  const model = ["auto", "sonnet", "opus"].includes(fields.model ?? "")
    ? (fields.model as string)
    : "auto";

  db.insert(tasks)
    .values({
      id,
      projectId: fields.projectId,
      agentId: fields.agentId,
      command: fields.command,
      requestText: fields.requestText ?? "",
      status: "queued",
      model,
      attachments,
    })
    .run();

  // Ensure the agent is linked to the project.
  db.insert(projectAgents)
    .values({ projectId: fields.projectId, agentId: fields.agentId })
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
