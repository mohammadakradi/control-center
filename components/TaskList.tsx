import Link from "next/link";
import { FolderGit2 } from "lucide-react";
import type { InferSelectModel } from "drizzle-orm";
import type { tasks } from "@/lib/db/schema";
import { FeatureGroup, MergeStateChip, type FeatureLite } from "./FeatureGroup";
import { StatusBadge } from "./StatusBadge";
import { UsageCost } from "./UsageDisplay";
import { groupByFeature, mergeChipProps, taskDisplayTitle, timeAgo } from "@/lib/ui";
import { taskUsage } from "@/lib/usage-format";

export type TaskRow = InferSelectModel<typeof tasks>;

/**
 * The task row, defined once — every list of tasks in the app renders through this
 * (project detail via {@link FeatureManager}'s per-feature panels, the dashboard's recent
 * activity, agent detail's recent runs).
 *
 * Rows are **title-first**: the generated `tasks.title` names the task, and the raw request
 * is only a fallback (see `taskDisplayTitle`). The dashboard and agent lists used to
 * hand-roll their own rows and render `requestText`, so the same history read as prose in
 * one place and as an intent in another.
 *
 * Per-context extras are opt-in props rather than forks of the markup. The card shell is
 * deliberately *not* here: the three hosts head their cards differently ("Task history"
 * with a count, "Recent activity", "Recent runs" with a run count), and `CardSection`
 * already owns that pattern.
 *
 * Renders the empty state itself so the copy can be per-context without every caller
 * repeating the markup. Slicing is the caller's business — this shows what it is given.
 */
export function TaskList({
  history,
  namespaceById,
  projectNameById,
  showMergeState = false,
  emptyMessage = "No tasks yet.",
}: {
  history: TaskRow[];
  /** agent id → namespace, for the `/namespace:command` label. */
  namespaceById: Record<string, string>;
  /** project id → name. Pass it to add the project cell (dashboard, agent detail); omit it
   *  on a list that is already scoped to one project. */
  projectNameById?: Record<string, string>;
  /**
   * Show each row's merge state (where it has one).
   *
   * Opt-in rather than automatic, and the reason is the row's width budget rather than
   * taste: this is a sixth cell on a row already carrying a command, a title, a project, a
   * cost, a timestamp and a status. It earns the space only where the feature branch is the
   * subject — i.e. inside a {@link GroupedTaskList} — and outside one the task's own status
   * is what a reader is scanning for. A row with no merge state (no feature) renders nothing
   * either way, so an ungrouped bucket stays exactly as dense as it was.
   */
  showMergeState?: boolean;
  emptyMessage?: string;
}) {
  if (history.length === 0)
    return <p className="py-4 text-sm text-fg-subtle">{emptyMessage}</p>;

  return (
    <ul>
      {history.map((t) => {
        const name = taskDisplayTitle(t);
        return (
          <li key={t.id} className="border-t border-line first:border-t-0">
            <Link
              href={`/tasks/${t.id}`}
              className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-lg px-2 py-3 hover:bg-hover"
            >
              <span className="min-w-28 shrink-0 font-mono text-xs text-accent">
                /{namespaceById[t.agentId] ?? "?"}:{t.command}
                {t.agentVersion && (
                  <span className="ml-1.5 text-fg-faint">v{t.agentVersion}</span>
                )}
              </span>
              {/* The task's name is the row's subject, so it stays visible at every width —
                  the cells that step aside below `sm` are the metadata ones. */}
              <span className="min-w-0 flex-1 truncate text-sm text-fg">
                {name ?? <span className="text-fg-faint">no description</span>}
              </span>
              {projectNameById && (
                <span className="inline-flex min-w-0 shrink items-center gap-1.5 text-xs text-fg-faint">
                  <FolderGit2 className="size-3.5 shrink-0" aria-hidden="true" />
                  <span className="sr-only">Project </span>
                  {/* `min-w-0` on the truncating span itself, not just its parent: as a flex
                      item its automatic minimum size is its content width, so a long project
                      name would otherwise refuse to shrink and widen the row. */}
                  <span className="min-w-0 truncate">
                    {projectNameById[t.projectId] ?? "?"}
                  </span>
                </span>
              )}
              {/* Cost and timestamp both step aside below `sm` — the row is already
                  carrying the command, title, and status at 375px. */}
              <UsageCost
                usage={taskUsage(t)}
                className="hidden shrink-0 sm:block"
              />
              <span className="hidden shrink-0 text-xs text-fg-faint sm:block">
                {timeAgo(t.createdAt)}
              </span>
              {/* `sr-only sm:not-sr-only`, not `hidden sm:*`: below `sm` the row has no width
                  to spare, but "Merge conflict" must stay in the row's accessible name at
                  every size rather than dropping out of it — the trick `MobileTabBar` and the
                  command palette's status badge both use. The chip decides for itself whether
                  it has anything honest to say (`mergeChipView` — e.g. a cancelled run whose
                  merge was never attempted renders nothing), so the row passes the whole task
                  and doesn't second-guess it. */}
              {showMergeState && (
                <span className="sr-only shrink-0 text-xs sm:not-sr-only">
                  {/* Narrowed, never the whole row: this chip is a client component, so
                      anything handed to it is serialized into the page's HTML. Passing `t`
                      shipped `workdir`, `sessionId` and `requestText` for a row that renders
                      six fields — see `mergeChipProps`. */}
                  <MergeStateChip task={mergeChipProps(t)} />
                </span>
              )}
              <StatusBadge status={t.status} />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The same task rows, under one heading per feature.
 *
 * A thin wrapper over {@link TaskList} rather than a second row implementation — every task
 * list in the app renders through that one row by design, and forking it to add a heading is
 * how the three drifted copies this file replaced got started. All this adds is the grouping
 * and the heading; each group's body *is* a `TaskList`.
 *
 * Renders the plain ungrouped list when no task here belongs to a feature (`groupByFeature`
 * answers null), so a project or an install that hasn't used features looks exactly as it did
 * before — a single "No feature" heading over everything would be a level of hierarchy that
 * conveys nothing.
 */
export function GroupedTaskList({
  history,
  namespaceById,
  featureById,
  emptyMessage,
}: {
  history: TaskRow[];
  namespaceById: Record<string, string>;
  /** Every feature these tasks might reference. A task whose feature isn't in here falls into
   *  the ungrouped bucket rather than vanishing — see `groupByFeature`. */
  featureById: Record<string, FeatureLite>;
  emptyMessage?: string;
}) {
  const groups = groupByFeature(history, (t) =>
    t.featureId ? featureById[t.featureId] : null,
  );

  if (!groups)
    return (
      <TaskList
        history={history}
        namespaceById={namespaceById}
        emptyMessage={emptyMessage}
      />
    );

  return (
    <div className="space-y-4">
      {groups.map((g) => (
        <FeatureGroup
          key={g.feature?.id ?? "__ungrouped"}
          feature={g.feature}
          count={g.rows.length}
          unit="task"
          mergeStates={g.rows.map((t) => t.mergeState)}
        >
          {/* No project cell: on `/tasks` the card heading names the project, and on project
              detail there is only one. The merge chip is on because inside a feature group the
              feature branch is the subject — see `TaskList`'s `showMergeState`. */}
          <TaskList
            history={g.rows}
            namespaceById={namespaceById}
            showMergeState
          />
        </FeatureGroup>
      ))}
    </div>
  );
}
