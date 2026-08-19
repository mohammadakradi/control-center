import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { closeSync } from "node:fs";
import { inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { tasks, type TaskStatus } from "@/lib/db/schema";
import { cliPath } from "@/lib/launcher";
import { ACTIVE_STATUSES } from "@/lib/ui";
import {
  markUpdateStarted,
  openAttemptLog,
  readUpdateRun,
} from "@/lib/update-run";
import { APP_VERSION, IS_PACKAGED } from "@/lib/version";

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
 *
 * The child's output goes to `logs/update.log` and its outcome to `run/update.status`
 * (`lib/update-run.ts`), which `GET /api/updates` reports. With `stdio: "ignore"` a failure
 * anywhere in that pipeline left no trace at all and the dashboard could only time out.
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

  // One at a time, and `force` does not override this. Two `apply_update`s racing each other's
  // `mv` on `app/` can leave no app directory at all, which is a far worse outcome than a slow
  // update — and the request is being satisfied either way, so this is a 200: the caller wanted
  // the pending release applied, and it is being applied. A run whose process is gone reads as
  // `crashed`, not `running`, so a dead attempt never blocks a retry.
  const inFlight = readUpdateRun({ currentVersion: APP_VERSION });
  if (inFlight?.state === "running") {
    return NextResponse.json({
      started: false,
      alreadyRunning: true,
      logPath: inFlight.logPath,
      message: `Already updating${inFlight.target ? ` to ${inFlight.target}` : ""}. The server restarts — this page reconnects when it's back.`,
    });
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

  // Where the attempt's output goes. The script tees into this file itself when it's run by
  // hand; `CC_UPDATE_LOG` tells it not to, because we've already pointed its stdout here — and
  // this way the log also catches a failure *before* the script gets going (an unusable
  // `/bin/sh -c`, or "Node.js 22+ is required but not on PATH").
  let log: { path: string; fd: number } | null = null;
  try {
    log = openAttemptLog();
  } catch (err) {
    // A log we can't open is not a reason to refuse the update.
    console.warn("[updates] couldn't open the update log:", err);
  }

  // Detached and disowned: it outlives this process on purpose.
  const child = spawn("/bin/sh", ["-c", `CC_NO_OPEN=1 '${cli}' update`], {
    detached: true,
    stdio: ["ignore", log?.fd ?? "ignore", log?.fd ?? "ignore"],
    env: log ? { ...process.env, CC_UPDATE_LOG: log.path } : process.env,
  });
  // An async spawn failure (ENOENT, EMFILE) arrives as an 'error' event, and an unhandled one
  // on an EventEmitter takes the whole server down — for an update that merely didn't start.
  // The `running` record written below then reads as `crashed`, since its pid never existed,
  // so the next attempt isn't blocked either.
  child.on("error", (err) => console.warn("[updates] update failed to start:", err));
  child.unref();
  if (log) closeSync(log.fd); // the child holds its own copy now

  if (child.pid) {
    try {
      markUpdateStarted({ pid: child.pid, from: APP_VERSION });
    } catch (err) {
      console.warn("[updates] couldn't record the update attempt:", err);
    }
  }

  return NextResponse.json({
    started: true,
    logPath: log?.path ?? null,
    message: "Updating. The server restarts — this page reconnects when it's back.",
  });
}
