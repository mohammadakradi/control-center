import { homedir } from "node:os";
import { resolve } from "node:path";

/** Port the runner daemon listens on. */
export const RUNNER_PORT = Number(process.env.RUNNER_PORT ?? 4319);

/** Base URL the Next.js app + browser use to reach the daemon. */
export const RUNNER_URL =
  process.env.RUNNER_URL ?? `http://localhost:${RUNNER_PORT}`;

/** Exposed to the browser so the live task view can hit the daemon directly. */
export const PUBLIC_RUNNER_URL =
  process.env.NEXT_PUBLIC_RUNNER_URL ?? RUNNER_URL;

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
