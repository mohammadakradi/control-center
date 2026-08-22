import { NextResponse } from "next/server";
import {
  findFeature,
  folderOwnedFeatureEdits,
  parseFeatureEdit,
  updateFeature,
} from "@/lib/features";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; featureId: string }> };

/**
 * PATCH /api/projects/:id/features/:featureId — close a feature out, or rename a hand-made one.
 *
 * A sync-derived feature's *name* belongs to its `.pm/tasks/<request>/` folder, which the next
 * backlog load re-reads, so renaming one is refused rather than reverted — the same stance a
 * synced backlog item's title gets. Its status is nobody's file to own, so that is editable
 * either way. The branch is editable by no one: it is a git ref the runner may already have
 * created, and moving it would orphan the work on it.
 */
export async function PATCH(req: Request, { params }: Ctx) {
  const { id, featureId } = await params;
  // Scoped to the project in the URL, so an id from another project reads as missing.
  const feature = findFeature(id, featureId);
  if (!feature) return NextResponse.json({ error: "not found" }, { status: 404 });

  const parsed = parseFeatureEdit(await req.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const edit = parsed.value;
  if (Object.keys(edit).length === 0) {
    return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  }

  const owned = feature.sourceDir ? folderOwnedFeatureEdits(edit) : [];
  if (owned.length > 0) {
    return NextResponse.json(
      {
        error: `${owned.join(", ")} ${owned.length > 1 ? "are" : "is"} read from ${feature.sourceDir}/index.md — change it there instead. Only status can be changed here.`,
      },
      { status: 409 },
    );
  }

  return NextResponse.json(updateFeature(feature.id, edit));
}
