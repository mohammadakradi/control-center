import { NextResponse } from "next/server";
import { daemonTaskAction } from "@/lib/daemon-client";

export const dynamic = "force-dynamic";

// POST /api/tasks/:id/reply — free-form chat reply (authenticated proxy to the runner).
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { text?: string };
  try {
    const res = await daemonTaskAction(id, "reply", { text: body.text ?? "" });
    return NextResponse.json(res.body, { status: res.status });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
