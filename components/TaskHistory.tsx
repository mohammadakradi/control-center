import type { FeatureLite } from "./FeatureGroup";
import { CardSection } from "./ui-cards";
import { GroupedTaskList, TaskList, type TaskRow } from "./TaskList";

/** The project detail page's task-history card: a titled `CardSection` with a run count,
 *  wrapping the shared {@link TaskList}. The rows themselves live in `TaskList` because the
 *  dashboard and agent detail render the same rows under different headings. */
export function TaskHistory({
  history,
  namespaceById,
  featureById,
  className = "",
}: {
  history: TaskRow[];
  /** agent id → namespace, for rendering the `/namespace:command` label. */
  namespaceById: Record<string, string>;
  /**
   * The project's features, keyed by id. Pass it to group the history by feature; omit it and
   * this is the flat list it has always been.
   *
   * Opt-in even though the page always has them, because `GroupedTaskList` needs the map to be
   * *complete* — a task whose feature is missing from it reads as ungrouped, which would be a
   * quietly wrong grouping rather than a visible error. A caller that can't supply every
   * feature should pass nothing.
   */
  featureById?: Record<string, FeatureLite>;
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
      {/* No project cell — every row here belongs to the project being viewed. The count above
          stays the card's total either way, so grouping never changes what the header claims. */}
      {featureById ? (
        <GroupedTaskList
          history={history}
          namespaceById={namespaceById}
          featureById={featureById}
        />
      ) : (
        <TaskList history={history} namespaceById={namespaceById} />
      )}
    </CardSection>
  );
}
