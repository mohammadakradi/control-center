/**
 * Git worktree isolation for parallel task runs.
 *
 * A task that opts into running while its project is busy gets its own working tree under
 * `data/worktrees/<taskId>` on a task-named branch, so two sessions never share a git index,
 * a HEAD, or a build directory. The worktree is disposable — commits live on the branch,
 * which survives cleanup — but an *uncommitted* tree is work the agent hasn't shipped yet,
 * so nothing here ever removes a dirty tree (`git worktree remove` without `--force` is the
 * built-in "only if nothing would be lost" check, and we rely on exactly that).
 *
 * **This is isolation of the working state, not a security boundary, and the difference is
 * worth stating plainly because an earlier version of this comment did not.** `git worktree add`
 * gives each linked worktree its own HEAD, index and files; it does **not** give it its own
 * `.git/config`, `.git/hooks/` or `.git/info/attributes`. Those are one shared copy, reached from
 * the main checkout and from every task's worktree alike, and none of them is tracked — so a plant
 * shows up in no `git status`, no diff, no review and no clone. An agent has ordinary write access
 * to all three from inside the tree it was given.
 *
 * What that means concretely: a `post-checkout` hook written from one task's worktree fires in
 * *every* other context, and `ensureTaskWorktree` below runs `git worktree add` on each parallel
 * dispatch, so it re-arms itself. The platform's own git calls no longer execute any of it (see
 * `git()` and `NO_HOOKS` in lib/git.ts), which is what stops a worktree from becoming a backdoor
 * into the server process. Two things it does not stop, both deliberate:
 * - an agent's own `git` from its Bash tool still honors hooks and config, as a developer tool
 *   must;
 * - `POST /api/projects/[id]/git` can still be asked to run checkout/pull, because that route has
 *   no auth — the same open design question as the unauthenticated backlog routes, and a bigger
 *   change than this one.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { DATA_DIR } from "../lib/config";
import { NO_HOOKS, gitEnv } from "../lib/git";

export const WORKTREES_DIR = resolve(DATA_DIR, "worktrees");

/**
 * Hard ceiling on worktree directories, enforced at creation. Every worktree is a full
 * checkout on disk, and the dispatch route is reachable unauthenticated over loopback —
 * without a cap, a loop of parallel-flagged dispatches is a disk-fill primitive (the
 * security audit's blocking finding). Reuse and recreate of an existing dir don't count
 * against it; the refusal is loud (the task fails with the reason), never a silent drop.
 */
export const MAX_WORKTREES = 16;

export type Worktree = { dir: string; branch: string };

/** How a task launch should proceed given the project's state. Pure and extracted so the
 *  queue-vs-isolate switch in session-manager is testable — it decides whether two agent
 *  sessions ever share one checkout, which must never happen by accident. */
export type LaunchMode = "run" | "queue" | "isolate";
export function launchMode(opts: {
  /** Another session is live in the project's main checkout right now. */
  busy: boolean;
  /** The task's parallel opt-in (tasks.parallel). */
  parallel: boolean;
  /** The task's recorded isolated working dir (tasks.workdir) — set means it ran isolated
   *  before, and its work lives there / on its branch, so it must go back regardless of
   *  whether the checkout happens to be free now. */
  workdir: string | null;
  isGit: boolean;
  isWorkspace: boolean;
}): LaunchMode {
  const canIsolate = opts.isGit && !opts.isWorkspace;
  if (canIsolate && (Boolean(opts.workdir) || (opts.busy && opts.parallel)))
    return "isolate";
  return opts.busy ? "queue" : "run";
}

/**
 * Run git, surfacing stderr in the thrown error — "exit code 128" tells nobody anything,
 * while "fatal: 'task/x' is already used by worktree …" is actionable.
 *
 * Hook and system-config neutralization matches lib/git.ts, and this is the entry point that
 * most needs it: `worktree add` runs `post-checkout` (measured, alongside `post-index-change`
 * and `reference-transaction`), and it is issued on every parallel dispatch against the
 * *project's* shared `.git` — so without this a single planted hook re-executes in the runner
 * process for as long as tasks keep being dispatched.
 *
 * `NO_HOOKS`/`gitEnv` are **imported from lib/git.ts rather than repeated here** — an earlier
 * version inlined the same two lines and a reviewer rightly called it a second place to keep in
 * sync by hand. Sharing them also means the env half is covered by lib/git.ts's specs, which is
 * where the subtle parts live (why `/dev/null` and not an empty string or a temp directory, and
 * why `process.env` is spread at call time rather than snapshotted). Read that comment before
 * changing either.
 */
function git(cwd: string, args: string[]): string {
  try {
    return execFileSync("git", [...NO_HOOKS, ...args], {
      cwd,
      encoding: "utf8",
      env: gitEnv(),
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 16 * 1024 * 1024,
    }).trim();
  } catch (e) {
    const err = e as { stderr?: string; message?: string };
    throw new Error(err.stderr?.trim() || err.message || "git command failed");
  }
}

/** The branch a task's worktree lives on. Derived from the task id, so it's deterministic
 *  across create → cleanup → continue; sanitized because it becomes a git ref. */
export function taskBranch(taskId: string): string {
  const suffix = taskId.replace(/^task_/, "").replace(/[^A-Za-z0-9._-]/g, "");
  return `task/${suffix || "unnamed"}`;
}

/** Where a task's worktree lives. The id is server-generated (`newId`), but this path is
 *  handed to `rm -rf`-shaped cleanup, so refuse anything that could climb out anyway. */
export function taskWorktreeDir(taskId: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(taskId) || taskId === "." || taskId === "..") {
    throw new Error(`invalid task id for a worktree path: ${taskId}`);
  }
  return resolve(WORKTREES_DIR, taskId);
}

function branchExists(projectPath: string, branch: string): boolean {
  try {
    git(projectPath, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]);
    return true;
  } catch {
    return false;
  }
}

/** Is `dir` a functioning git worktree (not just a leftover directory)? The toplevel must
 *  be the dir itself: in a dev checkout `data/worktrees/` sits *inside* the app's own repo,
 *  so a mere "is inside a work tree" check would claim any leftover junk dir as live. */
function isLiveWorktree(dir: string): boolean {
  if (!existsSync(dir)) return false;
  try {
    const top = git(dir, ["rev-parse", "--show-toplevel"]);
    return realpathSync(top) === realpathSync(dir);
  } catch {
    return false;
  }
}

/**
 * Make sure the task's worktree exists and return it. Handles every lifecycle state with
 * one call so the fresh-dispatch and continue-after-cleanup paths can't drift:
 * - the worktree is already there and working → reuse it (whatever branch it's on — the
 *   agent may have created its own feature branch inside);
 * - the tree is gone but a branch survived (normal after a clean `done`) → check it out
 *   into a fresh worktree, uncommitted state permanently gone but commits intact. The
 *   branch **stored on the task row** (`opts.branch` — captured from the tree at cleanup)
 *   wins over the derived `task/<id>` birth name: the agent's workflow switches branches,
 *   and reattaching to the birth name would resume without the actual work (found by
 *   review, with a repro);
 * - first run → create the `task/<id>` branch at the project's current HEAD.
 * Throws with git's own stderr when the repo refuses (e.g. the branch is checked out in the
 * main tree) — the caller fails the task with that message rather than guessing.
 */
export function ensureTaskWorktree(
  projectPath: string,
  taskId: string,
  opts: { branch?: string | null; maxWorktrees?: number } = {},
): Worktree {
  const dir = taskWorktreeDir(taskId);
  const birthBranch = taskBranch(taskId);
  if (isLiveWorktree(dir)) {
    return { dir, branch: worktreeBranch(dir) ?? birthBranch };
  }
  if (existsSync(dir)) {
    // A leftover that git no longer recognises (crash mid-create, repo moved). It may still
    // hold un-pushed work, so refuse rather than silently deleting it.
    throw new Error(
      `worktree directory ${dir} exists but is not a working git worktree — move it aside and retry`,
    );
  }
  mkdirSync(WORKTREES_DIR, { recursive: true });
  // The disk guard — only the create path pays it (reuse adds nothing to disk).
  const max = opts.maxWorktrees ?? MAX_WORKTREES;
  const existing = readdirSync(WORKTREES_DIR).length;
  if (existing >= max) {
    throw new Error(
      `refusing to create another isolated worktree: ${existing} already exist under ` +
        `${WORKTREES_DIR} (cap ${max}). Each one is a full checkout — remove finished ` +
        `tasks' worktrees (or continue them to done) first.`,
    );
  }
  // A previous worktree at this path may have been removed without `worktree remove`
  // (crash, manual rm) — prune the stale bookkeeping or `add` refuses the path.
  git(projectPath, ["worktree", "prune"]);
  // Prefer the branch the task actually ended on. A stored value that isn't a real local
  // branch (never set, deleted, or the literal "HEAD" from an old detached tree) falls
  // back to the birth name; a leading dash is refused as a ref, same rule as gitShowFile.
  const stored = opts.branch && !opts.branch.startsWith("-") ? opts.branch : null;
  const reattach =
    stored && branchExists(projectPath, stored)
      ? stored
      : branchExists(projectPath, birthBranch)
        ? birthBranch
        : null;
  if (reattach) {
    git(projectPath, ["worktree", "add", dir, reattach]);
    return { dir, branch: reattach };
  }
  git(projectPath, ["worktree", "add", "-b", birthBranch, dir]);
  return { dir, branch: birthBranch };
}

/** The branch currently checked out in a worktree, or null if it can't be read — including
 *  a detached HEAD, where `--abbrev-ref` prints the literal "HEAD". Storing that would make
 *  the file view's later `git show HEAD:…` silently read the *project checkout's* HEAD, a
 *  different tree entirely (found by review). The agent may have switched off the task
 *  branch mid-run (its workflow creates feature branches), and the task row should record
 *  where the commits actually are. */
export function worktreeBranch(dir: string): string | null {
  try {
    const branch = git(dir, ["rev-parse", "--abbrev-ref", "HEAD"]);
    return !branch || branch === "HEAD" ? null : branch;
  } catch {
    return null;
  }
}

/**
 * Remove the worktree if — and only if — nothing would be lost: `git worktree remove`
 * without `--force` refuses a dirty or locked tree, and that refusal is the feature.
 * Returns whether it was removed.
 */
export function removeWorktreeIfClean(projectPath: string, dir: string): boolean {
  try {
    git(projectPath, ["worktree", "remove", dir]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Delete a directory under `data/worktrees/` that no longer has a task row — with no row
 * there is no project path, so git can't do it for us. Bounded hard to WORKTREES_DIR: this
 * is the only `rm -rf`-shaped call in the runner, and it must never follow a crafted name
 * out of the sandbox. (`rmSync` on a symlink removes the link itself, never the target.)
 */
export function removeOrphanWorktreeDir(name: string): void {
  const dir = resolve(WORKTREES_DIR, name);
  if (dir === WORKTREES_DIR || resolve(dir, "..") !== WORKTREES_DIR) {
    throw new Error(`refusing to remove outside ${WORKTREES_DIR}: ${name}`);
  }
  rmSync(dir, { recursive: true, force: true });
}
