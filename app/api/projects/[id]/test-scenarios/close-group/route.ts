import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { closeScenarioGroup, parseGroupRef } from "@/lib/test-scenarios";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/projects/:id/test-scenarios/close-group — close every open scenario in one feature.
 *
 * Its own route rather than a verb on the collection: this is a bulk write that archives a file
 * per row, and it must not be reachable by a client that meant to add something. `featureId`
 * must be stated explicitly, `null` meaning the Ungrouped bucket — a missing key is an error,
 * because "close everything ungrouped" is too easy a thing to do by accident.
 *
 * Only `open` rows move. A scenario already `passed` keeps that outcome (it is a fact worth
 * distinguishing from a dismissal), and the response counts what actually changed.
 */
export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const project = db.select().from(projects).where(eq(projects.id, id)).get();
  if (!project) return NextResponse.json({ error: "not found" }, { status: 404 });

  const parsed = parseGroupRef(await req.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const closed = closeScenarioGroup(project, parsed.value.featureId);
  return NextResponse.json({ closed: closed.length, scenarios: closed });
}
