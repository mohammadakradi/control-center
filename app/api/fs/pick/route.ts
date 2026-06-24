import { NextResponse } from "next/server";
import { execFile } from "node:child_process";

export const dynamic = "force-dynamic";

// POST /api/fs/pick — open the native macOS folder chooser and return the selected absolute path.
// Works because this server runs locally on the user's Mac.
export async function POST() {
  if (process.platform !== "darwin") {
    return NextResponse.json(
      {
        error:
          "The native folder picker is only available on macOS. Type or paste the path instead.",
      },
      { status: 400 },
    );
  }

  try {
    const path = await new Promise<string>((resolve, reject) => {
      execFile(
        "osascript",
        [
          "-e",
          'POSIX path of (choose folder with prompt "Select a project folder")',
        ],
        (err, stdout, stderr) => {
          if (err) {
            // User pressed Cancel in the dialog.
            if (/User canceled|-128/i.test(stderr || err.message))
              return resolve("");
            return reject(new Error(stderr?.trim() || err.message));
          }
          resolve(stdout.trim());
        },
      );
    });

    if (!path) return NextResponse.json({ cancelled: true });
    return NextResponse.json({ path: path.replace(/\/+$/, "") });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
