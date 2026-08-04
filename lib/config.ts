import { homedir } from "node:os";
import { resolve } from "node:path";

/** Port the runner daemon listens on. */
export const RUNNER_PORT = Number(process.env.RUNNER_PORT ?? 4319);

/** Base URL the Next.js server uses to reach the daemon. Server-side only — the
 *  browser goes through the authenticated /api/tasks/[id]/* proxy routes. */
export const RUNNER_URL =
  process.env.RUNNER_URL ?? `http://localhost:${RUNNER_PORT}`;

/**
 * Local data dir (sqlite + uploads + the token vault). Both the Next app and the runner run
 * with cwd = repo root, so a checkout keeps its data in `./data`.
 *
 * `PLATFORM_DATA_DIR` moves it elsewhere, which an *installed* app requires: the `control-center`
 * CLI points it at `~/.control-center/data` so that replacing the app directory on update can't
 * take the database and encrypted tokens with it.
 */
export const DATA_DIR = process.env.PLATFORM_DATA_DIR?.trim()
  ? resolve(process.env.PLATFORM_DATA_DIR.trim())
  : resolve(process.cwd(), "data");
/** Where task attachments (docs/photos the user adds to a request) are stored, per task. */
export const UPLOADS_DIR = resolve(DATA_DIR, "uploads");

/** Claude Code plugin registry on this machine. */
export const CLAUDE_DIR = resolve(homedir(), ".claude");
export const INSTALLED_PLUGINS_JSON = resolve(
  CLAUDE_DIR,
  "plugins/installed_plugins.json",
);
export const KNOWN_MARKETPLACES_JSON = resolve(
  CLAUDE_DIR,
  "plugins/known_marketplaces.json",
);
