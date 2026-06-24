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

export const dynamic = "force-dynamic";

// Disallow shell-flag-like or whitespace-bearing names (args are passed without a shell,
// so this only guards against a leading-dash name being read as a git flag).
const SAFE_BRANCH = /^(?!-)[A-Za-z0-9._/-]+$/;

type Ctx = { params: Promise<{ id: string }> };

// POST /api/projects/:id/git { action, branch? } — basic source control.
export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const project = db.select().from(projects).where(eq(projects.id, id)).get();
  if (!project)
    return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!project.isGit)
    return NextResponse.json({ error: "not a git repo" }, { status: 400 });

  const { action, branch } = (await req.json()) as {
    action?: string;
    branch?: string;
  };

  if ((action === "checkout" || action === "create") && !SAFE_BRANCH.test(branch ?? ""))
    return NextResponse.json({ error: "invalid branch name" }, { status: 400 });

  let result: GitResult;
  switch (action) {
    case "checkout":
      result = gitCheckout(project.path, branch!);
      break;
    case "create":
      result = gitCreateBranch(project.path, branch!);
      break;
    case "pull":
      result = gitPull(project.path);
      break;
    case "push":
      result = gitPush(project.path);
      break;
    default:
      return NextResponse.json({ error: "unknown action" }, { status: 400 });
  }

  return NextResponse.json(result, { status: result.ok ? 200 : 422 });
}
