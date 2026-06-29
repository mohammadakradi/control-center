import Link from "next/link";
import type { InferSelectModel } from "drizzle-orm";
import type { tasks } from "@/lib/db/schema";
import { StatusBadge } from "./StatusBadge";
import { CardSection } from "./ui-cards";
import { timeAgo } from "@/lib/ui";

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
        <span className="text-xs text-neutral-500">
          {total} task{total === 1 ? "" : "s"}
        </span>
      }
    >
      {total === 0 ? (
        <p className="py-4 text-sm text-neutral-400">No tasks yet.</p>
      ) : (
        <ul>
          {history.map((t) => (
            <li
              key={t.id}
              className="border-t border-neutral-800/80 first:border-t-0"
            >
              <Link
                href={`/tasks/${t.id}`}
                className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-lg px-2 py-3 hover:bg-white/2.5"
              >
                <span className="min-w-28 shrink-0 font-mono text-xs text-sky-300/90">
                  /{namespaceById[t.agentId] ?? "?"}:{t.command}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm text-neutral-200">
                  {t.title || t.requestText || (
                    <span className="text-neutral-600">no description</span>
                  )}
                </span>
                <span className="hidden shrink-0 text-xs text-neutral-500 sm:block">
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
