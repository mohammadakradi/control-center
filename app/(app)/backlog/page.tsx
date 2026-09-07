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
import {
  groupByFeature,
  isOpenBacklogStatus,
  featureFilterHref,
  isOpenFeatureStatus,
  parseFeatureFilter,
  splitFeaturesByStatus,
  FEATURE_FILTER_PARAM,
  type FeatureFilter,
} from "@/lib/ui";
import { FeatureStatusNav } from "@/components/FeatureStatusNav";
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
  //
  // Handed over **unfiltered** on purpose. `featureOptions` already drops everything but the
  // active features — filing new work under a closed one would quietly reopen something every
  // list shows as finished — so filtering here too would only mean the picker's contents
  // changed with the page's view setting, which is not a thing a form should do.
  const featureList = listFeatures(project.id);

  // Which features the groups below show. Same `?features=` param and the same lenient parse as
  // the project page, so one bookmark means the same thing on both.
  const featureFilter = parseFeatureFilter(params[FEATURE_FILTER_PARAM]);
  const { active: activeFeatures, closed: closedFeatures } =
    splitFeaturesByStatus(featureList);
  const featureNav = (
    <FeatureStatusNav
      basePath="/backlog"
      params={params}
      filter={featureFilter}
      activeCount={activeFeatures.length}
      closedCount={closedFeatures.length}
      label="Features"
    />
  );

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

      {/* Two navs, one row of controls: which project, then which of its features. The feature
          one renders nothing until this project has closed a feature out, so most installs see
          exactly the row they saw before. */}
      {projectNav}
      {featureNav}

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
            featureFilter={featureFilter}
            params={params}
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
              featureFilter={featureFilter}
              params={params}
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
  featureFilter,
  params,
  parallelOffer,
  emptyMessage,
}: {
  title: string;
  items: BacklogSectionItem[];
  projectId: string;
  ownLinkedTasks: Set<string>;
  showAll: boolean;
  /** Which features this section shows. Ungrouped items are in every view. */
  featureFilter: FeatureFilter;
  /** The page's current query, so the disclosure's link keeps the project and the row cap. */
  params: Record<string, string | string[] | undefined>;
  /** Whether each row offers to isolate its run instead of queueing (see the page above). */
  parallelOffer: boolean;
  emptyMessage?: string;
}) {
  // Filtered **before** the cap, not after: a closed feature's fifty items used to eat the row
  // budget of a section whose live work then showed as "N more items". An item with no feature
  // at all is in every view — the filter is about features, and ungrouped work has none to
  // judge it by.
  const wantsOpenFeature = featureFilter === "active";
  const visible = items.filter(
    (i) => !i.feature || isOpenFeatureStatus(i.feature.status) === wantsOpenFeature,
  );
  const inOtherView = items.length - visible.length;

  const shown = showAll ? visible : visible.slice(0, SECTION_LIMIT);
  const hidden = visible.length - shown.length;

  // Both disclosure links go through `featureFilterHref`, which preserves the rest of the query.
  // The project is pinned explicitly because the default view carries no `?project=` and these
  // links must not resolve to "whichever project is first" once one is clicked.
  const otherViewHref = featureFilterHref(
    "/backlog",
    { ...params, project: projectId },
    wantsOpenFeature ? "closed" : "active",
  );
  const showAllHref = featureFilterHref(
    "/backlog",
    { ...params, project: projectId, all: "1" },
    featureFilter,
  );

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
      ) : visible.length === 0 ? (
        // Everything in this section belongs to a feature the current view hides. The section's
        // own empty message would be a lie here ("Nothing open" when there are open items), so
        // the view says what it is doing and offers the way out.
        <p className="text-sm text-fg-faint">
          {`${plural(items.length, "item")} here ${items.length === 1 ? "is" : "are"} in ${
            wantsOpenFeature ? "closed features" : "active features"
          } — `}
          <Link href={otherViewHref} className="text-accent hover:text-accent-hover">
            {wantsOpenFeature ? "show the closed ones" : "show the active ones"}
          </Link>
        </p>
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
      {/* Everything this section is holding back, in **one** ruled block. Two rules, because
          the two disclosures can be true at once: a section can be both over the row cap and
          filtered, and giving each its own `border-t` drew two dividers back to back.

          Hiding rows is only safe if the reader can see that they exist. The filter line
          deliberately counts *items* rather than features — what a reader of this page wants to
          know is how much work is off-screen — and the section's own "N items" heading count
          stays the true total, so the two can't disagree. */}
      {(hidden > 0 || (inOtherView > 0 && visible.length > 0)) && (
        <div className="space-y-1.5 border-t border-line pt-3 text-xs text-fg-faint">
          {hidden > 0 && (
            <p>
              {`${plural(hidden, "more item")} in this section — `}
              {/* Built through `featureFilterHref` rather than from scratch, or lifting the cap
                  would drop `?features=` and throw the reader back to the active view. */}
              <Link href={showAllHref} className="text-accent hover:text-accent-hover">
                show all
              </Link>
            </p>
          )}
          {inOtherView > 0 && visible.length > 0 && (
            <p>
              {`${plural(inOtherView, "item")} in ${
                wantsOpenFeature ? "closed features" : "active features"
              } — `}
              <Link href={otherViewHref} className="text-accent hover:text-accent-hover">
                {wantsOpenFeature ? "show the closed ones" : "show the active ones"}
              </Link>
            </p>
          )}
        </div>
      )}
    </CardSection>
  );
}
