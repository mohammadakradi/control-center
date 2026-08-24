import { NextResponse } from "next/server";
import {
  deleteFeature,
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

/**
 * DELETE /api/projects/:id/features/:featureId — drop a grouping that isn't needed any more.
 *
 * Distinct from closing one out: `status: done` is for work that finished and keeps the heading
 * (collapsed) as history, while this is for a group created by mistake or reorganised away. Its
 * tasks and backlog items survive as ungrouped — see `deleteFeature`, which owns every rule,
 * including the two refusals below and the `mergeState` clearing an FK can't do.
 *
 * Like every project-scoped route here it has no auth, and it is now a *destructive* verb on
 * that footing. Two things bound it: the lookup is project-scoped (`findFeature`), so an id from
 * another project answers 404 rather than being deleted through the wrong URL and ids can't be
 * probed across projects; and nothing it deletes takes any task, transcript, backlog item or
 * commit with it. The wider no-auth gap is the one documented for the backlog routes — it needs
 * the same fix, not a different one here.
 */
export async function DELETE(_req: Request, { params }: Ctx) {
  const { id, featureId } = await params;
  const feature = findFeature(id, featureId);
  if (!feature) return NextResponse.json({ error: "not found" }, { status: 404 });

  const result = deleteFeature(feature);
  if (!result.ok) {
    // 409 for both: the request is well-formed and the caller may be able to retry later (once
    // the run ends), or has somewhere else to go (the folder on disk).
    // No count in this sentence, deliberately. `deleteFeature` counts active tasks across
    // *everyone's* — it has to, to know whether to refuse — but a task is private to whoever
    // ran it (`lib/task-access.ts`) and this route has no auth, so naming the number would tell
    // an unrelated caller how much live work someone else has on this feature. That is the same
    // disclosure the success path above withholds; the security audit caught the failure path
    // still making it. The refusal is just as actionable without it.
    const error =
      result.reason === "derived"
        ? `This feature is derived from ${result.sourceDir}/ and would come back on the next backlog load. Delete that folder instead.`
        : "A task is still running on this feature. Its branch is where a run's work gets merged, so wait for it to finish or cancel it first.";
    return NextResponse.json({ error, reason: result.reason }, { status: 409 });
  }

  return NextResponse.json({
    deleted: true,
    // Backlog items only. `deleteFeature` counts tasks too — it needs to, to clear their merge
    // state — but a task is private to whoever ran it (`lib/task-access.ts`) while this route
    // has no auth, so returning an aggregate over everyone's would be a new cross-user
    // disclosure. Backlog items are documented as shared, so their count reveals nothing.
    ungrouped: { items: result.ungrouped.items },
    // Said explicitly because it's the one thing a user might assume this removed. The ref and
    // its commits are untouched; nothing in lib/features.ts has ever run git.
    branch: result.branch,
    message: `Deleted. The branch ${result.branch} and its commits are untouched.`,
  });
}
