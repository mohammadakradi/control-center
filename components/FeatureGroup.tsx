"use client";

import {
  ChevronRight,
  Clock3,
  GitBranch,
  GitMerge,
  Layers,
  TriangleAlert,
} from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import type { Feature, TaskMergeState } from "@/lib/db/schema";
import {
  featureGroupDefaultOpen,
  featureMergeSummary,
  hasMergeSummary,
  mergeChipView,
  type MergeChipInput,
} from "@/lib/ui";
import { Chip } from "./ui-cards";

/**
 * What a heading needs of a feature. Deliberately narrower than the row: this shape is
 * satisfied both by a full `Feature` and by the projection `listBacklog` joins onto each item,
 * so the backlog and the task lists can pass what they already have without a second query.
 */
export type FeatureLite = Pick<Feature, "id" | "name" | "branch" | "status">;

/**
 * One feature's heading, above whatever rows belong to it — now a **disclosure**: the heading
 * always renders, the rows collapse under it.
 *
 * Three surfaces group work by feature — the backlog, project detail's task history and the
 * cross-project Tasks page — and this is the single heading treatment they share, for the same
 * reason `TaskList` is the single task row: three hosts hand-rolling "name + branch + merge
 * state" is three chances for a feature to look like a different kind of thing on each page.
 * Making it collapsible here rather than per-host is the same argument again.
 *
 * A client component now (the open state is the whole point), but the children are rendered by
 * the server hosts and passed through — collapsing only hides them, nothing refetches. Active
 * features and the ungrouped bucket start open; closed features start collapsed
 * (`featureGroupDefaultOpen`), since their rows are history that would otherwise push live
 * work below the fold. The state is per-render on purpose: a persisted collapse (localStorage)
 * would make a feature someone closed *stay* invisible on every future visit, which is a
 * filter, not a fold.
 *
 * The heading is an **`<h3>`**, which is what makes it composable: every host renders these
 * inside a `CardSection`, whose title is an `<h2>`, so the document outline stays correct
 * wherever this lands. The disclosure is a real `<button>` inside the heading (name + chevron)
 * with `aria-expanded`/`aria-controls`, so it works from the keyboard and reads as a
 * disclosure to assistive tech. The chips and the count stay *outside* the button — they are
 * reference material (the branch chip is a string to copy), and folding them into the button
 * would bloat its accessible name and make the branch text unselectable-without-toggling.
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
  const [open, setOpen] = useState(() => featureGroupDefaultOpen(feature));
  const bodyId = useId();
  const summary = featureMergeSummary(mergeStates);

  return (
    <div className="border-t border-line pt-4 first:border-t-0 first:pt-0">
      <div className="mb-1 flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
        {/* `min-w-0` + `break-words` rather than `truncate`: a feature name is up to 200
            characters of prose and this is the group's only label, so wrapping it is right
            where ellipsising a task title in a dense row is. */}
        <h3 className="min-w-0 text-sm font-semibold break-words text-fg-strong">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-controls={bodyId}
            className="inline-flex min-w-0 items-center gap-1.5 rounded-md text-left hover:text-fg focus-visible:outline-2 focus-visible:outline-accent"
          >
            <ChevronRight
              className={`size-3.5 shrink-0 text-fg-ghost transition-transform ${open ? "rotate-90" : ""}`}
              aria-hidden="true"
            />
            {feature ? (
              <span className="min-w-0 break-words">{feature.name}</span>
            ) : (
              <span className="inline-flex items-center gap-1.5">
                <Layers className="size-3.5 text-fg-ghost" aria-hidden="true" />
                No feature
              </span>
            )}
          </button>
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

        {/* Merge state of the group as a whole. Every chip carries a word as well as a tone and
            an icon, so nothing here is conveyed by colour alone. `pending` is never summarised;
            `blocked` is — unlike pending it is a queue that genuinely drains (the sweep retries
            it when the project frees up). See `featureMergeSummary`. */}
        {hasMergeSummary(summary) && (
          <span className="flex shrink-0 flex-wrap items-center gap-1.5 text-xs">
            {summary.conflict > 0 && (
              <Chip
                tone="warn"
                icon={<TriangleAlert className="size-3" aria-hidden="true" />}
                title="Merging these runs into the feature branch hit real conflicts. Each task's own branch is intact — resolve the merges by hand."
              >
                {`${summary.conflict} conflict${summary.conflict === 1 ? "" : "s"}`}
              </Chip>
            )}
            {summary.blocked > 0 && (
              <Chip
                tone="muted"
                icon={<Clock3 className="size-3" aria-hidden="true" />}
                title="These merges couldn't run yet (the feature branch's checkout was in use). The platform retries them automatically when the project frees up."
              >
                {`${summary.blocked} waiting`}
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

        {/* The count stays visible while collapsed — it is what says the fold is hiding
            something, and how much. */}
        <span className="ml-auto shrink-0 text-xs text-fg-faint">
          {`${count} ${unit}${count === 1 ? "" : "s"}`}
        </span>
      </div>
      <div id={bodyId} hidden={!open}>
        {children}
      </div>
    </div>
  );
}

/**
 * A row's own merge state, as a chip — or nothing, when there is nothing honest to say.
 *
 * All the wording, tones and the hide-on-cancelled rule live in `mergeChipView` (`lib/ui.ts`),
 * where `pnpm test` can reach them; this component only draws the answer. A chip is tempted
 * toward a shorter word ("Conflict"), and that is exactly how a second vocabulary for one
 * state gets started — the kind of drift `STATUS_LABEL` exists to prevent.
 */
export function MergeStateChip({ task }: { task: MergeChipInput }) {
  const view = mergeChipView(task);
  if (!view) return null;
  return (
    <Chip
      tone={view.tone}
      icon={
        view.state === "conflict" ? (
          <TriangleAlert className="size-3" aria-hidden="true" />
        ) : view.state === "blocked" ? (
          <Clock3 className="size-3" aria-hidden="true" />
        ) : (
          <GitMerge className="size-3" aria-hidden="true" />
        )
      }
      title={view.title}
    >
      {view.label}
    </Chip>
  );
}
