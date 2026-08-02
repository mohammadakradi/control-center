import { NextResponse } from "next/server";
import { daemonTaskAction } from "@/lib/daemon-client";

export const dynamic = "force-dynamic";

// POST /api/tasks/:id/stop — interrupt/cancel (authenticated proxy to the runner).
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const res = await daemonTaskAction(id, "stop");
    return NextResponse.json(res.body, { status: res.status });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
