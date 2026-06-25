import Link from "next/link";
import { notFound } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import {
  Activity,
  ArrowLeft,
  Boxes,
  FileDiff,
  FolderGit2,
  GitBranch,
  GitCommitHorizontal,
  Users,
} from "lucide-react";
import { db } from "@/lib/db";
import { tasks } from "@/lib/db/schema";
import { syncAgents } from "@/lib/discovery/agents";
import { isAgentOnboarded, refreshProject } from "@/lib/discovery/projects";
import { gitBranchInfo, gitChanges } from "@/lib/git";
import { resolveMembers } from "@/lib/workspace";
import { AgentContributors } from "@/components/AgentContributors";
import { ChangesList } from "@/components/ChangesList";
import { GitControls } from "@/components/GitControls";
import { WorkspaceSourceControl } from "@/components/WorkspaceSourceControl";
import { NewTaskForm } from "@/components/NewTaskForm";
import { ProjectActions } from "@/components/ProjectActions";
import { StatusBadge } from "@/components/StatusBadge";
import { card, Chip, Fact, Tile } from "@/components/ui-cards";
import { ACTIVE_STATUSES, timeAgo } from "@/lib/ui";

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
    commands: a.commands,
  }));

  const history = db
    .select()
    .from(tasks)
    .where(eq(tasks.projectId, id))
    .orderBy(desc(tasks.createdAt))
    .all();

  // Agents that have contributed (run ≥1 task here), most-recent first.
  const contributors = [
    ...new Set(
      history
        .map((t) => agents.find((a) => a.id === t.agentId)?.namespace)
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
        className="inline-flex items-center gap-1.5 text-sm text-neutral-400 hover:text-white"
      >
        <ArrowLeft className="size-4" /> Projects
      </Link>

      {/* Project header */}
      <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{project.name}</h1>
          <div className="mt-2.5 flex flex-wrap items-center gap-2.5 text-xs">
            <span className="inline-flex items-center gap-1.5 font-mono text-neutral-500">
              <FolderGit2 className="size-3.5" /> {project.path}
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
                <Users className="size-3.5 text-neutral-500" />
                <AgentContributors namespaces={contributors} size={24} />
              </span>
            )}
          </div>
        </div>
        <ProjectActions projectId={project.id} />
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        {/* New task */}
        <section className={`${card} lg:col-span-2`}>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-semibold">New task</h2>
            <span className="text-xs text-neutral-500">
              Issue a command to an agent
            </span>
          </div>
          <NewTaskForm
            projectId={project.id}
            agents={agents}
            onboardedByAgent={onboardedByAgent}
          />
        </section>

        {/* At a glance */}
        <section className={card}>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-semibold">At a glance</h2>
            <Activity className="size-4 text-neutral-500" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Tile value={String(total)} label="Tasks run" />
            <Tile
              value={total ? `${successRate}%` : "—"}
              label="Success rate"
              tone="ok"
            />
          </div>
          <ul className="mt-4 flex flex-col">
            {isWs ? (
              <Fact icon={<Boxes className="size-3.5" />} tag={`${members.length}`}>
                Workspace of{" "}
                <b className="text-neutral-200">{members.length}</b> member repos
              </Fact>
            ) : (
              branchInfo && (
                <Fact
                  icon={<GitBranch className="size-3.5" />}
                  tag={aheadBehind ?? undefined}
                  tagTone={aheadBehind === "up to date" ? "ok" : "warn"}
                >
                  {branchInfo.tracking ? (
                    <>
                      Tracking{" "}
                      <b className="text-neutral-200">{branchInfo.tracking}</b>
                    </>
                  ) : (
                    "No upstream branch set"
                  )}
                </Fact>
              )
            )}
            <Fact
              icon={<FileDiff className="size-3.5" />}
              tag={changedFiles ? "uncommitted" : "clean"}
              tagTone={changedFiles ? "warn" : "ok"}
            >
              {changedFiles ? (
                <>
                  <b className="text-neutral-200">{changedFiles}</b> file
                  {changedFiles === 1 ? "" : "s"} changed
                  {isWs ? " across repos" : ""}
                </>
              ) : (
                "Working tree clean"
              )}
            </Fact>
            <Fact
              icon={<GitCommitHorizontal className="size-3.5" />}
              tag={inProgress ? "running" : undefined}
              tagTone="warn"
            >
              <b className="text-neutral-200">{inProgress}</b> task
              {inProgress === 1 ? "" : "s"} in progress
            </Fact>
          </ul>
        </section>

        {/* Source control — single repo, or per-member tabs for a workspace */}
        {(isWs || branchInfo) && (
          <section className={card}>
            <h2 className="mb-4 text-base font-semibold">Source control</h2>
            {isWs ? (
              <WorkspaceSourceControl projectId={project.id} members={members} />
            ) : (
              branchInfo && (
                <>
                  <GitControls projectId={project.id} info={branchInfo} />
                  <div className="mt-4 border-t border-neutral-800 pt-4">
                    <div className="mb-2 inline-flex items-center gap-2 text-sm font-medium text-neutral-300">
                      <FileDiff className="size-4 text-neutral-500" />
                      Changes
                    </div>
                    {changes && changes.files.length > 0 ? (
                      <>
                        <div className="scroll-thin max-h-72 overflow-auto">
                          <ChangesList projectId={project.id} changes={changes} />
                        </div>
                        <p className="mt-3 text-xs text-neutral-500">
                          Run{" "}
                          <span className="font-mono text-sky-300">/swe:ship</span>{" "}
                          to commit these changes and open a PR.
                        </p>
                      </>
                    ) : (
                      <p className="text-sm text-neutral-500">
                        Working tree clean.
                      </p>
                    )}
                  </div>
                </>
              )
            )}
          </section>
        )}

        {/* Task history */}
        <section className={`${card} lg:col-span-2`}>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-base font-semibold">Task history</h2>
            <span className="text-xs text-neutral-500">
              {total} task{total === 1 ? "" : "s"}
            </span>
          </div>
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
                    className="flex items-center gap-4 rounded-lg px-2 py-3 hover:bg-white/2.5"
                  >
                    <span className="min-w-28 shrink-0 font-mono text-sm text-sky-300">
                      /{agents.find((a) => a.id === t.agentId)?.namespace ?? "?"}:
                      {t.command}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm text-neutral-200">
                      {t.requestText || (
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
        </section>
      </div>
    </div>
  );
}
