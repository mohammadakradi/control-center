import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { ownedBy } from "@/lib/task-access";
import { and, desc, eq } from "drizzle-orm";
import {
  ArrowLeft,
  Boxes,
  ClipboardList,
  FolderGit2,
  GitBranch,
  Users,
} from "lucide-react";
import { db } from "@/lib/db";
import { tasks } from "@/lib/db/schema";
import { backlogItemCount } from "@/lib/backlog";
import { parallelOffer } from "@/lib/dispatch";
import { backlogCountsByFeature, listFeatures } from "@/lib/features";
import { FeatureManager } from "@/components/FeatureManager";
import { TaskList } from "@/components/TaskList";
import { syncAgents } from "@/lib/discovery/agents";
import { isAgentOnboarded, refreshProject } from "@/lib/discovery/projects";
import { gitBranchInfo, gitChanges } from "@/lib/git";
import { resolveMembers } from "@/lib/workspace";
import { AgentContributors } from "@/components/AgentContributors";
import { AtAGlance } from "@/components/AtAGlance";
import { SourceControl } from "@/components/SourceControl";
import { NewTaskForm } from "@/components/NewTaskForm";
import { allowedModels } from "@/lib/agent-policy";
import { ProjectName } from "@/components/ProjectName";
import { ProjectActions } from "@/components/ProjectActions";
import { TokenNudge } from "@/components/TokenNudge";
import { CardSection, Chip } from "@/components/ui-cards";
import { buttonClasses } from "@/components/ui/button";
import { featureRowDefaultOpen, featureWorkRows, ACTIVE_STATUSES, UNGROUPED_KEY } from "@/lib/ui";

export const dynamic = "force-dynamic";

export default async function ProjectDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // Only this owner's runs — sign-in is optional, so the alternative is showing a visitor
  // everyone's history.
  const user = await getCurrentUser();
  // Re-derive onboarded/git/workspace from disk so the page reflects reality
  // even after a task (e.g. onboard) changed the working tree.
  const project = refreshProject(id);
  if (!project) notFound();

  const agents = syncAgents().map((a) => ({
    id: a.id,
    namespace: a.namespace,
    name: a.name,
    version: a.version,
    description: a.description,
    commands: a.commands,
  }));

  const history = db
    .select()
    .from(tasks)
    .where(and(eq(tasks.projectId, id), ownedBy(user.id)))
    .orderBy(desc(tasks.createdAt))
    .all();

  // agent id → namespace, for rendering task labels and contributor avatars.
  const namespaceById: Record<string, string> = {};
  for (const a of agents) namespaceById[a.id] = a.namespace;
  // Agents that have contributed (run ≥1 task here), most-recent first.
  const contributors = [
    ...new Set(
      history
        .map((t) => namespaceById[t.agentId])
        .filter((n): n is string => !!n),
    ),
  ];
  // Per-agent onboarding state (presence of each agent's marker file on disk).
  const onboardedByAgent: Record<string, boolean> = {};
  for (const a of agents)
    onboardedByAgent[a.id] = isAgentOnboarded(project.path, a.namespace);

  // Which models each agent may run on (Settings → Agent models), so the picker offers only
  // what the dispatcher would accept. Read here rather than fetched client-side for the same
  // reason as the feature list: this page is already doing a server pass.
  const modelPolicy = Object.fromEntries(
    [...new Set(agents.map((a) => a.namespace))].map((ns) => [ns, allowedModels(ns)]),
  );

  const isWs = project.isWorkspace;
  const members = isWs ? resolveMembers(project) : [];
  // Single-repo source control is shown only for non-workspace projects; a
  // workspace shows per-member controls instead (the root is member ".").
  const branchInfo = project.isGit ? gitBranchInfo(project.path) : null;
  const changes = project.isGit && !isWs ? gitChanges(project.path) : null;

  const total = history.length;
  const done = history.filter((t) => t.status === "done").length;
  const inProgress = history.filter((t) => ACTIVE_STATUSES.has(t.status)).length;
  const successRate = total ? Math.round((done / total) * 100) : 0;

  const changedFiles = isWs
    ? members.reduce((s, m) => s + (m.changes?.files.length ?? 0), 0)
    : (changes?.files.length ?? 0);

  // Open items only, straight from the database — the `.pm/tasks/` scan belongs to the
  // backlog page itself, so opening a project never pays for one.
  const backlogOpen = backlogItemCount(project.id);

  // Whether the composer offers "Run in parallel": a busy checkout, a plain git repo, not a
  // workspace. One definition in `lib/dispatch`, shared with the backlog and a task's file
  // modal and pinned against the dispatch's own refusals — the offer must not drift from what
  // `createAndStartTask` will accept. Only a boolean crosses to the client, so it reveals
  // nothing about whose task is holding the checkout.
  const offerParallel = parallelOffer(project);

  // The project's features — the spine of the card below, and the composer's picker. A plain
  // read: deriving features from `.pm/tasks/` is the backlog load's job, so this page sees
  // whatever the last backlog load derived and never does that filesystem walk itself.
  //
  // No id→feature map any more. The merged card is driven by this list *plus* the task rows
  // (`featureWorkRows`), rather than by resolving each task's `featureId` through a lookup —
  // which is also what lets a feature nothing has run against still get a row.
  const featureList = listFeatures(project.id);

  // Every feature with its own runs, plus the ungrouped remainder — and then three flat maps
  // for the card below, keyed by feature id (or `UNGROUPED_KEY`).
  //
  // **The task lists are rendered here rather than in the card, and that is a privacy decision,
  // not a style one.** `FeatureManager` is a client component, so handing it `TaskRow[]` would
  // serialize *whole rows* across the RSC boundary into the browser — `workdir`, `sessionId`,
  // `requestText`, `error` and all — for a list that renders six fields. The security audit
  // measured exactly that after the first cut of this merge, finding `TaskList`'s code in the
  // client chunks. Passing the already-rendered element instead sends the rendered output and
  // nothing else, which is the standard "client island in a server tree" composition and keeps
  // this page's minimization consistent with `parallelOffer`'s (only a boolean crosses).
  //
  // `openByDefault` is computed here for the same reason: deciding it in the client would mean
  // shipping every task's status to do it.
  const workRows = featureWorkRows(featureList, history, (t) => t.featureId);
  const taskCounts: Record<string, number> = {};
  const taskPanels: Record<string, ReactNode> = {};
  const openByDefault: Record<string, boolean> = {};
  for (const row of workRows) {
    const key = row.feature?.id ?? UNGROUPED_KEY;
    taskCounts[key] = row.tasks.length;
    openByDefault[key] = featureRowDefaultOpen(row);
    if (row.tasks.length > 0) {
      taskPanels[key] = (
        <TaskList
          history={row.tasks}
          namespaceById={namespaceById}
          // Inside a feature the feature branch is the subject; the ungrouped remainder has no
          // branch, so a merge chip there would be describing nothing.
          showMergeState={row.feature !== null}
        />
      );
    }
  }
  // Backlog items per feature, for the management card's counts and its delete confirmation.
  // Items only — a task is private to whoever ran it, so an unscoped count of those on this
  // shared page would disclose that someone else is working on the feature.
  const featureItemCounts = backlogCountsByFeature(project.id);

  const aheadBehind = branchInfo
    ? branchInfo.ahead || branchInfo.behind
      ? `${branchInfo.ahead ? `↑${branchInfo.ahead}` : ""}${branchInfo.behind ? ` ↓${branchInfo.behind}` : ""}`.trim()
      : "up to date"
    : null;

  return (
    <div>
      <Link
        href="/projects"
        className="inline-flex items-center gap-1.5 text-sm text-fg-subtle hover:text-fg-strong"
      >
        <ArrowLeft className="size-4" /> Projects
      </Link>

      {/* Project header */}
      <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 max-w-full">
          <ProjectName projectId={project.id} name={project.name} />
          <div className="mt-2.5 flex flex-wrap items-center gap-2.5 text-xs">
            <span className="inline-flex min-w-0 items-center gap-1.5 font-mono text-fg-faint">
              <FolderGit2 className="size-3.5 shrink-0" />
              <span className="truncate">{project.path}</span>
            </span>
            {project.isGit && !isWs && (
              <Chip icon={<GitBranch className="size-3" />}>
                {branchInfo?.current ?? project.defaultBranch ?? "?"}
              </Chip>
            )}
            {isWs && (
              <Chip icon={<Boxes className="size-3" />} tone="violet">
                workspace · {members.length} repos
              </Chip>
            )}
            {contributors.length > 0 && (
              <span className="inline-flex items-center gap-2">
                <Users className="size-3.5 text-fg-faint" />
                <AgentContributors namespaces={contributors} size={24} />
              </span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-start justify-end gap-2">
          <Link
            href={`/backlog?project=${encodeURIComponent(project.id)}`}
            className={buttonClasses("secondary", "md")}
            title={`Planned work for ${project.name}`}
          >
            <ClipboardList className="size-4" aria-hidden="true" />
            Backlog
            {backlogOpen > 0 && (
              <>
                {/* Bare number, so it's hidden and said in words for a screen reader —
                    same treatment as the project pills. */}
                <span aria-hidden="true" className="text-fg-faint">
                  {backlogOpen}
                </span>
                <span className="sr-only">
                  {`, ${backlogOpen} open item${backlogOpen === 1 ? "" : "s"}`}
                </span>
              </>
            )}
          </Link>
          <ProjectActions projectId={project.id} />
        </div>
      </div>

      <div className="mt-6">
        <TokenNudge />
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* New task */}
        <CardSection
          title="New task"
          // The command palette's "New task in <project>" links here.
          id="new-task"
          className="lg:col-span-2"
          right={
            <span className="text-xs text-fg-faint">
              Issue a command to an agent
            </span>
          }
        >
          <NewTaskForm
            projectId={project.id}
            agents={agents}
            onboardedByAgent={onboardedByAgent}
            parallelOffer={offerParallel}
            features={featureList}
            modelPolicy={modelPolicy}
          />
        </CardSection>

        <AtAGlance
          total={total}
          successRate={successRate}
          inProgress={inProgress}
          changedFiles={changedFiles}
          isWorkspace={isWs}
          memberCount={members.length}
          branchInfo={branchInfo}
          aheadBehind={aheadBehind}
        />

        <SourceControl
          projectId={project.id}
          isWorkspace={isWs}
          members={members}
          branchInfo={branchInfo}
          changes={changes}
        />

        {/* One card, not two. A feature *is* several tasks, so splitting "the groupings" from
            "the runs" made the reader join them up by eye — and the separate history card
            re-derived the same grouping a second time. Now each feature expands to its own
            runs, and the ungrouped remainder is the last row.

            The panels are rendered **here**, on the server, and handed down as elements. See
            `taskPanels` above for why that matters. */}
        <FeatureManager
          projectId={project.id}
          projectName={project.name}
          features={featureList}
          itemCounts={featureItemCounts}
          taskCounts={taskCounts}
          taskPanels={taskPanels}
          openByDefault={openByDefault}
          totalTasks={history.length}
          className="lg:col-span-2"
        />
      </div>
    </div>
  );
}
