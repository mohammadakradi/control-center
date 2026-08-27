/**
 * Where a task's work actually lives on disk.
 *
 * A run executes in one of two places: the project checkout, or — when `parallel` isolation
 * kicked in — its own git worktree under `data/worktrees/` (`runner/worktree.ts`). Anything that
 * wants to show *this task's* files or changes has to resolve that first, and the resolution has
 * more states than it looks: the worktree is removed after a clean `done`, so a finished parallel
 * task has commits on a branch and no tree at all.
 *
 * Kept out of the route (and out of `lib/git.ts`, which is deliberately schema-free) so the states
 * are unit-testable — `pnpm test` covers `lib/`, never `app/api/`. Same move as `launchMode` in
 * `runner/worktree.ts` and `orderSkills` in `lib/ui.ts`.
 *
 * **This function spawns nothing.** It answers from the database row plus two `existsSync` calls,
 * so it costs no subprocess and cannot be made to hang; the caller then hands `cwd` to
 * `lib/git.ts`, where every hardening flag (`repoOpts`, `gitEnv`, `NO_HOOKS`, the timeouts) lives.
 */
import { existsSync, lstatSync, openSync, readSync, closeSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import type { Project, Task } from "./db/schema";

export type TaskWorkRoot =
  /** The run happened in the project checkout — its changes are that tree's changes. */
  | { kind: "checkout"; cwd: string }
  /** The run was isolated and its worktree is still on disk. */
  | { kind: "worktree"; cwd: string }
  /**
   * The run was isolated and its worktree is gone (the usual state after a clean `done`).
   * There is no working tree to read; `branch` is where the committed work is, or null when
   * the tree was on a detached HEAD at cleanup (`worktreeBranch` returns null for that).
   */
  | { kind: "worktree-removed"; branch: string | null }
  /** Nothing meaningful to resolve. */
  | { kind: "unavailable"; reason: "not-git" | "workspace" };

/**
 * Resolve the working root for a task.
 *
 * Note what is deliberately *not* here: no fallback from a missing worktree to the project
 * checkout. The checkout's uncommitted state belongs to whatever is running there now, so
 * presenting it as a finished isolated run's work would attribute someone else's edits to this
 * task — the same reasoning the diff route's own comment gives for answering an empty diff.
 */
export function resolveTaskWorkRoot(project: Project, task: Task): TaskWorkRoot {
  // A workspace root is a folder of separate repos; `gitChanges` on it means nothing, and
  // per-member source control already lives on the project page. Dispatch refuses `parallel`
  // for a workspace, so a workspace task never has a worktree to resolve either.
  if (project.isWorkspace) return { kind: "unavailable", reason: "workspace" };
  if (!project.isGit) return { kind: "unavailable", reason: "not-git" };

  if (task.workdir) {
    return isTaskWorktree(task.workdir, project.path)
      ? { kind: "worktree", cwd: task.workdir }
      : { kind: "worktree-removed", branch: task.branch };
  }
  return { kind: "checkout", cwd: project.path };
}

/** A `.git` pointer file is a single short line; anything larger isn't one. */
const GITDIR_FILE_CAP = 4096;

/**
 * Is this directory the linked git worktree of *this project* — as opposed to a leftover
 * directory that merely sits inside some repo, or one pointed at a different repo entirely?
 *
 * The question matters because worktrees live under `data/worktrees/`, which **in a dev checkout
 * is inside the platform's own repository** (`.swe/notes/log-task-changes.md`, 2026-08-16). For a directory git no
 * longer recognises, git walks *up* and finds the enclosing repo — so a weak test here renders the
 * platform checkout's entire change set under the task's name.
 *
 * **`existsSync(dir/.git)` is not the test, and the security audit reproduced why** (no race
 * needed): that path is also true for an **empty directory named `.git`**, and for a symlink to a
 * directory that isn't a git dir — in both cases git walks straight past it into the enclosing
 * repo. One `mv .git .git.real && mkdir .git` from inside its own worktree is all an agent needs.
 * So each clause below answers a bypass that was demonstrated, not a hypothetical:
 * - **regular file only** (`lstat`, so a symlink is judged as itself): a real linked worktree's
 *   `.git` *is* a regular file holding `gitdir:`. That refuses the empty-directory and symlink
 *   forms outright. It also means nothing non-regular is ever opened — a FIFO planted here would
 *   otherwise block the read, and with it the request (the `O_NONBLOCK` lesson in lib/safe-read.ts).
 * - **the pointer must resolve to something that exists** — a dangling `gitdir:` makes git fail,
 *   which is safe, but answering "worktree" for it would still be a wrong claim.
 * - **the gitdir must live under the project's own `.git`**, which is where git puts a linked
 *   worktree's admin data (`<repo>/.git/worktrees/<name>`). This is the clause that bounds a
 *   *retargeted* pointer — the documented "`.git` file redirects a whole repo" class — at the one
 *   place in the codebase holding both `project.path` and `task.workdir`. Skipped, deliberately,
 *   when the project itself is a linked worktree (its `.git` is a file, so its worktrees' admin
 *   data lives under the *main* repo instead): refusing those would silently show "no changes" for
 *   a legitimate run, and a false negative for real users is worse than a bound that already holds
 *   everywhere else. That case is the pre-existing redirect class, unchanged in reachability.
 *
 * Still not a race-free guarantee: `.git` can be removed after this check and before git's own
 * discovery in the child process, which the audit reproduced across the spawn window. Closing that
 * needs `GIT_CEILING_DIRECTORIES` on every invocation in `lib/git.ts` (verified by the audit to
 * work and to leave legitimate repos byte-identical) — a change to shared git hardening that this
 * task consumes unchanged, so it is filed rather than smuggled in here. What remains after the
 * clauses above is a spawn-window race that leaks file *names* and line counts, never content.
 *
 * No subprocess: this runs in the web process on request, and a `lstat` + one bounded read cannot
 * be made to hang by a repository.
 */
function isTaskWorktree(dir: string, projectPath: string): boolean {
  const dotGit = join(resolve(dir), ".git");
  const st = lstatSafe(dotGit);
  if (!st?.isFile() || st.size > GITDIR_FILE_CAP) return false;

  const pointer = readCapped(dotGit, GITDIR_FILE_CAP);
  const target = /^gitdir:\s*(.+?)\s*$/m.exec(pointer ?? "")?.[1];
  if (!target) return false;
  // A `gitdir:` may be relative, and it is relative to the worktree directory.
  const gitdir = resolve(dirname(dotGit), target);
  if (!existsSync(gitdir)) return false;

  const projectGit = join(resolve(projectPath), ".git");
  const pst = lstatSafe(projectGit);
  if (!pst) return false;
  // Project is itself a linked worktree — containment isn't decidable from here (see the note).
  if (!pst.isDirectory()) return true;
  return isInside(projectGit, gitdir);
}

function lstatSafe(path: string) {
  try {
    return lstatSync(path);
  } catch {
    return null;
  }
}

/** Read at most `cap` bytes, without following a link or blocking on a non-regular file — the
 *  handle is already known to be a small regular file, so this is a bounded read, not a `readFile`. */
function readCapped(path: string, cap: number): string | null {
  let fd: number | null = null;
  try {
    fd = openSync(path, "r");
    const buf = Buffer.alloc(cap);
    const read = readSync(fd, buf, 0, cap, 0);
    return buf.subarray(0, read).toString("utf8");
  } catch {
    return null;
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

/** Is `child` the same path as `parent`, or beneath it? Compared with a separator so that
 *  `/repo/.gitfoo` is not read as living inside `/repo/.git`. */
function isInside(parent: string, child: string): boolean {
  return child === parent || child.startsWith(parent + sep);
}
