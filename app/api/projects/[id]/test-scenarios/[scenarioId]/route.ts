import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import {
  findTestScenario,
  parseScenarioStatusEdit,
  setScenarioStatus,
} from "@/lib/test-scenarios";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; scenarioId: string }> };

/**
 * PATCH /api/projects/:id/test-scenarios/:scenarioId — close, reopen, or complete one scenario.
 *
 * A status set here sticks: it marks `statusOverride`, so a later passing QA run stands down
 * rather than moving the row. A person saying "closed" outranks a run that happened to go green,
 * the same precedence the backlog uses.
 *
 * The status change also **moves the markdown**: leaving `open` archives it under `.qa/archive/`
 * with its original path preserved, and reopening moves it back. That is the one place the
 * platform writes into a project folder, and `moveScenarioFile` is where the containment checks
 * for it live.
 */
export async function PATCH(req: Request, { params }: Ctx) {
  const { id, scenarioId } = await params;
  const project = db.select().from(projects).where(eq(projects.id, id)).get();
  if (!project) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Scoped to the project in the URL, so an id from another project reads as missing.
  const scenario = findTestScenario(id, scenarioId);
  if (!scenario) return NextResponse.json({ error: "not found" }, { status: 404 });

  const parsed = parseScenarioStatusEdit(await req.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const result = setScenarioStatus(project, scenario, {
    status: parsed.value.status,
    manual: true,
  });

  return NextResponse.json({
    scenario: result.scenario,
    // What happened to the file is reported, never inferred by the client: "closed but its
    // markdown had already been deleted by hand" is a different outcome from "closed and
    // archived", and only the server can tell them apart.
    file: result.file,
  });
}
