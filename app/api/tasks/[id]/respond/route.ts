import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { tasks, type Attachment } from "@/lib/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { daemonTaskAction } from "@/lib/daemon-client";
import { findOwnedTask } from "@/lib/task-access";
import {
  attachmentNote,
  BAD_MULTIPART,
  readFormData,
  saveAttachments,
} from "@/lib/uploads";

export const dynamic = "force-dynamic";

/** The two statuses in which a gate is suspended waiting for an answer. The runner records the
 *  gate event and sets the status in the same synchronous step (`onGate` in
 *  `runner/session-manager.ts`), so a client that has *received* a gate always sees one of
 *  these on the row. */
const GATE_STATUSES = new Set(["awaiting_proposal", "awaiting_report"]);

// POST /api/tasks/:id/respond — approve/reject a gate (authenticated proxy to the runner).
// Accepts JSON { allow, feedback } OR multipart/form-data with the same fields plus `files`:
// a gate is the one moment a running task is listening, so it is where a screenshot of the
// thing that's wrong is worth most. Until now the only composer that took files was the one
// shown *after* a task finished, so answering "look at this image" mid-run was impossible.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  // Sign-in is optional, so this is the only ownership check: a task belongs to a signed-in
  // account or to the local workspace, and nobody else may touch it. 404, not 403 — probing
  // ids must not reveal that someone else's task exists.
  const user = await getCurrentUser();
  const task = findOwnedTask(id, user.id);
  if (!task) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  let allow = false;
  let feedback: string | undefined;
  let added: Attachment[] = [];

  if (req.headers.get("content-type")?.includes("multipart/form-data")) {
    const form = await readFormData(req);
    if (!form) return NextResponse.json({ error: BAD_MULTIPART }, { status: 400 });
    allow = form.get("allow")?.toString() === "true";
    feedback = form.get("feedback")?.toString();
    const files = form.getAll("files").filter((f): f is File => f instanceof File);
    if (files.length) {
      // Files are only accepted while a gate is actually waiting. Without this, `respond` was
      // a write primitive that needed no agent turn and no state change: a loop of multipart
      // posts against one's own task (and sign-in is optional, so the local workspace is
      // reachable over loopback) could fill the disk far faster than the `continue` path,
      // which at least demands a terminal task and starts a real session. Found by the
      // security review. Answering a gate clears it, so this bounds writes to one batch per
      // gate, under the per-task ceilings in `lib/uploads.ts`.
      if (!GATE_STATUSES.has(task.status)) {
        return NextResponse.json(
          {
            error: `This task isn't waiting at a gate (it is ${task.status}), so there is nothing to attach files to.`,
          },
          { status: 409 },
        );
      }
      const existing = (task.attachments ?? []) as Attachment[];
      added = await saveAttachments(id, files, existing);
      if (added.length) {
        // Record on the task so the header's file count reflects the total.
        db.update(tasks)
          .set({ attachments: [...existing, ...added] })
          .where(eq(tasks.id, id))
          .run();
      }
    }
  } else {
    const body = (await req.json().catch(() => ({}))) as {
      allow?: boolean;
      feedback?: string;
    };
    allow = body.allow ?? false;
    feedback = body.feedback;
  }

  // The paths are ours, written by `saveAttachments` a moment ago — never a client-supplied
  // path, which would make this an "ask the agent to read any file" primitive.
  const note = attachmentNote(added, "with this answer");
  const text = `${feedback ?? ""}${note}`.trim();

  try {
    const res = await daemonTaskAction(id, "respond", {
      allow,
      feedback: text || undefined,
    });
    return NextResponse.json(res.body, { status: res.status });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
