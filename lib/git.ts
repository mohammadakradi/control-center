import { execFileSync } from "node:child_process";
import { escapesOnDisk, readFileInside } from "./safe-read";

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

/** Ceiling on reading an untracked file — to count its lines for the changes list, and to
 *  build its diff. The line-count read used to be unbounded, so a multi-gigabyte untracked
 *  file was a way to make that route exhaust memory. Past the cap the file counts 0
 *  additions and shows no diff, like any other unreadable one. Comfortably above `DIFF_CAP`,
 *  which truncates the rendered diff a good deal earlier. */
const UNTRACKED_READ_CAP = 2 * 1024 * 1024;

/**
 * Flags every `git diff` here must carry, because a repository can define what "diff" *means*.
 *
 * `diff.<name>.textconv` and `diff.<name>.command` name a shell command git runs to render a
 * file. The command lives in `.git/config` and the pattern binding it to a path can live in
 * `.git/info/attributes` — neither is a tracked file, so neither shows up in `git status`, a
 * review, or a clone. Both are ordinary filesystem writes inside a repo, which is exactly what
 * a task's Bash tool has in the worktree it runs in. Verified: without these flags a planted
 * driver executes on `git diff HEAD -- <path>`; with them it does not, and the diff is
 * unchanged.
 *
 * A clone can't carry this (`.git/config` and `.git/hooks` never transfer), so it is the
 * agent-with-Bash arm of the threat model, not the untrusted-repo one.
 */
const NO_CUSTOM_DIFF_DRIVERS = ["--no-ext-diff", "--no-textconv"];

function git(cwd: string, args: string[]): string {
  try {
    // Trim only trailing whitespace — leading spaces are significant in
    // `git status --porcelain` (the XY status column starts at column 0).
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    }).replace(/\s+$/, "");
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
  const numstat = git(cwd, [
    "diff",
    ...NO_CUSTOM_DIFF_DRIVERS,
    "--numstat",
    "HEAD",
  ]);
  for (const l of numstat.split("\n").filter(Boolean)) {
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
    // Only files that will actually be displayed get read. The loop walks every entry
    // `git status` reports, so a project with a large untracked tree (a missing .gitignore
    // over node_modules is the usual way) would otherwise pay a contained read — several
    // syscalls each — for tens of thousands of files it is about to throw away, on the
    // process that also serves the SSE task streams.
    //
    // The cost of the cap: untracked files past `FILE_CAP` contribute 0 to `totalAdded`
    // rather than their real line count. They already contribute nothing to the list, and
    // `truncated` says how many were dropped, so the summary stays readable — but it is an
    // undercount on a tree that large, and that is the deliberate trade.
    if (code.includes("?") && files.length < FILE_CAP) {
      // Untracked: count its lines as additions. The read is contained (lib/safe-read.ts)
      // because `git status` reports an untracked *symlink* as an ordinary entry — following
      // it would leak the line count of whatever it points at, and a FIFO planted in the tree
      // would block this request forever. Anything refused counts as 0, exactly like the
      // binary/unreadable case this already tolerated.
      const read = readFileInside(cwd, path, UNTRACKED_READ_CAP);
      added =
        read.ok && read.content
          ? read.content.replace(/\n$/, "").split("\n").length
          : 0;
    }
    files.push({ path, status: statusLabel(code), added, deleted });
  }

  const totalAdded = files.reduce((s, f) => s + f.added, 0);
  const totalDeleted = files.reduce((s, f) => s + f.deleted, 0);
  const truncated = Math.max(0, files.length - FILE_CAP);

  return { files: files.slice(0, FILE_CAP), totalAdded, totalDeleted, truncated };
}

const DIFF_CAP = 200_000;

/**
 * Unified diff for a single path: working tree vs HEAD, or the whole file if untracked.
 *
 * Refuses a path that escapes `cwd` on disk. The exposure was never the obvious shape:
 * `--no-index` renders a plain symlink as mode 120000 with the *target path* as its content,
 * which is harmless — but a symlinked intermediate directory (`link/` -> /secrets, asked for
 * as `link/id_rsa`) is followed and the target's real content is emitted.
 *
 * The untracked branch no longer hands a worktree path to git at all. A Node-side check
 * followed by a subprocess is check-then-use with a *process spawn* sitting in the window,
 * which is wide: an audit leaked a planted secret through it in 9–15ms and under 100
 * attempts, 3 times out of 3. Reading the file through `readFileInside` instead moves the
 * decision onto a file handle, so there is no path left for anyone to re-point.
 */
export function gitFileDiff(cwd: string, path: string): string {
  if (escapesOnDisk(cwd, path)) return "";
  const diff =
    git(cwd, ["diff", ...NO_CUSTOM_DIFF_DRIVERS, "HEAD", "--", path]) ||
    untrackedDiff(cwd, path);
  return diff.length > DIFF_CAP
    ? `${diff.slice(0, DIFF_CAP)}\n… (diff truncated)`
    : diff;
}

/**
 * The diff `git diff --no-index /dev/null <path>` used to produce for an untracked file:
 * every line an addition. Synthesized from a contained read rather than asked of git, so no
 * filesystem path crosses into a subprocess. The shape matches git's closely enough for the
 * renderer, which colours lines by their prefix (`components/DiffModal.tsx`).
 */
function untrackedDiff(cwd: string, path: string): string {
  const read = readFileInside(cwd, path, UNTRACKED_READ_CAP);
  if (!read.ok) return "";

  const header = `diff --git a/${path} b/${path}\nnew file mode 100644\n--- /dev/null\n+++ b/${path}`;
  // git reports a NUL-containing file as binary rather than emitting its bytes as "+" lines.
  if (read.content.includes("\0")) return `${header}\nBinary file b/${path} differs`;
  if (read.content === "") return header;

  const endsWithNewline = read.content.endsWith("\n");
  const lines = read.content.replace(/\n$/, "").split("\n");
  const body = lines.map((l) => `+${l}`).join("\n");
  // git writes `@@ -0,0 +1 @@` for a one-line file, not `+1,1` — the count is omitted when it
  // is 1. Nothing parses it (the renderer only colours by prefix), but a one-line new file is
  // about the most common case there is and there is no reason to be subtly wrong about it.
  const span = lines.length === 1 ? "+1" : `+1,${lines.length}`;
  return `${header}\n@@ -0,0 ${span} @@\n${body}${
    endsWithNewline ? "" : "\n\\ No newline at end of file"
  }`;
}

/**
 * Content of one file at a ref (`git show ref:path`), or null when git can't produce it
 * (unknown ref, path not in that tree, not a repo). Used to read a finished parallel task's
 * committed files after its worktree was cleaned up — the branch is what survives.
 * The ref must not start with "-": args go through execFile (no shell), so a leading dash
 * being read as a git option is the one injection left to refuse.
 */
export function gitShowFile(cwd: string, ref: string, path: string): string | null {
  if (!ref || ref.startsWith("-")) return null;
  try {
    return execFileSync("git", ["show", `${ref}:${path}`], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch {
    return null;
  }
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
