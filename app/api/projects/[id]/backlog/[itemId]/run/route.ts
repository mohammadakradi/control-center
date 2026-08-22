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
  parseRunOptions,
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
 *
 * The body is optional — `{ parallel?: boolean }` and nothing else. Everything about *what* is
 * dispatched comes off the item's own row (its text, its title, its assignee, its feature), so
 * the only thing a caller gets to say is how the run should be launched.
 */
export async function POST(req: Request, { params }: Ctx) {
  const { id, itemId } = await params;
  const user = await getCurrentUser();

  const project = db.select().from(projects).where(eq(projects.id, id)).get();
  if (!project) return NextResponse.json({ error: "not found" }, { status: 404 });

  let item = findBacklogItem(id, itemId);
  if (!item) return NextResponse.json({ error: "not found" }, { status: 404 });

  // No body is the historical case and stays valid: this route took none at all until parallel
  // runs reached it. `catch` covers an absent, empty or malformed body — an unhandled throw in
  // a route handler is an HTML 500, which the UI can't read an error out of.
  const options = parseRunOptions(await req.json().catch(() => null));
  if (!options.ok) return NextResponse.json({ error: options.error }, { status: 400 });

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
  const chosen = agentForNamespace(want) ? want : "swe";
  const agent = agentForNamespace(chosen);
  if (!agent) {
    return NextResponse.json(
      { error: `No ${want} (or swe) agent is installed to take this item.` },
      { status: 409 },
    );
  }

  // pm has no `task` skill, and an item routed to it is a problem to investigate rather than
  // work to build — `/pm:plan` is the skill that turns it into specs the sync then imports as
  // implementable items. Keyed off the agent actually chosen, so a fallback to swe (pm not
  // installed) still dispatches something swe has.
  const command = chosen === "pm" ? "plan" : "task";

  const outcome = await createAndStartTask({
    projectId: id,
    agentId: agent.id,
    command,
    userId: user.id,
    requestText: backlogRequestText(item),
    // The item is already titled — by its spec's frontmatter, or by whoever filed it. Passing
    // that title through means the runner skips its naming call entirely (it only names a row
    // that has none), so the task list reads with the same words as the backlog it came from
    // and nobody pays a Haiku round-trip to get a worse summary of text we already summarised.
    title: item.title,
    // The run inherits the item's feature, so a feature's tasks and its planned work are the
    // same group. Not client-supplied: it is read off the row the sync owns, and re-read above
    // after that sync, so running a newly planned spec lands in the right feature first time.
    featureId: item.featureId,
    // Opt in to worktree isolation rather than queueing behind a busy checkout — the same flag
    // the composer sends, refused by `createAndStartTask` on the same terms (a non-git project
    // or a workspace answers 400 before a row exists, never a silent downgrade to queueing).
    parallel: options.value.parallel,
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
