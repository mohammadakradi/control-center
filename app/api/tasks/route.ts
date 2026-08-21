import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { tasks, type Attachment } from "@/lib/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { ownedBy } from "@/lib/task-access";
import { createAndStartTask, dispatchRefusal } from "@/lib/dispatch";
import { parseFeatureRef } from "@/lib/features";
import { BAD_MULTIPART, readFormData, saveAttachments } from "@/lib/uploads";
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
  /** Opt in to running in an isolated worktree if the project is busy (see lib/dispatch). */
  parallel?: boolean;
  /** Which feature the run belongs to. Refused unless it names one of `projectId`'s features —
   *  an id from anywhere else is an error, never a silently dropped link. */
  featureId?: string | null;
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
  const refused = dispatchRefusal(user.id);
  if (refused) {
    return NextResponse.json(
      { error: refused.error, needsToken: refused.needsToken },
      { status: refused.status },
    );
  }

  const id = newId("task");
  let fields: TaskFields;
  let attachments: Attachment[] = [];

  if (request.headers.get("content-type")?.includes("multipart/form-data")) {
    const form = await readFormData(request);
    // A body that says multipart and isn't must not become a 500: the composer reads the JSON
    // error out of the response, and an HTML error page leaves it showing "Failed to dispatch
    // task" with nothing to act on.
    if (!form) return NextResponse.json({ error: BAD_MULTIPART }, { status: 400 });
    fields = {
      projectId: form.get("projectId")?.toString(),
      agentId: form.get("agentId")?.toString(),
      command: form.get("command")?.toString(),
      requestText: form.get("requestText")?.toString(),
      model: form.get("model")?.toString(),
      parallel: form.get("parallel")?.toString() === "1",
      // An absent field and an empty one both mean "no feature"; a form can't send null.
      featureId: form.get("featureId")?.toString() || null,
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

  // Checked here rather than coerced, because the failure is invisible: a `featureId` quietly
  // dropped for being the wrong type would dispatch a run that never appears under its feature.
  // `createAndStartTask` re-checks — it is the gate for callers that aren't this route.
  const feature = parseFeatureRef(fields.projectId, fields.featureId);
  if (!feature.ok) return NextResponse.json({ error: feature.error }, { status: 400 });

  const outcome = await createAndStartTask({
    taskId: id, // already used to name the upload folder
    projectId: fields.projectId,
    agentId: fields.agentId,
    command: fields.command,
    userId: user.id,
    requestText: fields.requestText,
    model: fields.model,
    attachments,
    parallel: fields.parallel === true,
    featureId: feature.value ?? null,
  });

  if (!outcome.ok) {
    return NextResponse.json(
      { error: outcome.error, needsToken: outcome.needsToken, taskId: outcome.taskId },
      { status: outcome.status },
    );
  }
  return NextResponse.json(outcome.task, { status: 201 });
}
