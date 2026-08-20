import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import {
  MAX_LIMIT,
  parseSearchLimit,
  parseSearchQuery,
  searchAll,
} from "@/lib/search";

export const dynamic = "force-dynamic";

/**
 * GET /api/search?q=…&limit=… — one query, four types (tasks, projects, agents, backlog items).
 *
 * Built for an as-you-type command palette, so it is called on keystrokes: a query below the
 * minimum length is a normal 200 with empty lists and `tooShort: true`, not an error. Only
 * genuinely malformed input (an over-long query, an off-range limit) is a 400 — refused rather
 * than clamped, so results can never claim to answer something other than what was asked.
 *
 * HTTP translation only; the queries and every bound live in `lib/search.ts`.
 *
 * Scoped to the caller for **tasks alone**, via `ownedBy` — transcripts and task existence are
 * private, so an unscoped search would let anyone probe for other people's runs. Projects,
 * agents and backlogs are shared by design (see lib/task-access) and already readable through
 * their own routes.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  const params = new URL(request.url).searchParams;

  const q = parseSearchQuery(params.get("q"));
  if (!q.ok) return NextResponse.json({ error: q.error }, { status: 400 });

  const limit = parseSearchLimit(params.get("limit"));
  if (limit === null) {
    return NextResponse.json(
      { error: `limit must be a whole number between 1 and ${MAX_LIMIT}.` },
      { status: 400 },
    );
  }

  return NextResponse.json(searchAll(user.id, { q: q.value, limit }));
}
