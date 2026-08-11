import Link from "next/link";
import { FolderGit2 } from "lucide-react";
import type { InferSelectModel } from "drizzle-orm";
import type { tasks } from "@/lib/db/schema";
import { StatusBadge } from "./StatusBadge";
import { UsageCost } from "./UsageDisplay";
import { taskDisplayTitle, timeAgo } from "@/lib/ui";
import { taskUsage } from "@/lib/usage-format";

export type TaskRow = InferSelectModel<typeof tasks>;

/**
 * The task row, defined once — every list of tasks in the app renders through this
 * (project detail via {@link TaskHistory}, the dashboard's recent activity, agent detail's
 * recent runs).
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
  emptyMessage = "No tasks yet.",
}: {
  history: TaskRow[];
  /** agent id → namespace, for the `/namespace:command` label. */
  namespaceById: Record<string, string>;
  /** project id → name. Pass it to add the project cell (dashboard, agent detail); omit it
   *  on a list that is already scoped to one project. */
  projectNameById?: Record<string, string>;
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
              <StatusBadge status={t.status} />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
