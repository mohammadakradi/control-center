import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { getCurrentUser } from "@/lib/auth";
import {
  activeLinkedTask,
  backlogRequestText,
  findBacklogItem,
  linkBacklogTask,
  syncProjectBacklog,
} from "@/lib/backlog";
import { agentForNamespace, createAndStartTask } from "@/lib/dispatch";
import { parseFrontmatter, targetNamespace } from "@/lib/pm-spec";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; itemId: string }> };

/**
 * POST /api/projects/:id/backlog/:itemId/run — dispatch a backlog item as a real task.
 *
 * The item is shared with everyone on the install, but the run is not: it is stamped to
 * whoever pressed the button, executes on their Anthropic token, and only they see the
 * transcript. Goes through `createAndStartTask`, so it inherits the same token gate, model
 * handling and failure bookkeeping as `POST /api/tasks`.
 */
export async function POST(_req: Request, { params }: Ctx) {
  const { id, itemId } = await params;
  const user = await getCurrentUser();

  const project = db.select().from(projects).where(eq(projects.id, id)).get();
  if (!project) return NextResponse.json({ error: "not found" }, { status: 404 });

  let item = findBacklogItem(id, itemId);
  if (!item) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Don't start a second run of work that's already running — a double click shouldn't cost
  // two sessions. A finished (or failed) task doesn't block: re-running is legitimate.
  const running = activeLinkedTask(item);
  if (running) {
    return NextResponse.json(
      {
        error: `This item is already running as task ${running.id} (${running.status}).`,
        taskId: running.id,
      },
      { status: 409 },
    );
  }

  // Hand over the spec as it reads *now*, not as it read when it was first imported.
  if (item.sourcePath) {
    try {
      syncProjectBacklog(project);
      item = findBacklogItem(id, itemId) ?? item;
    } catch {
      // Unreadable folder — dispatch the copy we already have rather than refusing.
    }
  }

  const want = item.assignee ?? targetNamespace(parseFrontmatter(item.description));
  // Fall back to swe if the requested agent isn't installed — it's the generalist.
  const agent = agentForNamespace(want) ?? agentForNamespace("swe");
  if (!agent) {
    return NextResponse.json(
      { error: `No ${want} (or swe) agent is installed to take this item.` },
      { status: 409 },
    );
  }

  const outcome = await createAndStartTask({
    projectId: id,
    agentId: agent.id,
    command: "task",
    userId: user.id,
    requestText: backlogRequestText(item),
  });

  if (!outcome.ok) {
    return NextResponse.json(
      { error: outcome.error, needsToken: outcome.needsToken, taskId: outcome.taskId },
      { status: outcome.status },
    );
  }

  // The task is live from here on, so a failure to link must still report the task rather than
  // 500 — otherwise the caller is left with a running session it was never told about.
  const linked = linkBacklogTask(item.id, outcome.task.id);
  return NextResponse.json(
    {
      item: linked,
      task: outcome.task,
      warning: linked
        ? undefined
        : "The task started, but the backlog item disappeared before it could be linked.",
    },
    { status: 201 },
  );
}
