import Link from "next/link";
import { and, desc, inArray } from "drizzle-orm";
import { AlertTriangle, ClipboardList, FolderGit2 } from "lucide-react";
import { db } from "@/lib/db";
import { projects, tasks } from "@/lib/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { ownedBy } from "@/lib/task-access";
import { loadProjectBacklog, openBacklogCounts } from "@/lib/backlog";
import { parallelOffer } from "@/lib/dispatch";
import { listFeatures } from "@/lib/features";
import { groupByFeature, isOpenBacklogStatus } from "@/lib/ui";
import { AddBacklogItem } from "@/components/AddBacklogItem";
import { BacklogItemRow, type BacklogRowItem } from "@/components/BacklogItemRow";
import { FeatureGroup, type FeatureLite } from "@/components/FeatureGroup";
import { ProjectFilterNav } from "@/components/ProjectFilterNav";
import { TokenNudge } from "@/components/TokenNudge";
import { CardSection, EmptyState, PageHeader, ViewAll } from "@/components/ui-cards";

export const dynamic = "force-dynamic";

/**
 * Rows per section before the rest is disclosed rather than rendered.
 *
 * A project may hold up to 1 000 open items (`MAX_ITEMS_PER_PROJECT`), and every row carries
 * its own status control — so an uncapped list is a real cost on a page whose job is to be
 * scanned. `?all=1` lifts it, the same "disclose, never truncate silently" rule the Tasks
 * page and `ProjectSpendCard` follow.
 */
const SECTION_LIMIT = 50;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * What a section renders: the row's own props plus the feature it is grouped under.
 *
 * `feature` is kept out of `BacklogRowItem` on purpose — inside a feature group the heading
 * already names it, so the row would be repeating its group's own label on every line. The
 * grouping is the page's business; the row's is the item.
 */
type BacklogSectionItem = BacklogRowItem & { feature: FeatureLite | null };

export default async function BacklogPage({
  searchParams,
}: {
  // Async in Next 16 — see node_modules/next/dist/docs/.../file-conventions/page.md.
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const user = await getCurrentUser();
  const projectList = db
    .select()
    .from(projects)
    .orderBy(desc(projects.createdAt))
    .all();

  if (projectList.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Backlog"
          description="Planned work per project — the pm agent's specs, plus anything you add by hand."
        />
        <EmptyState
          icon={<FolderGit2 className="size-6" />}
          title="No projects yet"
          hint="A backlog belongs to a project. Add a local folder first and its planned work will show up here."
          action={<ViewAll href="/projects">Add a project</ViewAll>}
        />
      </div>
    );
  }

  const params = await searchParams;
  // A malformed `?project=` (an array from a repeated param, an empty string) falls back to
  // the default view — the lenient-parse rule from `/usage`. An id that simply matches
  // nothing is kept, so the empty state can explain itself rather than silently showing a
  // different project than the one the bookmark named.
  const requested = typeof params.project === "string" && params.project ? params.project : null;
  const project = requested
    ? (projectList.find((p) => p.id === requested) ?? null)
    : projectList[0];
  const showAll = params.all === "1";

  // Every project is offered, not just the ones with items: a project whose specs have never
  // been read is exactly where you'd go to import them.
  const counts = openBacklogCounts();
  const projectOptions = projectList.map((p) => ({
    id: p.id,
    name: p.name,
    count: counts[p.id],
  }));
  const projectNav = (
    <ProjectFilterNav
      projects={projectOptions}
      selected={project?.id ?? requested}
      basePath="/backlog"
      showAll={false}
      unit="open item"
      ariaLabel="Choose a project"
    />
  );

  if (!project) {
    return (
      <div className="space-y-6">
        <PageHeader title="Backlog" description="Planned work, project by project." />
        {projectNav}
        <EmptyState
          icon={<ClipboardList className="size-6" />}
          title="That project isn't registered any more"
          hint="It may have been removed from the platform. Pick another project above."
          action={<ViewAll href="/backlog">Show the first project</ViewAll>}
        />
      </div>
    );
  }

  // Reading the backlog is what keeps it current: this syncs the project's `.pm/tasks/`
  // specs and reflects finished runs, exactly as `GET /api/projects/:id/backlog` does —
  // same function, so the page and the API can't disagree about the same folder.
  const { items, warnings } = loadProjectBacklog(project);
  const open = items.filter((i) => isOpenBacklogStatus(i.status));
  const closed = items.filter((i) => !isOpenBacklogStatus(i.status));

  // The backlog is shared with everyone on this install, but a task isn't: `/tasks/<id>`
  // answers 404 for a run that isn't yours. So offer the link only where it can work.
  const linkedIds = items
    .map((i) => i.linkedTask?.id)
    .filter((id): id is string => id !== undefined);
  const ownLinkedTasks = new Set(
    linkedIds.length > 0
      ? db
          .select({ id: tasks.id })
          .from(tasks)
          .where(and(inArray(tasks.id, linkedIds), ownedBy(user.id)))
          .all()
          .map((r) => r.id)
      : [],
  );

  // Whether a row offers "Parallel" beside its Run button — a busy checkout, a plain git repo,
  // not a workspace. Same helper as the project page's composer, so the two can't offer the
  // choice on different terms, and same snapshot caveat: it is read at render, so a checkout
  // that becomes busy after this page painted isn't offered until the next load.
  //
  // `isGit`/`isWorkspace` come from the row here, not from a disk re-derive: this page never
  // calls `refreshProject` (the project page does), so a repo that stopped being one since it
  // was registered can still be offered the choice. The dispatch refuses it in that case, which
  // is the honest answer — the alternative is a `git` stat on every backlog load.
  const offerParallel = parallelOffer(project);

  // For the Add-item dialog's feature picker. A plain read: the backlog load above is what
  // *derives* features from `.pm/tasks/`, so by here they already exist.
  const featureList = listFeatures(project.id);

  const description =
    items.length === 0
      ? `Nothing planned in ${project.name} yet.`
      : `${plural(open.length, "open item")} in ${project.name}${
          closed.length > 0 ? `, and ${closed.length} closed` : ""
        }.`;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Backlog"
        description={description}
        actions={
          <>
            <AddBacklogItem
              projectId={project.id}
              projectName={project.name}
              features={featureList}
            />
            <ViewAll href={`/projects/${project.id}`}>Open project</ViewAll>
          </>
        }
      />

      {projectNav}

      <TokenNudge />

      {warnings && warnings.length > 0 && (
        <div className="flex items-start gap-2.5 rounded-xl border border-warn-line bg-warn-soft px-4 py-3">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden="true" />
          <ul className="min-w-0 space-y-1 text-xs text-warn">
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {items.length === 0 ? (
        <EmptyState
          icon={<ClipboardList className="size-6" />}
          title="Nothing planned yet"
          hint={`Task specs the pm agent writes into .pm/tasks/ inside ${project.name} appear here on their own. You can also add an item by hand.`}
        />
      ) : (
        <div className="space-y-5">
          <Section
            title="Open"
            items={open}
            projectId={project.id}
            ownLinkedTasks={ownLinkedTasks}
            showAll={showAll}
            parallelOffer={offerParallel}
            emptyMessage="Nothing open — every item here is done or cancelled."
          />
          {closed.length > 0 && (
            <Section
              title="Done & cancelled"
              items={closed}
              projectId={project.id}
              ownLinkedTasks={ownLinkedTasks}
              showAll={showAll}
              parallelOffer={offerParallel}
            />
          )}
          <p className="text-xs text-fg-faint">
            A status you set here stays put: neither a re-read of the spec file nor a later
            run will move it again.
          </p>
        </div>
      )}
    </div>
  );
}

function Section({
  title,
  items,
  projectId,
  ownLinkedTasks,
  showAll,
  parallelOffer,
  emptyMessage,
}: {
  title: string;
  items: BacklogSectionItem[];
  projectId: string;
  ownLinkedTasks: Set<string>;
  showAll: boolean;
  /** Whether each row offers to isolate its run instead of queueing (see the page above). */
  parallelOffer: boolean;
  emptyMessage?: string;
}) {
  const shown = showAll ? items : items.slice(0, SECTION_LIMIT);
  const hidden = items.length - shown.length;

  // Grouped *after* the cap, so a group's count always describes the rows under it rather than
  // a truncated view of them — the "N more items" disclosure below still speaks for the rest.
  //
  // The feature travels on the item itself (`listBacklog` joins it), so there is no lookup map
  // here and nothing that can be missing from one — unlike the task lists, whose rows carry
  // only a `featureId`.
  const groups = groupByFeature(shown, (i) => i.feature);

  const rows = (list: BacklogSectionItem[]) => (
    <ul>
      {list.map((item) => (
        <BacklogItemRow
          key={item.id}
          projectId={projectId}
          item={item}
          canOpenLinkedTask={
            item.linkedTask !== null && ownLinkedTasks.has(item.linkedTask.id)
          }
          parallelOffer={parallelOffer}
        />
      ))}
    </ul>
  );

  return (
    <CardSection
      title={title}
      right={<span className="text-xs text-fg-faint">{plural(items.length, "item")}</span>}
    >
      {items.length === 0 ? (
        <p className="text-sm text-fg-faint">{emptyMessage ?? "Nothing here."}</p>
      ) : groups ? (
        <div className="space-y-4">
          {groups.map((g) => (
            <FeatureGroup
              key={g.feature?.id ?? "__ungrouped"}
              feature={g.feature}
              count={g.rows.length}
              unit="item"
              // An item's merge state is its *run's*: an item never merges, the task
              // dispatched from it does. Items never run show nothing, which is right — they
              // have no branch yet.
              mergeStates={g.rows.map((i) => i.linkedTask?.mergeState)}
            >
              {rows(g.rows)}
            </FeatureGroup>
          ))}
        </div>
      ) : (
        rows(shown)
      )}
      {hidden > 0 && (
        <p className="border-t border-line pt-3 text-xs text-fg-faint">
          {`${plural(hidden, "more item")} in this section — `}
          <Link
            href={`/backlog?project=${encodeURIComponent(projectId)}&all=1`}
            className="text-accent hover:text-accent-hover"
          >
            show all
          </Link>
        </p>
      )}
    </CardSection>
  );
}
