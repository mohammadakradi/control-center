import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { tasks } from "@/lib/db/schema";
import { daemonContinueTask } from "@/lib/daemon-client";

export const dynamic = "force-dynamic";

// POST /api/tasks/:id/continue — resume a failed/cancelled task from where it left off.
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const task = db.select().from(tasks).where(eq(tasks.id, id)).get();
  if (!task) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!["failed", "cancelled", "done"].includes(task.status)) {
    return NextResponse.json(
      { error: `task is ${task.status}; only failed/cancelled/done tasks can be continued` },
      { status: 409 },
    );
  }
  try {
    await daemonContinueTask(id);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}
