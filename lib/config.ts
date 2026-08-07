import { homedir } from "node:os";
import { resolve } from "node:path";

/** Port the runner daemon listens on. */
export const RUNNER_PORT = Number(process.env.RUNNER_PORT ?? 4319);

/**
 * Interface the runner binds. Loopback by default — the daemon has no authentication of its own
 * (it is meant to be reachable only through the Next.js proxy routes, which do the auth), so a
 * default of "every interface" put task dispatch on the local network. It was one: @hono/node-server
 * binds all interfaces when no hostname is given.
 *
 * `RUNNER_HOST=0.0.0.0` is for containers only, where binding loopback *inside* the container
 * would make Docker's published port unreachable. Compose sets it, and publishes to 127.0.0.1.
 */
export function runnerHost(value = process.env.RUNNER_HOST): string {
  return value?.trim() || "127.0.0.1";
}
export const RUNNER_HOST = runnerHost();

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

/**
 * Agent plugins shipped inside the app (`agents/<namespace>`), so a fresh install has working
 * agents without the user first registering marketplaces with the Claude Code CLI. Both the Next
 * app and the runner run with cwd = app root, and the release tarball carries this directory.
 * `PLATFORM_AGENTS_DIR` overrides it.
 */
export const BUNDLED_AGENTS_DIR = process.env.PLATFORM_AGENTS_DIR?.trim()
  ? resolve(process.env.PLATFORM_AGENTS_DIR.trim())
  : resolve(process.cwd(), "agents");
