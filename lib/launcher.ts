/**
 * Finding the `control-center` command from inside the app.
 *
 * Anything that replaces or removes the running install has to be handed to the launcher and
 * run **detached** — the first thing those commands do is stop the server answering the
 * request, so running one inline kills the process mid-response.
 *
 * Absent in a development checkout, which is how the routes know to refuse there.
 */
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

/** The installed launcher, or null when this isn't an install. */
export function cliPath(): string | null {
  const candidates = [
    resolve(homedir(), ".local/bin/control-center"),
    resolve(homedir(), ".control-center/app/infra/release/control-center.sh"),
  ];
  return candidates.find((p) => existsSync(p)) ?? null;
}
