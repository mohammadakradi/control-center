import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { findOwnedTask } from "@/lib/task-access";
import { gitChanges } from "@/lib/git";
import { resolveTaskWorkRoot } from "@/lib/task-root";

export const dynamic = "force-dynamic";

// GET /api/tasks/:id/changes — the uncommitted-changes summary for *this task's* working root:
// the project checkout, or the isolated git worktree a parallel run executed in. Clicking a file
// then goes to `/api/projects/:projectId/diff?path=…&task=:id`, which resolves the same root.
//
// There is no path or directory parameter here by design — the only input is the task id, and the
// root comes from the rows (`lib/task-root.ts`). `gitChanges` is consumed unchanged, so every
// hardening flag in `lib/git.ts` (`repoOpts`, `gitEnv`, `NO_HOOKS`, the subprocess timeout) applies.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  // Owner-scoped like every task read: someone else's id must answer exactly like a
  // nonexistent one (lib/task-access), so probing ids reveals nothing.
  const user = await getCurrentUser();
  const task = findOwnedTask(id, user.id);
  if (!task) return NextResponse.json({ error: "not found" }, { status: 404 });

  const project = db
    .select()
    .from(projects)
    .where(eq(projects.id, task.projectId))
    .get();
  if (!project) return NextResponse.json({ error: "not found" }, { status: 404 });

  const root = resolveTaskWorkRoot(project, task);
  if (root.kind === "unavailable")
    return NextResponse.json({ available: false, reason: root.reason });

  // A removed worktree has no tree to read. Reported as its own scope rather than as a clean
  // one: "working tree clean" would be a different claim, and the branch is where the work is.
  if (root.kind === "worktree-removed")
    return NextResponse.json({
      available: true,
      scope: root.kind,
      branch: root.branch,
      changes: { files: [], totalAdded: 0, totalDeleted: 0, truncated: 0 },
    });

  return NextResponse.json({
    available: true,
    scope: root.kind,
    branch: task.branch,
    changes: gitChanges(root.cwd),
  });
}
