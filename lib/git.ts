import { execFileSync } from "node:child_process";
import { lstatSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { escapesOnDisk, readBytesInside, readFileInside } from "./safe-read";

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
 *  file was a way to make that route exhaust memory. Past the cap the file counts 0 additions
 *  and shows no diff, like any other unreadable one. An untracked file's diff is its whole
 *  content, so `DIFF_CAP` would have truncated it to 200 KB regardless. */
const UNTRACKED_READ_CAP = 2 * 1024 * 1024;

/** Ceiling on either side of a *tracked* file's diff, matching the `maxBuffer` these git calls
 *  already run with — a bound on memory, not on what is worth showing.
 *
 *  It deliberately is not `UNTRACKED_READ_CAP`. A one-line edit deep inside a 4 MB tracked file
 *  produces a five-line hunk, and reusing the smaller cap here silently returned *no diff* for
 *  it — a regression review caught, since the old code let git read the file at any size and
 *  only the rendered output was ever capped. */
const TRACKED_READ_CAP = 16 * 1024 * 1024;

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
 * **git is never allowed to read the working tree here**, and that is the whole design. A
 * Node-side containment check followed by `git diff HEAD -- <path>` is check-then-use with a
 * *process spawn* sitting in the window, and git resolves the path independently of whatever
 * we resolved — so `O_NOFOLLOW`, realpath and `nlink` prove nothing about the file git will
 * open. Measured against the previous version of this function, in a repo where the tracked
 * file is flipped between an honest file and a hard link to an outside secret:
 * **3 leaks in 53 attempts, 20 ms.** (The regression spec in `lib/git.test.ts` is that race,
 * and it fails without this rewrite.)
 *
 * Two shapes were tested and only one of them works, which is worth recording because the
 * backlog item that asked for this fix named the wrong one:
 * - a symlinked *ancestor directory* on a tracked path does **not** leak — git reports the
 *   path as `deleted file mode 100644` rather than following the link. That is why an earlier
 *   audit attacked this at 66k attempts and found nothing.
 * - a **hard link** does leak, immediately. It has no target to resolve, so it is a plain
 *   regular file to every check except `nlink`, and git happily diffs whatever inode it names.
 *
 * So both sides now come from somewhere the caller's path cannot reach at read time: "before"
 * from the object store (`git show HEAD:<path>`), "after" through `readBytesInside`, which
 * decides on a file handle. git still renders the diff — on two files in a private temp
 * directory — so hunk format, binary detection and `\ No newline at end of file` stay exactly
 * as they were rather than being reimplemented here.
 */
export function gitFileDiff(cwd: string, path: string): string {
  // Kept as a cheap pre-filter and to preserve the existing "escaping paths get nothing"
  // answer. It is no longer what makes this safe — every branch below is sound on its own.
  if (escapesOnDisk(cwd, path)) return "";
  const diff = pathDiff(cwd, path);
  return diff.length > DIFF_CAP
    ? `${diff.slice(0, DIFF_CAP)}\n… (diff truncated)`
    : diff;
}

/** How HEAD describes a path. Read from the object store, so it is one thing an attacker
 *  writing in the working tree cannot restate. */
type HeadEntry =
  | { kind: "blob"; mode: string }
  | { kind: "symlink" }
  | { kind: "gitlink" }
  | { kind: "tree" }
  | { kind: "absent" };

function headEntry(cwd: string, path: string): HeadEntry {
  // `--literal-pathspecs` because `path` is a name, not a pattern: without it a leading ":"
  // is pathspec magic (`:/` is the repo root, `:(exclude)…` inverts a match) and `*` globs,
  // so a single request could name a set of files that no containment check ever saw.
  const line = git(cwd, [
    "--literal-pathspecs",
    "ls-tree",
    "HEAD",
    "--",
    path,
  ]).split("\n")[0];
  const [mode, type] = line.split("\t")[0].split(" ");
  if (type === "commit") return { kind: "gitlink" };
  if (type === "tree") return { kind: "tree" };
  if (type !== "blob") return { kind: "absent" }; // includes "no such path" and "no commits yet"
  return mode === "120000" ? { kind: "symlink" } : { kind: "blob", mode };
}

function pathDiff(cwd: string, path: string): string {
  const head = headEntry(cwd, path);
  switch (head.kind) {
    case "blob":
      return trackedDiff(cwd, path, head.mode);
    case "gitlink":
      return submoduleDiff(cwd, path);
    case "absent":
      // Untracked, or staged-but-not-committed: either way HEAD has nothing to diff against,
      // and "every line is an addition" is the right answer for both.
      return untrackedDiff(cwd, path);
    case "tree":
      // A tracked *directory*. `git diff HEAD -- docs` walks it and diffs every file inside,
      // none of which the caller named and none of which `escapesOnDisk` looked at — and
      // `escapesOnDisk` deliberately allows contained directories so submodules keep working.
      // That made a hard link planted at `docs/a.md` leak through a request for `docs` with
      // **no race at all**. This route serves one file; a directory is not one.
      return "";
    case "symlink":
      return symlinkDiff(cwd, path);
  }
}

/** A tracked file: HEAD's blob against a contained read of the working tree. */
function trackedDiff(cwd: string, path: string, headMode: string): string {
  const before = gitShowBytes(cwd, "HEAD", path);
  if (!before) return "";

  const after = readBytesInside(cwd, path, TRACKED_READ_CAP);
  if (!after.ok) {
    // "not-found" is an ordinary deleted file — the diff is served from the object store, so
    // there is still something to render. Anything else (too large, non-regular, hard-linked,
    // escaping) shows nothing, which is how an unreadable file has always been treated here.
    return after.reason === "not-found" ? deletedDiff(path, headMode, before) : "";
  }

  // git records exactly two file modes for a blob, keyed off the owner-execute bit.
  const workMode = after.mode & 0o100 ? "100755" : "100644";
  const modeLines =
    headMode === workMode ? "" : `old mode ${headMode}\nnew mode ${workMode}\n`;
  const start = `diff --git a/${path} b/${path}\n${modeLines}`;

  const body = diffBody(before, after.bytes);
  // A mode-only change is a real diff with no hunks — git prints the two mode lines and
  // nothing else. Without this, `chmod +x` showed as "modified" in the list and then opened
  // an empty diff.
  if (!body) return modeLines ? start.trimEnd() : "";
  if (body.binary)
    return `${start}Binary files a/${path} and b/${path} differ`;
  return `${start}--- a/${path}\n+++ b/${path}\n${body.body}`;
}

/**
 * A committed symlink. To git its content is the target *path*, and the honest "after" side
 * would be `readlink`. **We do not read it**, and that conclusion cost two wrong attempts:
 *
 * - A contained *content* read is wrong: `readBytesInside` follows the link and returns the
 *   target's content, so against HEAD's stored path text it renders a large bogus diff for a
 *   symlink nobody touched.
 * - `readlink` itself is wrong, which is the non-obvious one. It reads no file, but it
 *   *follows the directories above the link*, so pointing an ancestor at a directory outside
 *   the tree makes it return an outside symlink's target. The security re-audit demonstrated
 *   that end to end, including a variant with **no race at all**: `escapesOnDisk` answers
 *   "safe" for a path with nothing on disk (deliberately — that is how a deleted file's diff
 *   is served from the object store), and a *dangling* link behind a swapped ancestor is
 *   exactly that case. Validating the returned target lexically — which is what I tried first
 *   — does not help either: a plain relative target like `secret-name` resolves inside the
 *   root on paper while having been read from outside it.
 *
 * There is no sound version of this in Node: closing it needs the link's parent held as a
 * descriptor (`openat`/`O_PATH`), which Node does not expose, so every route to a symlink's
 * own target is a path the attacker can re-point. Shipping the narrow-but-open race instead
 * would repeat the mistake this whole change exists to correct.
 *
 * So: a symlink that is **gone** still renders its deletion, because that is built purely from
 * HEAD's committed blob and reads nothing from the tree. A symlink that is still there renders
 * nothing. The cost is a *retargeted* committed symlink showing no diff — rare, cosmetic, and
 * the file list still reports it as modified.
 */
function symlinkDiff(cwd: string, path: string): string {
  const before = gitShowBytes(cwd, "HEAD", path);
  if (!before) return "";
  try {
    lstatSync(join(cwd, path));
  } catch {
    // Nothing at that name any more. Whether this call is raced does not matter: the diff it
    // produces is HEAD's own blob, so no working-tree data can reach the response either way.
    return deletedDiff(path, "120000", before);
  }
  return "";
}

function deletedDiff(path: string, headMode: string, before: Buffer): string {
  const start = `diff --git a/${path} b/${path}\ndeleted file mode ${headMode}`;
  const body = diffBody(before, Buffer.alloc(0));
  if (!body) return start; // an empty file that was deleted: a header and no hunks
  if (body.binary)
    return `${start}\nBinary files a/${path} and /dev/null differ`;
  return `${start}\n--- a/${path}\n+++ /dev/null\n${body.body}`;
}

/**
 * The hunks git produces for two blobs we already hold, or null when they are identical.
 *
 * The pair is written into a fresh `mkdtemp` directory (0700, unpredictable name) and diffed
 * with `--no-index`, so the only paths reaching git are ones we just created and nobody else
 * can name. That is what makes reusing `--no-index` safe here after it was removed from the
 * untracked branch: there, the path came from the caller and pointed into a tree an agent can
 * write; here it does not.
 *
 * git's own headers are stripped and rebuilt by the callers against the real path — the temp
 * names must never reach the response.
 */
function diffBody(
  before: Buffer,
  after: Buffer,
): { body: string; binary: boolean } | null {
  // Everything here is failure-tolerant on purpose. This is the only part of the module that
  // *writes* to disk, and the route calls `gitFileDiff` with no try/catch of its own — so a
  // full disk or an unwritable TMPDIR would turn a diff request into an HTML 500 that the
  // modal cannot read. Every other helper in this file already swallows its failures into an
  // empty result; this keeps that contract.
  let dir: string | undefined;
  try {
    dir = mkdtempSync(join(tmpdir(), "platform-diff-"));
    const a = join(dir, "before");
    const b = join(dir, "after");
    writeFileSync(a, before, { mode: 0o600 });
    writeFileSync(b, after, { mode: 0o600 });

    let out: string;
    try {
      out = execFileSync(
        "git",
        ["diff", ...NO_CUSTOM_DIFF_DRIVERS, "--no-index", "--", a, b],
        {
          cwd: dir,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
          maxBuffer: 16 * 1024 * 1024,
        },
      );
    } catch (e) {
      // `--no-index` exits 1 whenever the two files differ, which is the normal case here.
      // The diff itself is on stdout; treating a non-zero exit as failure would return an
      // empty diff for every file that actually changed.
      out = (e as { stdout?: string }).stdout ?? "";
    }

    if (!out.trim()) return null;
    const lines = out.split("\n");
    const at = lines.findIndex((l) => l.startsWith("+++ "));
    // No `+++` header means git classified the pair as binary and declined to render it.
    if (at === -1) return { body: "", binary: true };
    return { body: lines.slice(at + 1).join("\n").replace(/\n+$/, ""), binary: false };
  } catch {
    return null; // no temp dir, no space, no git — no diff, not a 500
  } finally {
    if (dir) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // A temp dir we cannot remove is not a reason to fail the request.
      }
    }
  }
}

/** The only statement a gitlink diff's body may make: which commit the submodule points at.
 *  The leading `-`/`+`/space is required — a bare "Subproject commit" line is not something a
 *  diff body contains. */
const SUBPROJECT_LINE = /^[-+ ]Subproject commit [0-9a-f]{7,64}(-dirty)?$/;

/**
 * Is this really a submodule diff — one that cannot be carrying file content?
 *
 * Checked **positionally, on the body**, and both halves of that are the result of getting it
 * wrong twice:
 * - *Prefix patterns don't work.* The first version allowlisted header shapes by prefix, and
 *   the security audit broke it: git prefixes each added line with one literal `+`, so a
 *   planted file whose lines begin with `++ ` renders as `+++ <text>` and passes as the
 *   `+++ b/…` header. Content came out of `gitFileDiff` dressed as a diff — a spoofing
 *   primitive aimed at whoever reads an approval gate.
 * - *Exact-matching the header against the path doesn't work either.* git appends a trailing
 *   **tab** to `--- a/<path>` when the path contains a space, and C-quotes the whole path when
 *   it isn't ASCII (`diff --git "a/\303\274ni sub" …`). Matching `--- a/${path}` therefore
 *   rejected perfectly ordinary submodules and rendered them blank — the exact regression this
 *   file has already shipped once, when refusing non-regular paths hid every submodule.
 *
 * So the header block is left alone (git builds it from the path and some object ids — there
 * is no file content in it) and everything from the first hunk header onward must be a
 * `Subproject commit` line. A typechange — the case where the worktree entry stopped being a
 * submodule and git renders the replacement file's content — puts a second `diff --git` block
 * after that first `@@`, so it fails here no matter what the replacement file contains.
 */
function isSubmoduleDiff(out: string): boolean {
  const lines = out.split("\n");
  // Content lines are prefixed by git, so a planted `@@ …` line arrives as `+@@ …` and cannot
  // be mistaken for the real hunk header.
  const at = lines.findIndex((l) => l.startsWith("@@ "));
  if (at === -1) return false; // no hunk at all: not something to render as a submodule diff
  const body = lines.slice(at + 1);
  return body.length > 0 && body.every((l) => SUBPROJECT_LINE.test(l));
}

/**
 * A submodule keeps the real `git diff`, because its output is only ever a pair of commit
 * ids — there is no file content for git to read out of the tree, and reimplementing the
 * "Subproject commit" rendering (including `-dirty` and uninitialized submodules) would be
 * strictly worse than letting git say it.
 *
 * The catch is that HEAD saying "gitlink" does not bind the *working tree* to still be one.
 * Replace the submodule directory with a hard link to an outside file and git renders a
 * typechange: gitlink deleted, regular file added — with that file's content. `isSubmoduleDiff`
 * is what refuses that.
 *
 * **`--submodule=short` is as load-bearing as `--no-ext-diff --no-textconv` above, and for the
 * same reason: a repository decides what "diff" means.** `diff.submodule` is ordinary,
 * documented config living in `.git/config` — untracked, shared across every linked worktree,
 * and writable by a task's Bash tool. It changes the output shape entirely:
 * - `= log` prints `Submodule sub aaa..bbb:` with commit subjects and **no `@@` line at all**,
 *   so a real pointer change rendered blank. Found in re-review; that is the same
 *   "everything looks fine, nothing renders" failure this file has now shipped twice.
 * - `= diff` prints the **contents of the files inside the submodule** — content-bearing
 *   output produced entirely by config, no planted file needed.
 * Pinning the format means neither depends on what a repo happens to be configured to do.
 */
function submoduleDiff(cwd: string, path: string): string {
  const out = git(cwd, [
    "--literal-pathspecs",
    "diff",
    ...NO_CUSTOM_DIFF_DRIVERS,
    "--submodule=short",
    "HEAD",
    "--",
    path,
  ]);
  return out && isSubmoduleDiff(out) ? out : "";
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
  return gitShowBytes(cwd, ref, path)?.toString("utf8") ?? null;
}

/**
 * The same read, undecoded — what the diff path needs, since turning a latin-1 or binary blob
 * into a string first would substitute the bytes it cannot map and then diff a file that
 * never existed.
 *
 * `--no-textconv` is insurance, not a fix for anything observed: `git show <rev>:<path>`
 * dumps the raw blob today (verified), but every other `git diff` in this file carries the
 * flag for a reason — a repo can name a shell command to "render" a file — and this content
 * is shown to a user, so it should not be the one call that depends on git's default.
 */
function gitShowBytes(cwd: string, ref: string, path: string): Buffer | null {
  if (!ref || ref.startsWith("-")) return null;
  try {
    return execFileSync("git", ["show", "--no-textconv", `${ref}:${path}`], {
      cwd,
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
