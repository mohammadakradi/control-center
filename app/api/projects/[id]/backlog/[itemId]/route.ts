import { NextResponse } from "next/server";
import {
  fileOwnedEdits,
  findBacklogItem,
  parseBacklogEdit,
  updateBacklogItem,
} from "@/lib/backlog";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; itemId: string }> };

/**
 * PATCH /api/projects/:id/backlog/:itemId — change an item's status, or edit a hand-added one.
 *
 * A status set here sticks: it outranks both the `.pm/tasks/` sync and the linked-task
 * reflection from then on, because a person saying "cancelled" should beat a file or an exit
 * code. Everything else about a *synced* item comes from disk — including which feature it is
 * in, which is derived from the request folder it lives in — so those edits are refused rather
 * than silently reverted by the next load.
 */
export async function PATCH(req: Request, { params }: Ctx) {
  const { id, itemId } = await params;
  // Scoped to the project in the URL, so an id from another project reads as missing.
  const item = findBacklogItem(id, itemId);
  if (!item) return NextResponse.json({ error: "not found" }, { status: 404 });

  // `id` is passed so a `featureId` in the body is checked against *this* project's features.
  const parsed = parseBacklogEdit(await req.json().catch(() => null), id);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const edit = parsed.value;
  if (Object.keys(edit).length === 0) {
    return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  }

  const owned = item.sourcePath ? fileOwnedEdits(edit) : [];
  if (owned.length > 0) {
    return NextResponse.json(
      {
        error: `${owned.join(", ")} ${owned.length > 1 ? "are" : "is"} derived from ${item.sourcePath} and the request folder holding it — change it on disk instead. Only status can be changed here.`,
      },
      { status: 409 },
    );
  }

  return NextResponse.json(updateBacklogItem(item.id, edit));
}
