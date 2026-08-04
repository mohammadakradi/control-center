import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { tasks, type Attachment } from "@/lib/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { findOwnedTask } from "@/lib/task-access";
import { daemonContinueTask } from "@/lib/daemon-client";
import { saveAttachments } from "@/lib/uploads";

export const dynamic = "force-dynamic";

// POST /api/tasks/:id/continue — resume a terminal task in its existing session.
// Accepts JSON { message? } OR multipart/form-data with `message` + `files` (docs/photos
// attached to the follow-up request). With no message it picks up where it left off; with a
// message (and/or files) it applies the user's requested changes.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const user = await getCurrentUser();
  const task = findOwnedTask(id, user.id);
  if (!task) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!["failed", "cancelled", "done"].includes(task.status)) {
    return NextResponse.json(
      { error: `task is ${task.status}; only failed/cancelled/done tasks can be continued` },
      { status: 409 },
    );
  }

  let message: string | undefined;
  let added: Attachment[] = [];

  if (req.headers.get("content-type")?.includes("multipart/form-data")) {
    const form = await req.formData();
    message = form.get("message")?.toString();
    const files = form.getAll("files").filter((f): f is File => f instanceof File);
    if (files.length) {
      const existing = (task.attachments ?? []) as Attachment[];
      added = await saveAttachments(id, files, existing.map((a) => a.name));
      if (added.length) {
        // Record on the task so the header count reflects the total.
        db.update(tasks)
          .set({ attachments: [...existing, ...added] })
          .where(eq(tasks.id, id))
          .run();
      }
    }
  } else {
    message = ((await req.json().catch(() => ({}))) as { message?: string }).message;
  }

  try {
    await daemonContinueTask(id, message?.trim() || undefined, added);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}
