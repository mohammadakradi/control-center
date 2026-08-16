import { NextResponse } from "next/server";
import { existsSync } from "node:fs";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { findOwnedTask } from "@/lib/task-access";
import { gitFileDiff } from "@/lib/git";
import { memberPath } from "@/lib/workspace";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/projects/:id/diff?path=<file>&member=<rel>&task=<taskId> — unified diff for one
// file. With `task`, the diff is taken in that task's own working dir (a parallel run
// executes in an isolated git worktree, not the project checkout).
export async function GET(req: Request, { params }: Ctx) {
  const { id } = await params;
  const project = db.select().from(projects).where(eq(projects.id, id)).get();
  if (!project)
    return NextResponse.json({ error: "not found" }, { status: 404 });

  const url = new URL(req.url);
  const path = url.searchParams.get("path");
  const member = url.searchParams.get("member") ?? undefined;
  // Keep paths inside the repo (the file list only ever yields relative paths).
  if (!path || path.startsWith("/") || path.split("/").includes("..")) {
    return NextResponse.json({ error: "invalid path" }, { status: 400 });
  }

  let cwd = project.path;
  if (member) {
    const mp = memberPath(project, member);
    if (!mp)
      return NextResponse.json(
        { error: "unknown workspace member" },
        { status: 400 },
      );
    cwd = mp;
  }

  const taskId = url.searchParams.get("task");
  if (taskId) {
    // Owner-scoped like every task read (lib/task-access): not yours ≡ doesn't exist.
    const user = await getCurrentUser();
    const task = findOwnedTask(taskId, user.id);
    if (!task || task.projectId !== id)
      return NextResponse.json({ error: "not found" }, { status: 404 });
    if (task.workdir) {
      // A cleaned-up worktree was clean by definition — an empty diff is the honest
      // answer, where falling back to the project checkout would show someone else's
      // working changes under this task's name.
      if (!existsSync(task.workdir)) return NextResponse.json({ path, diff: "" });
      cwd = task.workdir;
    }
  }

  return NextResponse.json({ path, diff: gitFileDiff(cwd, path) });
}
