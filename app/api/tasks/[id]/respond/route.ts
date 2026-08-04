import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { daemonTaskAction } from "@/lib/daemon-client";
import { findOwnedTask } from "@/lib/task-access";

export const dynamic = "force-dynamic";

// POST /api/tasks/:id/respond — approve/reject a gate (authenticated proxy to the runner).
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  // Sign-in is optional, so this is the only ownership check: a task belongs to a signed-in
  // account or to the local workspace, and nobody else may touch it. 404, not 403 — probing
  // ids must not reveal that someone else's task exists.
  const user = await getCurrentUser();
  if (!findOwnedTask(id, user.id)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    allow?: boolean;
    feedback?: string;
  };
  try {
    const res = await daemonTaskAction(id, "respond", {
      allow: body.allow ?? false,
      feedback: body.feedback,
    });
    return NextResponse.json(res.body, { status: res.status });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
