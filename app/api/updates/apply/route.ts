import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { tasks, type TaskStatus } from "@/lib/db/schema";
import { cliPath } from "@/lib/launcher";
import { ACTIVE_STATUSES } from "@/lib/ui";
import { IS_PACKAGED } from "@/lib/version";

export const dynamic = "force-dynamic";

/**
 * POST /api/updates/apply { force?: boolean }
 *
 * Applies the pending release. The app still doesn't update *itself* — it can't, since the
 * update replaces the files of the running process — so the work is handed to a **detached**
 * `control-center update`, exactly as uninstall is. That command stops the server (this one),
 * swaps `app/`, migrates, and starts it again.
 *
 * `CC_NO_OPEN=1` because the window asking for this is already open; without it the restart
 * opens a second one.
 *
 * Refused while a task is running unless `force`: the restart kills the agent's session, and
 * the runner fails every non-terminal task it finds on boot. Losing a half-finished run to a
 * button labelled "Update" is not a trade anyone would choose knowingly.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { force?: boolean };

  const cli = cliPath();
  if (!cli || !IS_PACKAGED) {
    return NextResponse.json(
      {
        error:
          "This is a development checkout, not an installed app. Update it with `git pull` " +
          "instead — there's no release for the launcher to apply.",
      },
      { status: 400 },
    );
  }

  if (!body.force) {
    const active = db
      .select({ id: tasks.id })
      .from(tasks)
      // ACTIVE_STATUSES is a Set<string> because client components match raw status strings
      // against it; the column is typed to the union.
      .where(inArray(tasks.status, [...ACTIVE_STATUSES] as TaskStatus[]))
      .all();
    if (active.length) {
      return NextResponse.json(
        {
          error: `${active.length} task${active.length === 1 ? " is" : "s are"} still running. Updating restarts the server, which ends ${active.length === 1 ? "it" : "them"}.`,
          activeTasks: active.length,
        },
        { status: 409 },
      );
    }
  }

  // Detached and disowned: it outlives this process on purpose.
  const child = spawn("/bin/sh", ["-c", `CC_NO_OPEN=1 '${cli}' update`], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();

  return NextResponse.json({
    started: true,
    message: "Updating. The server restarts — this page reconnects when it's back.",
  });
}
