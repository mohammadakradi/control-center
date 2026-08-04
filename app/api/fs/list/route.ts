import { NextResponse } from "next/server";
import { dirname } from "node:path";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { FsBrowseError, listDirectories } from "@/lib/fs-browse";

export const dynamic = "force-dynamic";

// GET /api/fs/list?path=<absolute folder> — sub-directories of one folder, for the in-app
// project folder picker. Omit `path` to start at the first browse root.
//
// Signed-in only: it exposes a slice of the server's filesystem. Browsing is jailed to the
// roots in `lib/fs-browse.ts` (PROJECT_ROOTS, default ~/Dev).
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const path = new URL(req.url).searchParams.get("path");
  const registered = db.select({ path: projects.path }).from(projects).all();

  try {
    // Parents of registered projects are the last-resort roots — see `browseRoots()`.
    const listing = listDirectories(
      path,
      registered.map((p) => dirname(p.path)),
    );
    const taken = new Set(registered.map((p) => p.path));
    return NextResponse.json({
      ...listing,
      entries: listing.entries.map((e) => ({ ...e, registered: taken.has(e.path) })),
    });
  } catch (err) {
    if (err instanceof FsBrowseError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
