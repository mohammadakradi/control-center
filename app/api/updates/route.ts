import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { checkForUpdate } from "@/lib/updates";

export const dynamic = "force-dynamic";

// GET /api/updates — is a newer release published? Answer is memoized for 6h in-process, so
// this is cheap to call on every page load. Never fails: an unreachable GitHub comes back as
// `unavailable: "offline"` with a 200, because a failed update check is not a page error.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(await checkForUpdate());
}
