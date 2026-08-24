import { NextResponse } from "next/server";
import { readUpdateRun } from "@/lib/update-run";
import { checkForUpdate } from "@/lib/updates";
import { APP_VERSION } from "@/lib/version";

export const dynamic = "force-dynamic";

// GET /api/updates[?force=1] — is a newer release published, and how did the last attempt to
// install one end? The release check is memoized in-process, so this is cheap to call on every
// page load and on the banner's re-check interval. Never fails: an unreachable GitHub comes back
// as `unavailable: "offline"` with a 200, because a failed update check is not a page error.
//
// `force=1` backs a deliberate "Check now" and reaches past that memo. It is **not** a bypass:
// `checkForUpdate` keeps a floor under forced checks, because this route has no auth and is
// reachable over loopback from inside the container where a task's Bash tool runs — without one,
// forcing is a way to burn the unauthenticated 60-requests-per-hour GitHub budget and leave
// everyone's honest check answering `rate-limited`. Only exactly "1" counts, so a stray
// `?force=` or `?force=0` can't be read as truthy.
export async function GET(request: Request) {
  const force = new URL(request.url).searchParams.get("force") === "1";
  const status = await checkForUpdate({ force });
  // Read fresh every time, deliberately outside that cache: `run` is what the banner polls
  // while an update is in flight, so it changes second to second. A checkout has no install to
  // update, and reading a real install's record from a dev server would only mislead.
  return NextResponse.json({
    ...status,
    run: status.packaged ? readUpdateRun({ currentVersion: APP_VERSION }) : null,
  });
}
