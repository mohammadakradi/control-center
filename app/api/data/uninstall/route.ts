import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { count, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { LOCAL_USER_ID } from "@/lib/identity";
import { installWideDataOpAllowed } from "@/lib/data-transfer";

export const dynamic = "force-dynamic";

/** The installed launcher. Absent in a dev checkout, which is why this route refuses there. */
function cliPath(): string | null {
  const candidates = [
    resolve(homedir(), ".local/bin/control-center"),
    resolve(homedir(), ".control-center/app/infra/release/control-center.sh"),
  ];
  return candidates.find((p) => existsSync(p)) ?? null;
}

/**
 * POST /api/data/uninstall { confirm: "UNINSTALL", purge?: boolean }
 *
 * Removes the install: stops the server, deletes the Mac app bundle and the command, and — with
 * `purge` — the data too. The work is handed to a **detached** `control-center uninstall`,
 * because the first thing it does is stop the server answering this request; running it inline
 * would kill the process mid-response.
 *
 * Refused when the install has more than one account: nobody who merely opened the app should be
 * able to delete another person's data.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    confirm?: string;
    purge?: boolean;
  };
  if (body.confirm !== "UNINSTALL") {
    return NextResponse.json(
      { error: 'Type UNINSTALL to confirm (send { confirm: "UNINSTALL" }).' },
      { status: 400 },
    );
  }

  const [{ n }] = db
    .select({ n: count() })
    .from(users)
    .where(ne(users.id, LOCAL_USER_ID))
    .all();
  const allowed = installWideDataOpAllowed(n, "uninstall");
  if (!allowed.ok) return NextResponse.json({ error: allowed.reason }, { status: 403 });

  const cli = cliPath();
  if (!cli) {
    return NextResponse.json(
      {
        error:
          "This looks like a development checkout, not an installed app — there's nothing for " +
          "uninstall to remove. Use `pnpm stop` / delete the checkout instead.",
      },
      { status: 400 },
    );
  }

  // Detached and disowned: it outlives this process on purpose.
  const child = spawn("/bin/sh", ["-c", `'${cli}' uninstall${body.purge ? " --purge" : ""}`], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();

  return NextResponse.json({
    started: true,
    purge: Boolean(body.purge),
    message: body.purge
      ? "Uninstalling and deleting your data. This window will lose its connection — you can close it."
      : "Uninstalling. Your data is kept in ~/.control-center. This window will lose its connection — you can close it.",
  });
}
