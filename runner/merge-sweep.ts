/**
 * Retry and reclassify feature merge-backs that couldn't settle when their run finished.
 *
 * A feature-linked isolated run merges its branch into the feature branch at `done` — but
 * that merge can be *blocked* (most commonly: the feature branch was checked out in the
 * project's busy main checkout, so git refused a second checkout of it), and before the
 * outcome vocabulary existed those blocks were recorded as `conflict`. This sweep is the
 * other half of "blocked is retryable": it runs whenever a project's checkout frees up
 * (promoteNext) and once at boot, and settles what it can:
 *
 * - A task branch already contained in the feature branch (`rev-list feature..task` empty)
 *   is reclassified from the object store alone, no merge attempted: `merged` when its
 *   commits are genuinely in the branch, `no_commits` when the run's kept worktree is still
 *   dirty — i.e. the run never committed, so "merged" would hide that its work is sitting
 *   uncommitted on disk. This is also what heals rows mis-recorded as `conflict` by the old
 *   catch-all once someone (or a later run) merges the branch by hand.
 * - A `blocked` row with real commits gets the merge re-attempted, now allowed to run in the
 *   main checkout when it holds the feature branch (the caller vouches it's free).
 * - A `conflict` row with real commits is left alone: it needs reconciling, not retrying —
 *   re-attempting it on every sweep would burn subprocesses to rediscover the same answer.
 *
 * Everything here is best-effort and bounded: one task's failure never stops the others,
 * and a sweep touches at most `MAX_SWEEP_TASKS` rows (in practice: zero — the query only
 * matches rows in a retryable state).
 */
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "../lib/db";
import {
  features,
  projects,
  taskEvents,
  tasks,
  type TaskMergeState,
} from "../lib/db/schema";
import {
  branchContained,
  mergeFeatureTask,
  taskWorktreeDir,
  worktreeDirty,
} from "./worktree";

export const MAX_SWEEP_TASKS = 20;

/** Record the sweep's verdict on the task row and in its transcript, so the state change is
 *  explained where the user reads the run — a chip that silently flips is a mystery.
 *
 *  This is a second insert path into `task_events` that doesn't go through `record()` (the
 *  redaction chokepoint) — the sweep has no live `SessionHandle`, so no per-task secret list
 *  to scrub against. On the honest path that is safe by construction: the only interpolated
 *  values are branch names and the output of a **local** `git merge`/`rev-list` (file paths,
 *  conflict markers, strategy prose), and the owner's Anthropic token lives only in the
 *  per-task SDK subprocess env (`buildTaskEnv`), never in the runner's `process.env`, so a
 *  platform-issued local git command here cannot echo it. Keep it that way: no message built
 *  here should ever include remote/credential output (a `push`/`pull` would, which is why the
 *  sweep only ever runs local merges).
 *
 *  The one caveat, so nobody reads this as unconditional: `gitEnv()` spreads the runner's
 *  full `process.env` (which *does* hold `GH_TOKEN`/`SECRETS_MASTER_KEY` — see
 *  `sensitiveEnvValues`) into every git subprocess, and a repo-defined merge driver's stdout
 *  is captured into `MergeResult.output`. So an attacker already holding the accepted
 *  `merge.<driver>.driver` RCE (documented in CLAUDE.md, filed as a backlog redesign) could
 *  make their driver print those and land them here unredacted. That is strictly weaker than
 *  the RCE itself (arbitrary code execution already beats exfiltrating through a DB column),
 *  so it is not an independent hole — but it is a reason the real fix for that RCE class is
 *  owed, not a reason this insert is unconditionally clean. */
function settle(taskId: string, state: TaskMergeState, message: string): void {
  db.update(tasks).set({ mergeState: state }).where(eq(tasks.id, taskId)).run();
  db.insert(taskEvents)
    .values({ taskId, type: "log" as never, payload: { message }, ts: new Date() })
    .run();
}

export function sweepFeatureMerges(
  projectId: string,
  opts: { mergeInMainCheckout: boolean },
): void {
  const project = db
    .select({ path: projects.path })
    .from(projects)
    .where(eq(projects.id, projectId))
    .get();
  if (!project) return;

  const rows = db
    .select({
      id: tasks.id,
      branch: tasks.branch,
      mergeState: tasks.mergeState,
      featureBranch: features.branch,
    })
    .from(tasks)
    .innerJoin(features, eq(features.id, tasks.featureId))
    .where(
      and(
        eq(tasks.projectId, projectId),
        eq(tasks.status, "done"),
        inArray(tasks.mergeState, ["blocked", "conflict"]),
        isNotNull(tasks.branch),
      ),
    )
    .limit(MAX_SWEEP_TASKS)
    .all();

  for (const row of rows) {
    try {
      const branch = row.branch!;
      // The same leading-dash guard every ref gets before reaching git's argv.
      if (branch.startsWith("-") || row.featureBranch.startsWith("-")) continue;

      const contained = branchContained(project.path, row.featureBranch, branch);
      if (contained === null) continue; // git couldn't answer (deleted branch, …) — leave it

      if (contained) {
        // Nothing left to merge — decide which honest reading applies (see module docs).
        if (worktreeDirty(taskWorktreeDir(row.id))) {
          if (row.mergeState !== "no_commits") {
            settle(
              row.id,
              "no_commits",
              `Merge sweep: ${branch} has no commits beyond ${row.featureBranch} — nothing to ` +
                "merge. This run's worktree still holds uncommitted work; continue the task to " +
                "commit it, or recover it from the worktree by hand.",
            );
          }
        } else {
          settle(
            row.id,
            "merged",
            `🔀 Merge sweep: ${branch} is now fully contained in ${row.featureBranch} — marked merged.`,
          );
        }
        continue;
      }

      // Real commits still outside the feature branch: only a *blocked* attempt is retried.
      if (row.mergeState !== "blocked") continue;
      const outcome = mergeFeatureTask(project.path, row.featureBranch, branch, opts);
      // Still blocked → nothing new. `no_commits` is unreachable here (we only reach this
      // line when `!contained`, and that is exactly what `mergeFeatureTask` returns
      // `no_commits` for), so the only outcomes worth recording are merged / conflict.
      if (outcome.state === "blocked" || outcome.state === "no_commits") continue;
      settle(
        row.id,
        outcome.state,
        outcome.state === "merged"
          ? `🔀 Merge sweep: merged ${branch} into ${row.featureBranch}.`
          : `⚠️ Merge sweep: merging ${branch} into ${row.featureBranch} hits a real ` +
            `conflict — resolve it by hand (both branches are intact):\n${outcome.output}`,
      );
    } catch {
      // One task's git hiccup must not stop the rest of the sweep — or the caller.
    }
  }
}
