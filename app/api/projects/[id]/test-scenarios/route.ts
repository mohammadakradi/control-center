import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { projectScenarioView } from "@/lib/test-scenarios";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/projects/:id/test-scenarios — the project's verification work, grouped by feature.
 *
 * Reading the list is what keeps it current, exactly as the backlog's GET is: it re-scans
 * `.qa/scenarios/`, `.fe/test-scenarios/` and `.swe/test-scenarios/`, then re-resolves the
 * grouping for rows whose stated feature didn't exist when they were first seen. Both are
 * idempotent, so there is no separate "sync" call to forget.
 *
 * Not scoped to a user: a scenario describes a project, which is shared by design (see
 * lib/task-access.ts). The QA runs that exercise one stay private to whoever ran them.
 */
export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const project = db.select().from(projects).where(eq(projects.id, id)).get();
  if (!project) return NextResponse.json({ error: "not found" }, { status: 404 });

  const { sync, groups } = projectScenarioView(project);
  return NextResponse.json({
    groups,
    // Surfaced rather than swallowed: "no scenarios" must be distinguishable from "the scan
    // refused everything it found", which is what a folder full of symlinks looks like.
    warnings: [
      ...(sync.skipped > 0
        ? [
            `${sync.skipped} file(s) in the scenario folders were skipped — not plain regular files, or unreadable.`,
          ]
        : []),
      ...(sync.truncated
        ? ["Some scenarios on disk are not shown: the scan hit its size cap."]
        : []),
    ],
  });
}
