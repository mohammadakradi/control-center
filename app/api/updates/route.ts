import { NextResponse } from "next/server";
import { readUpdateRun } from "@/lib/update-run";
import { checkForUpdate } from "@/lib/updates";
import { APP_VERSION } from "@/lib/version";

export const dynamic = "force-dynamic";

// GET /api/updates — is a newer release published, and how did the last attempt to install one
// end? The release check is memoized for 6h in-process, so this is cheap to call on every page
// load. Never fails: an unreachable GitHub comes back as `unavailable: "offline"` with a 200,
// because a failed update check is not a page error.
export async function GET() {
  const status = await checkForUpdate();
  // Read fresh every time, deliberately outside that cache: `run` is what the banner polls
  // while an update is in flight, so it changes second to second. A checkout has no install to
  // update, and reading a real install's record from a dev server would only mislead.
  return NextResponse.json({
    ...status,
    run: status.packaged ? readUpdateRun({ currentVersion: APP_VERSION }) : null,
  });
}
