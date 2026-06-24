import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export type FileChange = {
  path: string;
  status: string; // modified | added | deleted | renamed | untracked
  added: number;
  deleted: number;
};

export type GitChanges = {
  files: FileChange[];
  totalAdded: number;
  totalDeleted: number;
  truncated: number; // files beyond the display cap
};

const FILE_CAP = 200;

function git(cwd: string, args: string[]): string {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    }).trim();
  } catch {
    return "";
  }
}

export type GitResult = { ok: boolean; output: string };

/** Run a git command capturing both stdout and stderr (git progress goes to stderr). */
function runGit(cwd: string, args: string[]): GitResult {
  try {
    const out = execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 16 * 1024 * 1024,
    });
    return { ok: true, output: out.trim() || "Done." };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message?: string };
    const output =
      [err.stdout, err.stderr].filter(Boolean).join("\n").trim() ||
      err.message ||
      "git command failed";
    return { ok: false, output };
  }
}

function statusLabel(code: string): string {
  if (code.includes("?")) return "untracked";
  switch (code.trim()[0]) {
    case "A":
      return "added";
    case "D":
      return "deleted";
    case "R":
      return "renamed";
    case "C":
      return "copied";
    default:
      return "modified";
  }
}

function unquote(path: string): string {
  // git quotes paths with special chars; the quoted form is valid JSON.
  if (path.startsWith('"') && path.endsWith('"')) {
    try {
      return JSON.parse(path) as string;
    } catch {
      return path;
    }
  }
  return path;
}

/** Summarize uncommitted working-tree changes (staged + unstaged + untracked). */
export function gitChanges(cwd: string): GitChanges {
  // Line counts for tracked changes relative to the last commit.
  const lines = new Map<string, { added: number; deleted: number }>();
  for (const l of git(cwd, ["diff", "--numstat", "HEAD"]).split("\n").filter(Boolean)) {
    const [a, d, ...rest] = l.split("\t");
    lines.set(rest.join("\t"), {
      added: a === "-" ? 0 : Number(a) || 0,
      deleted: d === "-" ? 0 : Number(d) || 0,
    });
  }

  const files: FileChange[] = [];
  const status = git(cwd, ["status", "--porcelain", "--untracked-files=all"]);
  for (const raw of status.split("\n").filter(Boolean)) {
    const code = raw.slice(0, 2);
    let path = raw.slice(3);
    if (path.includes(" -> ")) path = path.split(" -> ")[1]; // rename → new name
    path = unquote(path);

    const counts = lines.get(path) ?? { added: 0, deleted: 0 };
    let added = counts.added ?? 0;
    const deleted = counts.deleted ?? 0;
    if (code.includes("?")) {
      // Untracked: count its lines as additions.
      try {
        const text = readFileSync(resolve(cwd, path), "utf8");
        added = text ? text.replace(/\n$/, "").split("\n").length : 0;
      } catch {
        added = 0; // binary/unreadable
      }
    }
    files.push({ path, status: statusLabel(code), added, deleted });
  }

  const totalAdded = files.reduce((s, f) => s + f.added, 0);
  const totalDeleted = files.reduce((s, f) => s + f.deleted, 0);
  const truncated = Math.max(0, files.length - FILE_CAP);

  return { files: files.slice(0, FILE_CAP), totalAdded, totalDeleted, truncated };
}

export type BranchInfo = {
  current: string | null;
  branches: string[];
  hasRemote: boolean;
  tracking: string | null;
  ahead: number;
  behind: number;
};

/** Current branch, local branches, and ahead/behind vs. the upstream. */
export function gitBranchInfo(cwd: string): BranchInfo {
  const current = git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]) || null;
  const branches = git(cwd, [
    "for-each-ref",
    "--format=%(refname:short)",
    "refs/heads",
  ])
    .split("\n")
    .filter(Boolean);
  const hasRemote = git(cwd, ["remote"]).length > 0;

  let tracking: string | null = null;
  let ahead = 0;
  let behind = 0;
  const upstream = git(cwd, [
    "rev-parse",
    "--abbrev-ref",
    "--symbolic-full-name",
    "@{upstream}",
  ]);
  if (upstream) {
    tracking = upstream;
    // left-right count: left = upstream-only (behind), right = HEAD-only (ahead)
    const counts = git(cwd, [
      "rev-list",
      "--left-right",
      "--count",
      `${upstream}...HEAD`,
    ]);
    const [b, a] = counts.split(/\s+/).map((n) => Number(n) || 0);
    behind = b ?? 0;
    ahead = a ?? 0;
  }

  return { current, branches, hasRemote, tracking, ahead, behind };
}

export const gitCheckout = (cwd: string, branch: string): GitResult =>
  runGit(cwd, ["checkout", branch]);

export const gitCreateBranch = (cwd: string, branch: string): GitResult =>
  runGit(cwd, ["checkout", "-b", branch]);

/** Fast-forward-only pull, so a divergent history fails loudly instead of auto-merging. */
export const gitPull = (cwd: string): GitResult =>
  runGit(cwd, ["pull", "--ff-only"]);

/** Push the current branch, setting upstream on first push. */
export const gitPush = (cwd: string): GitResult =>
  runGit(cwd, ["push", "-u", "origin", "HEAD"]);
