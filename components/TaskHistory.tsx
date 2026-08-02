import Link from "next/link";
import type { InferSelectModel } from "drizzle-orm";
import type { tasks } from "@/lib/db/schema";
import { StatusBadge } from "./StatusBadge";
import { UsageCost } from "./UsageDisplay";
import { CardSection } from "./ui-cards";
import { timeAgo } from "@/lib/ui";
import { taskUsage } from "@/lib/usage-format";

type Task = InferSelectModel<typeof tasks>;

/** Reverse-chronological list of tasks run on a project. Each row links to the
 *  task live view. Rows wrap on narrow viewports; the request text truncates. */
export function TaskHistory({
  history,
  namespaceById,
  className = "",
}: {
  history: Task[];
  /** agent id → namespace, for rendering the `/namespace:command` label. */
  namespaceById: Record<string, string>;
  className?: string;
}) {
  const total = history.length;
  return (
    <CardSection
      title="Task history"
      className={className}
      right={
        <span className="text-xs text-fg-faint">
          {total} task{total === 1 ? "" : "s"}
        </span>
      }
    >
      {total === 0 ? (
        <p className="py-4 text-sm text-fg-subtle">No tasks yet.</p>
      ) : (
        <ul>
          {history.map((t) => (
            <li
              key={t.id}
              className="border-t border-line first:border-t-0"
            >
              <Link
                href={`/tasks/${t.id}`}
                className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-lg px-2 py-3 hover:bg-hover"
              >
                <span className="min-w-28 shrink-0 font-mono text-xs text-accent">
                  /{namespaceById[t.agentId] ?? "?"}:{t.command}
                  {t.agentVersion && (
                    <span className="ml-1.5 text-fg-ghost">
                      v{t.agentVersion}
                    </span>
                  )}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm text-fg">
                  {t.title || t.requestText || (
                    <span className="text-fg-ghost">no description</span>
                  )}
                </span>
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
          ))}
        </ul>
      )}
    </CardSection>
  );
}
