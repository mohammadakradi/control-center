import { NextResponse } from "next/server";
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { findOwnedTask } from "@/lib/task-access";
import { gitShowFile } from "@/lib/git";
import { memberPath } from "@/lib/workspace";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const MAX_BYTES = 512 * 1024;

// GET /api/projects/:id/file?path=<file>&member=<rel>&task=<taskId> — read one in-repo
// text file. With `task`, the read follows that task's working dir: a parallel run executes
// in its own git worktree, so its files (e.g. the test scenario a report links) exist there
// — or, once the worktree is cleaned up after a done run, only on the task's branch.
export async function GET(req: Request, { params }: Ctx) {
  const { id } = await params;
  const project = db.select().from(projects).where(eq(projects.id, id)).get();
  if (!project)
    return NextResponse.json({ error: "not found" }, { status: 404 });

  const url = new URL(req.url);
  const path = url.searchParams.get("path");
  const member = url.searchParams.get("member") ?? undefined;
  // Keep paths inside the repo (mirror of the diff route's guard).
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
    // Owner-scoped like every task read: someone else's task id must answer exactly like a
    // nonexistent one (lib/task-access), so probing ids reveals nothing.
    const user = await getCurrentUser();
    const task = findOwnedTask(taskId, user.id);
    if (!task || task.projectId !== id)
      return NextResponse.json({ error: "not found" }, { status: 404 });
    if (task.workdir && existsSync(task.workdir)) {
      cwd = task.workdir;
    } else if (task.workdir && task.branch) {
      // The worktree is gone (cleaned up after a done run) — committed content lives on
      // the task's branch. `path` passed the traversal guard above; the ref is ours.
      const content = gitShowFile(project.path, task.branch, path);
      if (content === null)
        return NextResponse.json({ error: "file not found" }, { status: 404 });
      if (Buffer.byteLength(content, "utf8") > MAX_BYTES)
        return NextResponse.json({ error: "file too large" }, { status: 413 });
      return NextResponse.json({ path, content });
    }
    // No workdir: the task ran in the project checkout — fall through unchanged.
  }

  const abs = resolve(cwd, path);
  if (!abs.startsWith(resolve(cwd))) {
    return NextResponse.json({ error: "invalid path" }, { status: 400 });
  }

  try {
    if (statSync(abs).size > MAX_BYTES) {
      return NextResponse.json({ error: "file too large" }, { status: 413 });
    }
    return NextResponse.json({ path, content: readFileSync(abs, "utf8") });
  } catch {
    return NextResponse.json({ error: "file not found" }, { status: 404 });
  }
}
