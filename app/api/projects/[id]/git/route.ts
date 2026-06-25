import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import {
  gitCheckout,
  gitCreateBranch,
  gitPull,
  gitPush,
  type GitResult,
} from "@/lib/git";
import { memberPath } from "@/lib/workspace";

export const dynamic = "force-dynamic";

// Disallow shell-flag-like or whitespace-bearing names (args are passed without a shell,
// so this only guards against a leading-dash name being read as a git flag).
const SAFE_BRANCH = /^(?!-)[A-Za-z0-9._/-]+$/;

type Ctx = { params: Promise<{ id: string }> };

// POST /api/projects/:id/git { action, branch?, member? } — basic source control.
// `member` scopes the operation to a workspace member repo (defaults to the project root).
export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const project = db.select().from(projects).where(eq(projects.id, id)).get();
  if (!project)
    return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!project.isGit && !project.isWorkspace)
    return NextResponse.json({ error: "not a git repo" }, { status: 400 });

  const { action, branch, member } = (await req.json()) as {
    action?: string;
    branch?: string;
    member?: string;
  };

  // Resolve the working directory: a validated workspace member, or the root.
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

  if ((action === "checkout" || action === "create") && !SAFE_BRANCH.test(branch ?? ""))
    return NextResponse.json({ error: "invalid branch name" }, { status: 400 });

  let result: GitResult;
  switch (action) {
    case "checkout":
      result = gitCheckout(cwd, branch!);
      break;
    case "create":
      result = gitCreateBranch(cwd, branch!);
      break;
    case "pull":
      result = gitPull(cwd);
      break;
    case "push":
      result = gitPush(cwd);
      break;
    default:
      return NextResponse.json({ error: "unknown action" }, { status: 400 });
  }

  return NextResponse.json(result, { status: result.ok ? 200 : 422 });
}
