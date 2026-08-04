import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { parseRange, spendForUser } from "@/lib/usage-summary";
import { daemonUsageSnapshot } from "@/lib/daemon-client";

export const dynamic = "force-dynamic";

// GET /api/usage?range=7d|30d|all — the signed-in user's own usage.
//
// Two halves with very different reliability, deliberately kept distinct rather than merged
// into one optimistic blob:
//   `spend`      — real numbers we recorded per task ourselves. Always present.
//   `rateLimits` — Claude plan windows from the SDK. Usually `available: false`, because
//                  plan limits aren't readable from an env-supplied token (see
//                  runner/usage-snapshot.ts). Never lets the spend half fail.
//
// Scoped to the caller: task transcripts are shared across the team by design, but spend is
// closer to billing, so it isn't.
export async function GET(request: Request) {
  const user = await getCurrentUser();

  // Absent means all-time (the historical shape); anything off the allowlist is a 400
  // rather than being quietly reinterpreted.
  const range = parseRange(new URL(request.url).searchParams.get("range"));
  if (range === null) {
    return NextResponse.json(
      { error: "Invalid range — use 7d, 30d, or all." },
      { status: 400 },
    );
  }

  const spend = spendForUser(user.id, { range });
  const snapshot = await daemonUsageSnapshot(user.id);

  return NextResponse.json({
    spend,
    rateLimits:
      snapshot ?? {
        available: false,
        reason: "The task runner isn't reachable, so plan limits couldn't be checked.",
        subscriptionType: null,
        windows: [],
        fetchedAt: new Date().toISOString(),
      },
  });
}
