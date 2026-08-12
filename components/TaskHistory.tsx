import { CardSection } from "./ui-cards";
import { TaskList, type TaskRow } from "./TaskList";

/** The project detail page's task-history card: a titled `CardSection` with a run count,
 *  wrapping the shared {@link TaskList}. The rows themselves live in `TaskList` because the
 *  dashboard and agent detail render the same rows under different headings. */
export function TaskHistory({
  history,
  namespaceById,
  className = "",
}: {
  history: TaskRow[];
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
          {`${total} task${total === 1 ? "" : "s"}`}
        </span>
      }
    >
      {/* No project cell — every row here belongs to the project being viewed. */}
      <TaskList history={history} namespaceById={namespaceById} />
    </CardSection>
  );
}
