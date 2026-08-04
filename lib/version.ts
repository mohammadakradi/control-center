import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Baked into released images by the release workflow (`--build-arg APP_VERSION`).
 *  Absent in a source checkout, which is how we tell the two apart. */
const baked = process.env.APP_VERSION?.trim();

function packageVersion(): string {
  try {
    const pkg = readFileSync(resolve(process.cwd(), "package.json"), "utf8");
    return (JSON.parse(pkg) as { version?: string }).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/** The running version, e.g. "0.2.0". */
export const APP_VERSION = baked || packageVersion();

/**
 * True when this is an installed release (image built and tagged by the release workflow),
 * false in a git checkout. Only a packaged install can be updated by the `control-center`
 * CLI — a checkout updates with `git pull` — so the UI only offers updates when packaged.
 */
export const IS_PACKAGED = Boolean(baked);

/** `owner/repo` whose GitHub Releases drive the update check. */
export const UPDATE_REPO =
  process.env.UPDATE_REPO?.trim() || "mohammadakradi/control-center";
