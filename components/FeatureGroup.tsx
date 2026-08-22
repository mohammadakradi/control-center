import { GitBranch, GitMerge, Layers, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import type { Feature, TaskMergeState } from "@/lib/db/schema";
import {
  featureMergeSummary,
  hasMergeSummary,
  MERGE_STATE_LABEL,
  mergeStateTone,
} from "@/lib/ui";
import { Chip } from "./ui-cards";

/**
 * What a heading needs of a feature. Deliberately narrower than the row: this shape is
 * satisfied both by a full `Feature` and by the projection `listBacklog` joins onto each item,
 * so the backlog and the task lists can pass what they already have without a second query.
 */
export type FeatureLite = Pick<Feature, "id" | "name" | "branch" | "status">;

/**
 * One feature's heading, above whatever rows belong to it.
 *
 * Three surfaces group work by feature — the backlog, project detail's task history and the
 * cross-project Tasks page — and this is the single heading treatment they share, for the same
 * reason `TaskList` is the single task row: three hosts hand-rolling "name + branch + merge
 * state" is three chances for a feature to look like a different kind of thing on each page.
 *
 * It is an **`<h3>`**, which is what makes it composable: every host renders these inside a
 * `CardSection`, whose title is an `<h2>`, so the document outline stays correct wherever this
 * lands (project → feature on `/tasks`, "Open" → feature on the backlog). Deliberately not a
 * `<section aria-labelledby>`: a named `section` is an ARIA landmark, and a card holding five
 * features would put five landmarks in the page's region list for no navigational gain —
 * heading navigation is already the right way through this.
 */
export function FeatureGroup({
  feature,
  count,
  unit,
  mergeStates = [],
  children,
}: {
  /** Null renders the ungrouped bucket — see `groupByFeature`, which only ever puts it last. */
  feature: FeatureLite | null;
  count: number;
  /** "task" / "item" — the noun this group counts, since both lists use these headings. */
  unit: string;
  /** The merge state of every row in the group, in any order. Handed over rather than
   *  pre-summarised because the two hosts read it from different places (a task's own column, a
   *  backlog item's linked run) and `featureMergeSummary` is the one thing that must not differ
   *  between them — notably that it never counts `pending`. */
  mergeStates?: readonly (TaskMergeState | null | undefined)[];
  children: ReactNode;
}) {
  const summary = featureMergeSummary(mergeStates);

  return (
    <div className="border-t border-line pt-4 first:border-t-0 first:pt-0">
      <div className="mb-1 flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
        {/* `min-w-0` + `break-words` rather than `truncate`: a feature name is up to 200
            characters of prose and this is the group's only label, so wrapping it is right
            where ellipsising a task title in a dense row is. */}
        <h3 className="min-w-0 text-sm font-semibold break-words text-fg-strong">
          {feature ? (
            feature.name
          ) : (
            <span className="inline-flex items-center gap-1.5">
              <Layers className="size-3.5 text-fg-ghost" aria-hidden="true" />
              No feature
            </span>
          )}
        </h3>

        {feature && (
          // `min-w-0`, never `shrink-0`. A branch is `feature/` plus up to `MAX_SLUG_LENGTH`
          // (60) characters, and at that length a rigid mono chip is wider than a 390px
          // viewport — measured at 95px of horizontal page overflow on a real project's
          // derived features, which is a horizontal scrollbar on the whole page.
          <span className="min-w-0 text-xs">
            {/* The branch is the one piece of a feature a user has to type somewhere else, so it
                is shown in full and allowed to **wrap** — never truncated to a prefix that
                won't check out, and never `truncate`+`title`, since a tooltip is unreachable by
                keyboard and this is the string you came to copy. `break-all` is the project's
                documented treatment for a long identifier. */}
            <Chip icon={<GitBranch className="size-3 shrink-0" aria-hidden="true" />}>
              <span className="font-mono break-all">{feature.branch}</span>
            </Chip>
          </span>
        )}

        {feature && feature.status !== "active" && (
          <span className="shrink-0 text-xs">
            <Chip
              tone={feature.status === "done" ? "ok" : "muted"}
              title="This feature has been closed out. Its work stays here — closing one never deletes history."
            >
              {feature.status === "done" ? "Closed" : "Cancelled"}
            </Chip>
          </span>
        )}

        {/* Merge state of the group as a whole. Both chips carry a word as well as a tone and an
            icon, so nothing here is conveyed by colour alone. `pending` is never summarised —
            see `featureMergeSummary`. */}
        {hasMergeSummary(summary) && (
          <span className="flex shrink-0 flex-wrap items-center gap-1.5 text-xs">
            {summary.conflict > 0 && (
              <Chip
                tone="warn"
                icon={<TriangleAlert className="size-3" aria-hidden="true" />}
                title="The platform could not merge these runs into the feature branch. Each task's own branch is intact — resolve the merge by hand."
              >
                {`${summary.conflict} conflict${summary.conflict === 1 ? "" : "s"}`}
              </Chip>
            )}
            {summary.merged > 0 && (
              <Chip
                tone="ok"
                icon={<GitMerge className="size-3" aria-hidden="true" />}
                title="Merged into the feature branch by the platform when the run finished."
              >
                {`${summary.merged} merged`}
              </Chip>
            )}
          </span>
        )}

        <span className="ml-auto shrink-0 text-xs text-fg-faint">
          {`${count} ${unit}${count === 1 ? "" : "s"}`}
        </span>
      </div>
      {children}
    </div>
  );
}

/**
 * A row's own merge state, as a chip.
 *
 * Rendered from the state the runner actually recorded, so `pending` shows here even though the
 * heading's summary never counts it: on a row it is the honest answer to "did this get merged",
 * and for a checkout run that answer is permanent (the platform never system-merges one). What
 * it must not become is an *aggregate* implying a queue that will drain.
 */
export function MergeStateChip({ state }: { state: TaskMergeState }) {
  return (
    <Chip
      tone={mergeStateTone(state)}
      icon={
        state === "conflict" ? (
          <TriangleAlert className="size-3" aria-hidden="true" />
        ) : (
          <GitMerge className="size-3" aria-hidden="true" />
        )
      }
      title={MERGE_TITLE[state]}
    >
      {/* Label and tone both come from `lib/ui.ts`, never restated here. A chip is tempted
          toward a shorter word ("Conflict"), and that is exactly how a second vocabulary for
          one state gets started — the kind of drift `STATUS_LABEL` exists to prevent. */}
      {MERGE_STATE_LABEL[state]}
    </Chip>
  );
}

/** Tooltip prose for each state — presentational, and only this file renders it, so unlike the
 *  label and the tone it has no second call site to drift from. */
const MERGE_TITLE: Record<TaskMergeState, string> = {
  merged: "This task's branch was merged into the feature branch when the run finished.",
  conflict:
    "The platform could not merge this task's branch into the feature branch. The branch is intact — resolve the merge by hand.",
  pending:
    "Not merged into the feature branch. A run that shares the project's own checkout is never merged by the platform, so this can be its final state.",
};
