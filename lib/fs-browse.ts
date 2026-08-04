/**
 * Directory browsing for the in-app project folder picker.
 *
 * The old picker shelled out to macOS `osascript` (`choose folder`), which only works when
 * Next.js runs natively on the user's Mac. The normal dev path is the Docker container
 * (Linux, no GUI), where that can never work — so the picker now lists directories through
 * this module instead.
 *
 * Everything is jailed to a set of *browse roots*: the picker may list a root and anything
 * below it, and nothing above it. (Typing a path by hand in the Add-project form is
 * unaffected — that has always accepted any absolute path.)
 */
import { existsSync, readdirSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, resolve, sep } from "node:path";

/** Cap on entries returned for one directory, so a folder with thousands of children can't
 *  produce a multi-megabyte response. The listing reports when it hit this. */
const MAX_ENTRIES = 500;

/** Noise that is never a project folder. `.git`, `.next`, `.venv` etc. are all dot-dirs. */
const SKIP_NAMES = new Set(["node_modules"]);

export type DirEntry = {
  name: string;
  /** Absolute path — what the client sends back to navigate or select. */
  path: string;
  /** Has a `.git` directory: a strong hint this folder is the project itself. */
  isGit: boolean;
};

export type DirListing = {
  /** The directory that was listed (absolute, symlinks resolved). */
  path: string;
  /** Parent directory, or `null` when `path` is a browse root — the ceiling. */
  parent: string | null;
  /** All configured browse roots, so the UI can offer jumps back to them. */
  roots: string[];
  entries: DirEntry[];
  /** True when the directory had more than `MAX_ENTRIES` sub-directories. */
  truncated: boolean;
};

/** A browse failure with the HTTP status the route should return. */
export class FsBrowseError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "FsBrowseError";
    this.status = status;
  }
}

/** Resolve symlinks where possible; fall back to the literal path if it doesn't exist.
 *  Needed because macOS temp dirs (and `/tmp` itself) are symlinks, so a jail check on
 *  raw strings would reject paths that are genuinely inside a root. */
function realOrSelf(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/** `~` / `~/x` → the current user's home. Mirrors `scanProject()`'s expansion so a path
 *  typed into the Add-project field can be handed straight to the picker. */
function expandHome(path: string): string {
  return resolve(path.replace(/^~(?=$|\/)/, homedir()));
}

function isInside(child: string, parent: string): boolean {
  return child === parent || child.startsWith(parent.endsWith(sep) ? parent : parent + sep);
}

/**
 * Directories the picker may browse.
 *
 * `PROJECT_ROOTS` (colon-separated, PATH-style) wins; otherwise the home directory, so a
 * project can live anywhere under it. Docker needs the env var: inside the container
 * `homedir()` is `/home/node`, while the *host's* home is bind-mounted at its own absolute
 * path (e.g. `/Users/you`), so compose passes that path explicitly.
 *
 * A path only helps if the runner can also see it — in Docker that means it has to be inside
 * a bind mount. Widening these roots without widening the mounts just produces empty folders.
 *
 * With no env var, `extraRoots` (the parents of already-registered projects, supplied by the
 * route) are added alongside the home directory rather than used only as a last resort. In a
 * container that predates the compose change, `homedir()` is `/home/node` — it *exists*, so a
 * last-resort fallback would never fire and the picker would strand you in the container's own
 * home with none of your projects in sight.
 */
export function browseRoots(extraRoots: string[] = []): string[] {
  const dedupe = (paths: string[]) => [...new Set(paths)];
  const configured = process.env.PROJECT_ROOTS?.trim();
  const roots = configured
    ? configured
        // `path.delimiter`, not a literal ":" — on Windows the separator is ";" because a
        // colon is part of every absolute path (`C:\src`).
        .split(delimiter)
        .map((p) => p.trim())
        .filter(Boolean)
        .map(expandHome)
    : [homedir(), ...extraRoots.map(expandHome)];
  // Drop roots that aren't there: on a host where a configured root doesn't exist (or a drive
  // isn't mounted yet) it can't be browsed anyway, and offering it as a dead chip is worse than
  // hiding it. Recomputed per request, so a root that appears later shows up on the next open.
  return dedupe(roots).filter((p) => existsSync(p));
}

/** Which root contains `path`, or null if none does. Compared on resolved real paths. */
function containingRoot(path: string, roots: string[]): string | null {
  const real = realOrSelf(path);
  return roots.find((root) => isInside(real, realOrSelf(root))) ?? null;
}

/**
 * The directory to list: the requested path if it's inside a root, else the first root that
 * exists. Throws `FsBrowseError` when no root is usable or the request escapes the jail.
 */
export function resolveBrowsePath(
  requested: string | null | undefined,
  fallbackRoots: string[] = [],
): { path: string; roots: string[] } {
  const roots = browseRoots(fallbackRoots);
  if (roots.length === 0) {
    throw new FsBrowseError(
      "No browsable project folder is configured. Set PROJECT_ROOTS to the folder your projects live in, or type the path instead.",
      500,
    );
  }
  if (!requested?.trim()) {
    const first = roots.find((r) => existsSync(r));
    if (!first) {
      throw new FsBrowseError(
        `Browse root not found: ${roots[0]}. Set PROJECT_ROOTS to a folder that exists, or type the path instead.`,
        500,
      );
    }
    return { path: first, roots };
  }

  const path = expandHome(requested.trim());
  if (!containingRoot(path, roots)) {
    throw new FsBrowseError(
      `That folder is outside the browsable roots (${roots.join(", ")}). Type the path instead.`,
      403,
    );
  }
  return { path, roots };
}

/** List the sub-directories of one directory inside the browse roots. */
export function listDirectories(
  requested?: string | null,
  fallbackRoots: string[] = [],
): DirListing {
  const { path: target, roots } = resolveBrowsePath(requested, fallbackRoots);

  let dirents;
  try {
    if (!statSync(target).isDirectory()) {
      throw new FsBrowseError(`Not a folder: ${target}`, 400);
    }
    dirents = readdirSync(target, { withFileTypes: true });
  } catch (err) {
    if (err instanceof FsBrowseError) throw err;
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EACCES" || code === "EPERM") {
      throw new FsBrowseError(`Permission denied: ${target}`, 403);
    }
    throw new FsBrowseError(`Folder not found: ${target}`, 404);
  }

  // `isDirectory()` is false for symlinks, so symlinked folders are skipped rather than
  // shown-but-unenterable (following one could land outside the jail). Paste the path to
  // add such a folder.
  const dirs = dirents
    .filter((d) => d.isDirectory() && !d.name.startsWith(".") && !SKIP_NAMES.has(d.name))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

  const entries = dirs.slice(0, MAX_ENTRIES).map((d) => {
    const path = resolve(target, d.name);
    return { name: d.name, path, isGit: existsSync(resolve(path, ".git")) };
  });

  // Up is offered whenever the parent is itself inside a root — so with several roots you can
  // walk from `~/you` up through `/Users`, and with a single root that root stays the ceiling.
  const up = dirname(target);
  const parent = up !== target && containingRoot(up, roots) ? up : null;

  return {
    path: target,
    parent,
    roots,
    entries,
    truncated: dirs.length > entries.length,
  };
}
