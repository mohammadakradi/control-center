import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import {
  backlogItemCount,
  createBacklogItem,
  loadProjectBacklog,
  MAX_ITEMS_PER_PROJECT,
  parseNewBacklogItem,
} from "@/lib/backlog";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/projects/:id/backlog — the project's planned work.
 *
 * Reading the backlog is what keeps it current: it pulls in any new `.pm/tasks/` specs the pm
 * agent has written and marks items whose dispatched task has finished. Both are idempotent,
 * so there's no separate "sync" call to forget.
 *
 * Not scoped to a user: a backlog describes a project, which is shared by design (see
 * lib/task-access.ts). The tasks it dispatches stay private to whoever ran them.
 *
 * The work itself — sync, reflection, and turning what the scan refused into warnings — is
 * `loadProjectBacklog`, shared with the backlog page so a load through the UI and a load
 * through the API can't come to different conclusions about the same folder.
 */
export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const project = db.select().from(projects).where(eq(projects.id, id)).get();
  if (!project) return NextResponse.json({ error: "not found" }, { status: 404 });

  return NextResponse.json(loadProjectBacklog(project));
}

// POST /api/projects/:id/backlog — add an item by hand.
export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const project = db.select().from(projects).where(eq(projects.id, id)).get();
  if (!project) return NextResponse.json({ error: "not found" }, { status: 404 });

  const parsed = parseNewBacklogItem(await req.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  // A backlog is a human artifact; past this it's a way to fill the disk (and every item's body
  // is returned on every load).
  if (backlogItemCount(id) >= MAX_ITEMS_PER_PROJECT) {
    return NextResponse.json(
      {
        error: `This project already has ${MAX_ITEMS_PER_PROJECT} backlog items. Close some out before adding more.`,
      },
      { status: 409 },
    );
  }

  // `source` is not taken from the request: an item created through the API is a manual one.
  // Agents record their own via the runner, which writes the row directly.
  const item = createBacklogItem(id, { ...parsed.value, source: "manual" });
  return NextResponse.json(item, { status: 201 });
}
