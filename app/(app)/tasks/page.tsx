import Link from "next/link";
import { desc } from "drizzle-orm";
import { ListChecks } from "lucide-react";
import { db } from "@/lib/db";
import { projects, tasks } from "@/lib/db/schema";
import { syncAgents } from "@/lib/discovery/agents";
import { TaskList, type TaskRow } from "@/components/TaskList";
import {
  CardSection,
  EmptyState,
  PageHeader,
  ViewAll,
} from "@/components/ui-cards";
import {
  ProjectFilterNav,
  type ProjectFilterOption,
} from "@/components/ProjectFilterNav";
import { getCurrentUser } from "@/lib/auth";
import { ownedBy } from "@/lib/task-access";

export const dynamic = "force-dynamic";

/**
 * Rows per project group when no filter is applied. A project with years of history would
 * otherwise bury every other project below it, and this page's job is the view *across*
 * projects. The remainder is disclosed with a link, never silently dropped.
 *
 * Filtering to a single project lifts the cap: that's an explicit "show me this one", and
 * project detail's own history is uncapped too.
 */
const GROUP_LIMIT = 8;

export default async function TasksPage({
  searchParams,
}: {
  // Async in Next 16 — see node_modules/next/dist/docs/.../file-conventions/page.md.
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  // Sign-in is optional; without one this is the local workspace. Either way this page shows
  // only the caller's own runs — `ownedBy` is what separates two people sharing one install.
  const user = await getCurrentUser();
  const allTasks = db
    .select()
    .from(tasks)
    .where(ownedBy(user.id))
    .orderBy(desc(tasks.createdAt))
    .all();

  const projectList = db.select().from(projects).all();
  const agentList = syncAgents();
  const namespaceById: Record<string, string> = {};
  for (const a of agentList) namespaceById[a.id] = a.namespace;
  const projectById = new Map(projectList.map((p) => [p.id, p]));

  // Group by project, insertion-ordered by the tasks themselves — since `allTasks` is sorted
  // newest-first, the project with the most recent activity leads. A project whose row is
  // gone can't appear (`tasks.project_id` is ON DELETE CASCADE), but a missing lookup is
  // skipped rather than rendered as a group called "?".
  const groups = new Map<string, TaskRow[]>();
  for (const t of allTasks) {
    if (!projectById.has(t.projectId)) continue;
    const bucket = groups.get(t.projectId);
    if (bucket) bucket.push(t);
    else groups.set(t.projectId, [t]);
  }

  const filterOptions: ProjectFilterOption[] = [...groups].map(([id, list]) => ({
    id,
    name: projectById.get(id)!.name,
    count: list.length,
  }));

  // A hand-edited or stale `?project=` falls back to the unfiltered view rather than
  // erroring — same rule as `/usage`'s range: a page with a perfectly good default view
  // shouldn't 500 on an old bookmark. A repeated param arrives as an array, which can't mean
  // one project, so it falls back too. An id that no longer matches anything is kept, so the
  // empty state can explain itself instead of silently showing every project.
  const requested = (await searchParams).project;
  const selected = typeof requested === "string" && requested ? requested : null;
  const visible = selected ? [...groups].filter(([id]) => id === selected) : [...groups];

  const taskCount = allTasks.length;
  const projectCount = groups.size;

  // The description follows the filter. Saying "18 tasks across 3 projects" above a view
  // showing one project reads as though the filter hadn't applied — the same reason
  // `/usage`'s empty-state copy changes with its range.
  const filteredTo = selected ? visible[0] : undefined;
  const description = filteredTo
    ? `${filteredTo[1].length} task${filteredTo[1].length === 1 ? "" : "s"} in ${projectById.get(filteredTo[0])!.name}.`
    : taskCount === 0
      ? "Every task you dispatch, grouped by the project it ran in."
      : `${taskCount} task${taskCount === 1 ? "" : "s"} across ${projectCount} project${projectCount === 1 ? "" : "s"}.`;

  return (
    <div className="space-y-6">
      <PageHeader title="Tasks" description={description} />

      {/* Self-guards to nothing when there's only one project to choose between. */}
      <ProjectFilterNav projects={filterOptions} selected={selected} />

      {taskCount === 0 ? (
        <EmptyState
          icon={<ListChecks className="size-6" />}
          title="No tasks yet"
          hint="Open a project and dispatch one — it will show up here alongside every other project's work."
        />
      ) : visible.length === 0 ? (
        // Reachable from a bookmark whose project was removed, or one whose tasks belong to
        // a different workspace. Offer the way back rather than an apparently broken page.
        <EmptyState
          icon={<ListChecks className="size-6" />}
          title="No tasks in that project"
          hint="It may have been removed, or its tasks belong to another workspace."
          action={<ViewAll href="/tasks">Show all tasks</ViewAll>}
        />
      ) : (
        <div className="space-y-5">
          {visible.map(([projectId, list]) => {
            const project = projectById.get(projectId)!;
            // Uncapped once you've asked for a single project — see GROUP_LIMIT.
            const shown = selected ? list : list.slice(0, GROUP_LIMIT);
            const hidden = list.length - shown.length;
            return (
              <CardSection
                key={projectId}
                title={project.name}
                right={
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-fg-faint">
                      {`${list.length} task${list.length === 1 ? "" : "s"}`}
                    </span>
                    <ViewAll href={`/projects/${projectId}`}>Open project</ViewAll>
                  </div>
                }
              >
                {/* No project cell — the card's heading already names it. */}
                <TaskList history={shown} namespaceById={namespaceById} />
                {hidden > 0 && (
                  <p className="border-t border-line pt-3 text-xs text-fg-faint">
                    {`${hidden} older task${hidden === 1 ? "" : "s"} in this project — `}
                    <Link
                      href={`/tasks?project=${encodeURIComponent(projectId)}`}
                      className="text-accent hover:text-accent-hover"
                    >
                      show all
                    </Link>
                  </p>
                )}
              </CardSection>
            );
          })}
        </div>
      )}
    </div>
  );
}
