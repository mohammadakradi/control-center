import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import {
  createFeature,
  featureCount,
  listFeatures,
  MAX_FEATURES_PER_PROJECT,
  parseNewFeature,
} from "@/lib/features";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/projects/:id/features — the project's features.
 *
 * Not scoped to a user, and not synced here: a feature describes planned work on a project,
 * which is shared by design (see lib/task-access.ts), and the `.pm/tasks/` folders that derive
 * features are read by the backlog load — the one place that already does that filesystem walk.
 * So this route is a plain read: it never touches the disk.
 */
export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const project = db.select().from(projects).where(eq(projects.id, id)).get();
  if (!project) return NextResponse.json({ error: "not found" }, { status: 404 });

  return NextResponse.json({ features: listFeatures(id) });
}

// POST /api/projects/:id/features — create one by hand (pm-planned batches derive their own).
export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const project = db.select().from(projects).where(eq(projects.id, id)).get();
  if (!project) return NextResponse.json({ error: "not found" }, { status: 404 });

  const parsed = parseNewFeature(await req.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  if (featureCount(id) >= MAX_FEATURES_PER_PROJECT) {
    return NextResponse.json(
      {
        error: `This project already has ${MAX_FEATURES_PER_PROJECT} features. Close some out before adding more.`,
      },
      { status: 409 },
    );
  }

  // `branch` and `sourceDir` are not taken from the request: the branch is minted here so it
  // is always a name git accepts, and a caller-supplied `sourceDir` would park a feature on a
  // `.pm/tasks/` folder the sync then treats as already derived.
  const feature = createFeature(id, { name: parsed.value.name });
  if (!feature) {
    return NextResponse.json(
      { error: "Could not create that feature — a concurrent request may have won its name." },
      { status: 409 },
    );
  }
  return NextResponse.json(feature, { status: 201 });
}
