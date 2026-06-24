import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { projectAgents } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// POST /api/projects/:id/link { agentId } — connect an agent to a project.
export async function POST(request: Request, { params }: Ctx) {
  const { id } = await params;
  const { agentId } = (await request.json()) as { agentId?: string };
  if (!agentId)
    return NextResponse.json({ error: "agentId is required" }, { status: 400 });
  db.insert(projectAgents)
    .values({ projectId: id, agentId })
    .onConflictDoNothing()
    .run();
  return NextResponse.json({ ok: true });
}

// DELETE /api/projects/:id/link { agentId } — disconnect an agent.
export async function DELETE(request: Request, { params }: Ctx) {
  const { id } = await params;
  const { agentId } = (await request.json()) as { agentId?: string };
  if (!agentId)
    return NextResponse.json({ error: "agentId is required" }, { status: 400 });
  db.delete(projectAgents)
    .where(
      and(
        eq(projectAgents.projectId, id),
        eq(projectAgents.agentId, agentId),
      ),
    )
    .run();
  return NextResponse.json({ ok: true });
}
