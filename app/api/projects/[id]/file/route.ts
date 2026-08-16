import { NextResponse } from "next/server";
import { existsSync } from "node:fs";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { findOwnedTask } from "@/lib/task-access";
import { gitShowFile } from "@/lib/git";
import { isUsableRelPath, readFileInside } from "@/lib/safe-read";
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
  // Cheap lexical gate before any DB or filesystem work. It is *not* the containment
  // check — `readFileInside` proves that against the real path, since a tree can hold a
  // symlink and a task worktree is written by an agent.
  if (!isUsableRelPath(path)) {
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

  // Reads the real path, and only if it is genuinely inside `cwd` — whichever of the three
  // roots above that turned out to be. A symlink or hard link pointing out of the tree is
  // refused rather than served (lib/safe-read.ts).
  const read = readFileInside(cwd, path, MAX_BYTES);
  if (read.ok) return NextResponse.json({ path, content: read.content });
  if (read.reason === "too-large")
    return NextResponse.json({ error: "file too large" }, { status: 413 });
  // "Refused" and "isn't there" answer identically, the same way `lib/task-access` makes
  // "not yours" and "doesn't exist" indistinguishable. Splitting them turned a planted
  // symlink into a clean existence oracle for arbitrary absolute paths on the host: point it
  // at a path, read the status code, learn whether that path exists — no race, no auth, and
  // repeatable. (It also restores the 404 that a directory path used to get, since the old
  // code let `readFileSync`'s EISDIR fall into the same catch.)
  return NextResponse.json({ error: "file not found" }, { status: 404 });
}
