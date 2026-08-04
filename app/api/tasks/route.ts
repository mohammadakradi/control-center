import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { agents, projectAgents, tasks, type Attachment } from "@/lib/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { ownedBy } from "@/lib/task-access";
import { canRunTasks, secretsConfigured } from "@/lib/secrets";
import { daemonStartTask } from "@/lib/daemon-client";
import { saveAttachments } from "@/lib/uploads";
import { newId } from "@/lib/util";

export const dynamic = "force-dynamic";

// GET /api/tasks?projectId=... — the caller's own tasks (optionally for one project).
// Scoped to the owner: with sign-in optional, an unscoped list would hand a visitor every
// task on the install.
export async function GET(request: Request) {
  const user = await getCurrentUser();
  const projectId = new URL(request.url).searchParams.get("projectId");
  const where = projectId
    ? and(ownedBy(user.id), eq(tasks.projectId, projectId))
    : ownedBy(user.id);
  const rows = db.select().from(tasks).where(where).orderBy(desc(tasks.createdAt)).all();
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
  // Stamp the owner — their Anthropic token runs the session, and only they will see the
  // task. Without a session that's the local workspace, which owns its own token.
  const user = await getCurrentUser();

  // Refuse before doing any work if this user's tasks can't run: otherwise we'd save
  // their uploads, create a task row, and immediately fail it — the user's first
  // experience of the app being a cryptic runner error. Checked here AND in the
  // runner (which is authoritative); this is the friendly early exit.
  if (!canRunTasks(user.id)) {
    // Distinguish "this user hasn't added a token" from "the server can't read any
    // token" — same refusal, but only one of them is the user's to fix.
    return NextResponse.json(
      {
        error: secretsConfigured()
          ? "Add your Anthropic token under Settings before dispatching tasks — each user runs on their own credential."
          : "The server is missing SECRETS_MASTER_KEY, so stored tokens can't be read. Ask whoever runs this instance to set it (see .env.example).",
        needsToken: true,
      },
      { status: 412 },
    );
  }

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

  // "sonnet"/"opus"/"sonnet-4.6" are legacy aliases — the router maps them to the
  // current equivalents (Sonnet 4.6 is retired → Sonnet 5).
  const ALLOWED_MODELS = new Set([
    "auto",
    "fable-5",
    "opus-5",
    "sonnet-5",
    "opus-4.8",
    "sonnet",
    "opus",
    "sonnet-4.6",
  ]);
  const model = ALLOWED_MODELS.has(fields.model ?? "")
    ? (fields.model as string)
    : "auto";

  // Snapshot the agent's current version so history records which version ran this task.
  const agent = db
    .select({ version: agents.version })
    .from(agents)
    .where(eq(agents.id, fields.agentId))
    .get();

  db.insert(tasks)
    .values({
      id,
      projectId: fields.projectId,
      agentId: fields.agentId,
      userId: user.id,
      command: fields.command,
      agentVersion: agent?.version ?? null,
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
