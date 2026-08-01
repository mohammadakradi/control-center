import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { spendForUser } from "@/lib/usage-summary";
import { daemonUsageSnapshot } from "@/lib/daemon-client";

export const dynamic = "force-dynamic";

// GET /api/usage — the signed-in user's own usage.
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
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const spend = spendForUser(user.id);
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
