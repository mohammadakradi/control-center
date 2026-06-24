import { NextResponse } from "next/server";
import { refreshProject } from "@/lib/discovery/projects";

export const dynamic = "force-dynamic";

// POST /api/projects/:id/rescan — refresh git/onboarding/workspace status from disk.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = refreshProject(id);
  if (!project)
    return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(project);
}
