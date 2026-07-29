import Link from "next/link";
import { notFound } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { ArrowLeft, Boxes, FolderGit2, GitBranch, Users } from "lucide-react";
import { db } from "@/lib/db";
import { tasks } from "@/lib/db/schema";
import { syncAgents } from "@/lib/discovery/agents";
import { isAgentOnboarded, refreshProject } from "@/lib/discovery/projects";
import { gitBranchInfo, gitChanges } from "@/lib/git";
import { resolveMembers } from "@/lib/workspace";
import { AgentContributors } from "@/components/AgentContributors";
import { AtAGlance } from "@/components/AtAGlance";
import { SourceControl } from "@/components/SourceControl";
import { TaskHistory } from "@/components/TaskHistory";
import { NewTaskForm } from "@/components/NewTaskForm";
import { ProjectName } from "@/components/ProjectName";
import { ProjectActions } from "@/components/ProjectActions";
import { CardSection, Chip } from "@/components/ui-cards";
import { ACTIVE_STATUSES } from "@/lib/ui";

export const dynamic = "force-dynamic";

export default async function ProjectDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
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
    .where(eq(tasks.projectId, id))
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
        <ProjectActions projectId={project.id} />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* New task */}
        <CardSection
          title="New task"
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

        <TaskHistory
          history={history}
          namespaceById={namespaceById}
          className="lg:col-span-2"
        />
      </div>
    </div>
  );
}
