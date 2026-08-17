/**
 * Reading a file a project tree *claims* to contain.
 *
 * The file and diff routes take a caller-supplied relative path and read it under a root the
 * user registered (`project.path`, a workspace member, or a task's worktree). Their original
 * guard — reject a leading `/` or a `..` segment, then `resolve()` — is purely lexical, so it
 * proves nothing about what the path lands on: a tree can contain a symlink, and a task
 * worktree is populated by an agent with Bash. Containment has to be established against the
 * *real* path, not the spelling of it.
 *
 * Three escapes exist and no single check catches them all — measured, not assumed:
 *
 *   | planted in the tree                     | O_NOFOLLOW | realpath containment |
 *   | `docs.md` -> /etc/passwd                | refuses    | refuses              |
 *   | `link/` -> /secrets, read `link/id_rsa` | **opens**  | refuses              |
 *   | `docs.md` hard-linked to /secrets/key   | opens      | **contained**        |
 *
 * `O_NOFOLLOW` only refuses a symlink as the *final* component, so a symlinked intermediate
 * directory walks straight through it; and a hard link has no target to resolve, so realpath
 * reports it as living exactly where it appears. Hence both: realpath for containment,
 * `nlink === 1` for the link count realpath cannot see.
 *
 * Unlike `readSpecFile` (lib/backlog.ts), which refuses symlinks outright, a symlink that
 * stays *inside* the root is allowed here — `README.md -> docs/README.md` is an ordinary
 * thing for a repo to contain, and this is a file viewer. The stricter rule is right where it
 * is: a `.pm/tasks/` spec becomes the instruction text of an autonomous run, so a link of any
 * kind is suspicious there. Escaping the root is what both agree to refuse.
 */
import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readSync,
  realpathSync,
  statSync,
} from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

/**
 * Is `child` strictly below `parent`? Both must already be real paths — on macOS `/tmp` is
 * itself a symlink to `/private/tmp`, so comparing a raw string against a realpath'd one
 * rejects paths that genuinely are inside.
 *
 * Exported for `lib/update-run.ts`, which reads two files under `~/.control-center` and needs
 * the same containment question answered. It can't reuse `readBytesInside` — that allows a
 * symlink which stays inside the root, and inside *that* root are `.env` and the token vault —
 * so it pairs this with `isSameSoleFile` and its own `O_NOFOLLOW`. One definition of "below",
 * rather than a second opinion.
 */
export function isInside(child: string, parent: string): boolean {
  const rel = relative(parent, child);
  // "" means the root itself, which is a directory and never a file to serve.
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

/**
 * Is this usable as an in-repo relative path at all? The cheap lexical gate the routes ran
 * before, kept as the first step so an obviously bad path costs no syscalls — and exported so
 * the two routes share one definition instead of a copy each.
 *
 * Control characters are refused the way the backlog scan refuses them: such a path is never
 * a real file someone wants to read, and it travels into git arguments and log lines.
 */
export function isUsableRelPath(rel: string | null | undefined): rel is string {
  if (!rel || rel.startsWith("/")) return false;
  if (/[\x00-\x1f\x7f]/.test(rel)) return false;
  return !rel.split("/").includes("..");
}

/** The subset of `Stats` the identity check needs — so it can be tested with fabricated
 *  values instead of only through a race that is far too narrow to sample reliably. */
export type FileIdentity = { dev: number; ino: number; nlink: number };

/**
 * Is `opened` (from `fstat` on the handle) the same file as `found` (from `stat` on the
 * re-resolved contained path), *and* still the only name for it?
 *
 * This two-line comparison is what actually closes the check→open race, so it is worth being
 * precise about each clause:
 * - `dev`+`ino` identify the file. If they match, the inode we are holding is the one now
 *   sitting at a path we just proved is inside the root.
 * - `nlink === 1` on the **second** stat, not only the first. Without it: swap a directory so
 *   the open lands on an outside file (link count 1 at that moment), then restore the
 *   directory and hard-link that same outside file to the contained path. `dev`/`ino` would
 *   match and the outside content would be served. A second name appearing at all is the
 *   tell — and a hard link is the one escape `realpath` structurally cannot see.
 */
export function isSameSoleFile(
  opened: FileIdentity,
  found: FileIdentity,
): boolean {
  return (
    opened.dev === found.dev &&
    opened.ino === found.ino &&
    opened.nlink === 1 &&
    found.nlink === 1
  );
}

type Resolved = { real: string } | { fail: "escape" | "missing" };

/**
 * Resolve `rel` under `root` to a real path proven to be inside it.
 *
 * "missing" is kept distinct from "escape" for the *git* callers, where the difference is
 * real: a path with nothing on disk is safe to hand to git, which then reads from the object
 * store rather than the filesystem, whereas one resolving outside the root is not.
 *
 * The file route deliberately collapses the two into a single 404. Answering differently
 * turned one planted symlink into an existence oracle for any absolute path on the host —
 * point it somewhere, read the status code, learn whether that path exists. Same reasoning as
 * `lib/task-access`, where "not yours" and "doesn't exist" are made indistinguishable.
 */
function resolveReal(root: string, rel: string): Resolved {
  if (!isUsableRelPath(rel)) return { fail: "escape" };
  let realRoot: string;
  try {
    realRoot = realpathSync(root);
  } catch {
    return { fail: "missing" }; // the root itself is gone (e.g. a cleaned-up worktree)
  }
  let real: string;
  try {
    real = realpathSync(resolve(realRoot, rel));
  } catch {
    return { fail: "missing" };
  }
  return isInside(real, realRoot) ? { real } : { fail: "escape" };
}

type SafeFail = { ok: false; reason: "invalid" | "too-large" | "not-found" };

export type SafeRead = { ok: true; content: string } | SafeFail;

/**
 * The same read, before anything decodes it. `bytes` matters where the content is handed to
 * something other than a UTF-8 consumer — the diff path writes it back out, and decoding a
 * latin-1 or binary file to a string first would replace bytes it cannot map and diff a file
 * that never existed. `mode` comes off the **handle**, not a second `stat` of the path, so it
 * carries the same guarantee as the content: it describes the file that was actually read.
 */
export type SafeBytes = { ok: true; bytes: Buffer; mode: number } | SafeFail;

/**
 * Read a text file that must live inside `root`.
 *
 * Everything after the open is checked on the **handle**, not the path: classify a path and
 * then open it by name and it can be a different file by the time you do — and these routes
 * can be retried for free, so an attacker racing the window pays nothing per attempt. The
 * read is bounded by the size `fstat` reported rather than running to EOF, so a file being
 * appended to during the read can't outgrow the cap it was just checked against.
 *
 * The check→open race is closed by **identifying the inode, not re-resolving the path**.
 * `realpath` then `open` is check-then-use: swap a *directory* along the path for a symlink
 * in between and the open follows it, since `O_NOFOLLOW` only guards the last component.
 * (Not theoretical — a review reproduced it at roughly 2 leaks per 640k attempts here, and
 * far more easily on the git path, with nothing but a shell loop.) So after opening, this
 * re-resolves the path and requires the file currently at that contained location to be the
 * very inode the handle holds (`dev` + `ino`). Together with `nlink === 1` that is airtight:
 * the open file has exactly one name, and that name was just observed inside the root, so
 * the handle cannot be pointing at anything outside it. Re-resolving alone would not do —
 * an attacker can restore the directory and pass a second path check.
 */
export function readBytesInside(
  root: string,
  rel: string,
  maxBytes: number,
): SafeBytes {
  const resolved = resolveReal(root, rel);
  if ("fail" in resolved)
    return {
      ok: false,
      reason: resolved.fail === "escape" ? "invalid" : "not-found",
    };

  let fd: number | undefined;
  try {
    // O_NOFOLLOW is belt and braces — the path is symlink-free by construction, so it only
    // matters if the final component was swapped for a link between resolving and opening.
    //
    // O_NONBLOCK is not optional. `open` on a FIFO blocks until a writer arrives, and that
    // happens *before* fstat gets to classify it — so without this flag, a named pipe left
    // in a project tree hangs the request forever and no amount of checking afterwards
    // helps. Regular files ignore the flag. (Measured: a plain O_RDONLY open on a FIFO does
    // not return, which is what the FIFO spec below is guarding.)
    fd = openSync(
      resolved.real,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    const st = fstatSync(fd);
    // Non-regular files are refused rather than read; `nlink` is the hard-link check that
    // realpath structurally cannot make.
    if (!st.isFile() || st.nlink !== 1) return { ok: false, reason: "invalid" };
    if (st.size > maxBytes) return { ok: false, reason: "too-large" };

    // The race check. Re-resolve, and demand that the file sitting at that contained path
    // *is* the inode we are holding. An attacker who swapped a directory for a symlink
    // during the open either still has it in place (containment fails here) or has put the
    // real directory back (the inode at the contained path is then not the one we opened).
    //
    // The cost: a file legitimately replaced by atomic rename inside this same window reads
    // as not-found rather than serving either version. That needs the swap to land in a gap
    // of a few syscalls, and refusing is the safe direction, so it is worth the guarantee.
    const after = resolveReal(root, rel);
    if ("fail" in after) return { ok: false, reason: "invalid" };
    if (!isSameSoleFile(st, statSync(after.real)))
      return { ok: false, reason: "invalid" };

    const buf = Buffer.alloc(st.size);
    let read = 0;
    while (read < buf.length) {
      const n = readSync(fd, buf, read, buf.length - read, read);
      if (n === 0) break;
      read += n;
    }
    return { ok: true, bytes: buf.subarray(0, read), mode: st.mode };
  } catch {
    return { ok: false, reason: "not-found" };
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/** `readBytesInside` decoded as UTF-8 — what every caller that renders text wants. */
export function readFileInside(
  root: string,
  rel: string,
  maxBytes: number,
): SafeRead {
  const read = readBytesInside(root, rel, maxBytes);
  return read.ok ? { ok: true, content: read.bytes.toString("utf8") } : read;
}

/**
 * Would reading `rel` *from disk* under `root` escape it? For the git callers, which hand a
 * path to a subprocess and so can't hold a file descriptor over the check.
 *
 * A path with nothing on disk answers **false**: git reads it from the object store (`git
 * diff HEAD -- deleted.md` is a legitimate diff of a file that no longer exists), and there
 * is no filesystem read to escape through.
 *
 * A **directory** that is genuinely inside the root answers false. It has to: a git submodule
 * is a directory, and `git diff HEAD -- <submodule>` producing its "Subproject commit" lines
 * is an ordinary diff that an earlier version of this refused, silently returning no diff for
 * every submodule in every project. Containment is the question being asked here; "is it a
 * plain file" belongs to `readFileInside`, which is what actually reads bytes.
 *
 * Anything else that exists but isn't a single-linked regular file — FIFO, socket, device,
 * hard link — answers true.
 */
export function escapesOnDisk(root: string, rel: string): boolean {
  const resolved = resolveReal(root, rel);
  if ("fail" in resolved) return resolved.fail === "escape";
  try {
    // Already realpath'd, so there is no trailing symlink for `stat` to follow.
    const st = statSync(resolved.real);
    if (st.isDirectory()) return false;
    return !st.isFile() || st.nlink !== 1;
  } catch {
    return true;
  }
}
