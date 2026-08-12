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
 * code. Everything else about a *synced* item belongs to its spec file, so those edits are
 * refused rather than silently reverted by the next load.
 */
export async function PATCH(req: Request, { params }: Ctx) {
  const { id, itemId } = await params;
  // Scoped to the project in the URL, so an id from another project reads as missing.
  const item = findBacklogItem(id, itemId);
  if (!item) return NextResponse.json({ error: "not found" }, { status: 404 });

  const parsed = parseBacklogEdit(await req.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const edit = parsed.value;
  if (Object.keys(edit).length === 0) {
    return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  }

  const owned = item.sourcePath ? fileOwnedEdits(edit) : [];
  if (owned.length > 0) {
    return NextResponse.json(
      {
        error: `${owned.join(", ")} ${owned.length > 1 ? "are" : "is"} read from ${item.sourcePath} — edit the spec file instead. Only status can be changed here.`,
      },
      { status: 409 },
    );
  }

  return NextResponse.json(updateBacklogItem(item.id, edit));
}
