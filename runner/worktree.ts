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
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DATA_DIR } from "../lib/config";
import {
  gitMerge,
  gitEnv,
  LOCAL_GIT_TIMEOUT,
  repoOpts,
  type MergeResult,
} from "../lib/git";

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
  /** The task belongs to a feature (tasks.featureId). A feature-linked parallel run always
   *  isolates, busy or not: the runner bases its worktree on the feature branch and merges
   *  back into it on done, and the first of N siblings landing in the shared checkout would
   *  neither of those things. Meaningless without `parallel` — a non-parallel feature run
   *  stays a plain checkout run, one the platform can't system-merge (the agent owns git
   *  there; see the dispatch preamble in session-manager). */
  feature: boolean;
}): LaunchMode {
  const canIsolate = opts.isGit && !opts.isWorkspace;
  if (
    canIsolate &&
    (Boolean(opts.workdir) || (opts.parallel && (opts.busy || opts.feature)))
  )
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
 * `repoOpts`/`gitEnv` are **imported from lib/git.ts rather than repeated here** — an earlier
 * version inlined just `NO_HOOKS`+`gitEnv`, and a security audit of the feature-branch
 * merge-back work found the gap that leaves: `-c core.fsmonitor=` was missing, and `git
 * worktree add` (unlike `branch` or `worktree prune`) *does* invoke a planted `core.fsmonitor`
 * — verified live, and the exploit path is unattended (a feature-linked task reaching `done`
 * runs `worktree add` against the project's shared checkout with no further action). Using the
 * *same* `repoOpts(cwd)` this file's mutating calls now share with lib/git.ts's is what makes
 * this a single pin list to keep in sync rather than two — read that function's comment before
 * changing either.
 */
function git(cwd: string, args: string[]): string {
  try {
    return execFileSync("git", [...repoOpts(cwd), ...args], {
      cwd,
      encoding: "utf8",
      env: gitEnv(),
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 16 * 1024 * 1024,
      // A repo can make a git command never return — a `filter.<driver>.smudge` bound via
      // untracked `.git/info/attributes` runs on the `worktree add` this file issues, and
      // `execFileSync` is synchronous, so a blocking filter wedges the runner's event loop
      // (which also serves the SSE streams) until someone restarts it. The boot sweep runs
      // this before the server even listens. Same 30s bound as lib/git.ts's own `git()`.
      timeout: LOCAL_GIT_TIMEOUT,
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
 * - first run → create the `task/<id>` branch at the project's current HEAD, or at
 *   `opts.baseRef` when the task is feature-linked — the feature branch, so the task's work
 *   and the feature's other tasks' work share a common ancestor a later merge can reconcile.
 * Throws with git's own stderr when the repo refuses (e.g. the branch is checked out in the
 * main tree) — the caller fails the task with that message rather than guessing.
 */
export function ensureTaskWorktree(
  projectPath: string,
  taskId: string,
  opts: { branch?: string | null; maxWorktrees?: number; baseRef?: string | null } = {},
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
  // Only a brand-new branch takes a base — an existing one (the reattach cases above) already
  // has whatever history it started with. A leading dash is refused as a ref, same rule as
  // `opts.branch` above and `gitShowFile`.
  const base = opts.baseRef && !opts.baseRef.startsWith("-") ? [opts.baseRef] : [];
  git(projectPath, ["worktree", "add", "-b", birthBranch, dir, ...base]);
  return { dir, branch: birthBranch };
}

/**
 * Make sure a feature's branch ref exists, creating it off `base` (normally the project's
 * default branch) the first time any of its tasks runs isolated. This only ever creates a
 * ref — it never checks anything out or touches the working tree — so it's safe to call
 * against the project's own checkout even while another session is live there, exactly like
 * `git status` already is safe to run concurrently. Idempotent: a branch created by an
 * earlier task of the same feature (or by hand) is left exactly where it is, since renaming
 * or rebasing it out from under work already merged into it would be actively wrong.
 *
 * Always attempts the create rather than checking first, and treats "already exists" as
 * success once `branchExists` confirms it — which is what makes this safe against two
 * feature-linked tasks dispatched at once: `git branch` is atomic, so at most one side's
 * create actually happens, and the loser lands here and finds the winner's ref already in
 * place. Any other failure (an unusable `base`) still throws.
 */
export function ensureFeatureBranch(
  projectPath: string,
  branch: string,
  base: string | null,
): void {
  if (branch.startsWith("-")) {
    throw new Error(`refusing to create an unsafe feature branch ref: ${branch}`);
  }
  try {
    git(projectPath, ["branch", branch, ...(base && !base.startsWith("-") ? [base] : [])]);
  } catch (err) {
    if (!branchExists(projectPath, branch)) throw err;
  }
}

/**
 * How a feature merge-back attempt ended. Exactly the vocabulary `tasks.mergeState` records
 * (minus "pending", which is the not-yet/never answer, not an attempt's outcome):
 * - "merged"     — the task branch is in the feature branch now.
 * - "conflict"   — a real content conflict (unmerged index entries); needs reconciling.
 * - "blocked"    — the merge couldn't be *attempted* (branch checked out in a busy checkout,
 *                  a git failure, an unsafe ref). Retryable; nothing needs resolving.
 * - "no_commits" — the task branch holds no commits beyond the feature branch, so there was
 *                  nothing to merge. Deliberately not "merged": for a run that committed
 *                  nothing, "merged" would hide that its work (if any) is still uncommitted
 *                  in its kept worktree.
 */
export type FeatureMergeOutcome = {
  state: "merged" | "conflict" | "blocked" | "no_commits";
  output: string;
};

const fromMerge = (r: MergeResult): FeatureMergeOutcome =>
  r.ok
    ? { state: "merged", output: r.output }
    : { state: r.conflict ? "conflict" : "blocked", output: r.output };

/**
 * Is every commit of `branch` already reachable from `containerBranch`? Decided from the
 * object store alone (`rev-list -n 1 container..branch` finding nothing), so it never
 * touches any working tree. Null when git can't answer (a deleted branch, a broken repo) —
 * distinct from false, because "couldn't tell" must not read as "there is work to merge".
 */
export function branchContained(
  projectPath: string,
  containerBranch: string,
  branch: string,
): boolean | null {
  // Leading-dash guard even though both current callers already check — this file's stated
  // policy is that every ref gets it, so a future third caller can't reintroduce the hole by
  // forgetting. A `-`-led ref would be read by git as an option in the range below.
  if (containerBranch.startsWith("-") || branch.startsWith("-")) return null;
  try {
    const unique = git(projectPath, [
      "rev-list",
      "-n",
      "1",
      `${containerBranch}..${branch}`,
    ]);
    return unique.length === 0;
  } catch {
    return null;
  }
}

/**
 * Where `branch` is currently checked out, if anywhere — the absolute worktree path, or null.
 * Git refuses to check one branch out in two worktrees, so this is what decides whether a
 * merge-back can use a throwaway worktree at all, and it is how "the feature branch lives in
 * the main checkout" is detected instead of via a failed `worktree add` (which used to read
 * as a "conflict").
 *
 * **Parsed with `--porcelain -z`, and that is a security fix, not tidiness** — the same class
 * CLAUDE.md documents for `git status -z`/`--numstat -z`. A worktree path is any byte except
 * NUL, and git does **not** quote/escape a **newline** inside a path in the plain porcelain
 * output. A task (agent + Bash, its own worktree writable, `.git` bookkeeping shared across a
 * project's linked worktrees) could `git worktree add "$(printf '%s\nbranch refs/heads/<feat>'
 * "$PROJECT")" <scratch>` to register an entry whose printed path *contains* a fake
 * `branch refs/heads/<feature>` line — a newline-split parser then attributes the feature
 * branch to the project checkout that never held it, and `mergeFeatureTask` runs `git merge`
 * in the user's real checkout. Under `-z` every field is NUL-terminated and records are
 * separated by an empty field, so an embedded newline stays inert inside the path token.
 * Reproduced end to end before the fix (security audit, 2026-08-22).
 */
export function branchCheckoutDir(projectPath: string, branch: string): string | null {
  const out = git(projectPath, ["worktree", "list", "--porcelain", "-z"]);
  const wantBranch = `branch refs/heads/${branch}`;
  let dir: string | null = null;
  for (const field of out.split("\0")) {
    if (field.startsWith("worktree ")) dir = field.slice("worktree ".length);
    else if (dir && field === wantBranch) return dir;
    else if (field === "") dir = null; // record separator — a stray field can't cross records
  }
  return null;
}

/**
 * Merge `taskBranch` into `featureBranch`, never touching the task's own worktree (which the
 * caller still needs intact to read the branch off before its own cleanup). Never throws —
 * every failure is a classified outcome, because the caller's next move differs by kind:
 * a "conflict" is offered to the live session to resolve, a "blocked" is retried by the
 * sweep, and neither should be guessed from an exception's prose.
 *
 * Where the merge runs depends on where the feature branch is checked out:
 * - nowhere → a throwaway worktree of the feature branch under the OS tmpdir (never
 *   `WORKTREES_DIR` — it must not count against `MAX_WORKTREES`), removed before returning
 *   either way. On failure `gitMerge` has already aborted, so the temp tree is clean.
 * - in the project's own checkout → merge **there**, but only when the caller says the
 *   checkout is free (`mergeInMainCheckout`). This is the honest fix for the failure that
 *   used to be recorded as "conflict": non-isolated feature runs check the feature branch
 *   out in the main checkout and leave it there, and git refuses to check it out a second
 *   time in a temp worktree. Merging in place advances the user's checkout together with
 *   the branch — exactly what a checkout sitting on that branch means — and `gitMerge`
 *   aborts on any failure, so a dirty checkout that would collide refuses cleanly instead
 *   of half-merging. When the checkout is busy (a session is live there), the answer is
 *   "blocked", and the sweep retries once it frees up.
 * - in any other worktree → "blocked" (we own neither that tree nor its timing).
 *
 * The task branch itself is never written to, whatever the outcome, so a failed merge can
 * always be retried later or resolved by hand.
 */
export function mergeFeatureTask(
  projectPath: string,
  featureBranch: string,
  taskBranch: string,
  opts: { mergeInMainCheckout?: boolean } = {},
): FeatureMergeOutcome {
  // Both refs get the same leading-dash guard as everything else in this file before
  // reaching git's argv — `featureBranch` always comes from `features.branch` today (an
  // allowlisted slug), but this function takes bare strings.
  if (!featureBranch || featureBranch.startsWith("-")) {
    return {
      state: "blocked",
      output: `refusing to merge into an unsafe ref: ${featureBranch}`,
    };
  }
  if (!taskBranch || taskBranch.startsWith("-")) {
    return { state: "blocked", output: `refusing to merge an unsafe ref: ${taskBranch}` };
  }
  try {
    // Nothing to merge? Decided from the object store before any worktree is touched — a
    // `--no-ff` merge of an already-contained branch answers "Already up to date" without a
    // commit, which used to read as "merged" even for a run that committed nothing at all.
    const contained = branchContained(projectPath, featureBranch, taskBranch);
    if (contained === null) {
      return {
        state: "blocked",
        output: `could not compare ${taskBranch} against ${featureBranch}`,
      };
    }
    if (contained) return { state: "no_commits", output: "" };

    const checkoutDir = branchCheckoutDir(projectPath, featureBranch);
    if (checkoutDir) {
      let isMainCheckout = false;
      try {
        isMainCheckout = realpathSync(checkoutDir) === realpathSync(projectPath);
      } catch {
        /* a vanished worktree path — fall through to blocked below */
      }
      if (isMainCheckout && opts.mergeInMainCheckout) {
        return fromMerge(gitMerge(projectPath, taskBranch));
      }
      return {
        state: "blocked",
        output:
          `${featureBranch} is checked out at ${checkoutDir}` +
          (isMainCheckout
            ? " and the checkout is busy — the merge will be retried when it frees up"
            : " — git refuses a second checkout of one branch"),
      };
    }

    // Stale bookkeeping from a crashed earlier attempt would make `worktree add` refuse the
    // path below — the same reason `ensureTaskWorktree` prunes before creating.
    git(projectPath, ["worktree", "prune"]);
    const dir = mkdtempSync(join(tmpdir(), "platform-merge-"));
    try {
      git(projectPath, ["worktree", "add", dir, featureBranch]);
      return fromMerge(gitMerge(dir, taskBranch));
    } finally {
      try {
        git(projectPath, ["worktree", "remove", "--force", dir]);
      } catch {
        /* best-effort — the directory is removed directly below regardless */
      }
      rmSync(dir, { recursive: true, force: true });
    }
  } catch (err) {
    return { state: "blocked", output: (err as Error).message };
  }
}

/** Does this worktree hold uncommitted changes? Used by the merge sweep to tell "nothing to
 *  merge because the work was never committed" (worktree kept, dirty) apart from "everything
 *  this branch had is in the feature branch" — the two honest readings of an empty
 *  `rev-list`. Unreadable (e.g. removed mid-check) counts as clean: the caller only uses
 *  this to pick a label, never to decide whether to delete anything. */
export function worktreeDirty(dir: string): boolean {
  if (!existsSync(dir)) return false;
  try {
    return git(dir, ["status", "--porcelain"]).length > 0;
  } catch {
    return false;
  }
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
