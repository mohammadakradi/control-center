import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import {
  ArrowLeft,
  Clock,
  Cpu,
  FolderGit2,
  GitBranch,
  Paperclip,
  TriangleAlert,
} from "lucide-react";
import { db } from "@/lib/db";
import { agents, projects, taskEvents, tasks } from "@/lib/db/schema";
import { PUBLIC_RUNNER_URL } from "@/lib/config";
import { Avatar } from "@/components/AgentAvatar";
import { TaskLiveView } from "@/components/TaskLiveView";
import { RunDuration } from "@/components/RunDuration";
import { Chip } from "@/components/ui-cards";
import { ACTIVE_STATUSES, timeAgo } from "@/lib/ui";

export const dynamic = "force-dynamic";

export default async function TaskPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const task = db.select().from(tasks).where(eq(tasks.id, id)).get();
  if (!task) notFound();
  const project = db
    .select()
    .from(projects)
    .where(eq(projects.id, task.projectId))
    .get();
  const agent = db.select().from(agents).where(eq(agents.id, task.agentId)).get();

  // Server-render the persisted transcript so a completed task always shows its
  // proposal/report, even if the live runner daemon is unreachable.
  const events = db
    .select()
    .from(taskEvents)
    .where(eq(taskEvents.taskId, id))
    .orderBy(asc(taskEvents.id))
    .all()
    .map((e) => ({
      id: e.id,
      type: e.type,
      payload: e.payload,
      ts: e.ts instanceof Date ? e.ts.getTime() : Number(e.ts),
    }));

  return (
    <div>
      <Link
        href={project ? `/projects/${project.id}` : "/"}
        className="inline-flex items-center gap-1.5 text-sm text-neutral-400 hover:text-white"
      >
        <ArrowLeft className="size-4" /> {project?.name ?? "Back"}
      </Link>

      {/* Task header */}
      <div className="mt-3 mb-6 flex items-start gap-4">
        {agent && <Avatar namespace={agent.namespace} size={56} />}
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight wrap-break-word text-neutral-100 sm:text-2xl">
            {task.title || task.requestText || `/${agent?.namespace ?? "?"}:${task.command}`}
          </h1>
          <p className="mt-1 font-mono text-sm text-sky-300/90">
            /{agent?.namespace ?? "?"}:{task.command}
            {task.agentVersion && (
              <span className="ml-2 text-neutral-500">v{task.agentVersion}</span>
            )}
          </p>
          <div className="mt-2.5 flex flex-wrap items-center gap-2.5 text-xs">
            {project && (
              <Chip icon={<FolderGit2 className="size-3" />}>{project.name}</Chip>
            )}
            {task.branch && (
              <Chip icon={<GitBranch className="size-3" />}>{task.branch}</Chip>
            )}
            {task.model && task.model !== "auto" && (
              <Chip icon={<Cpu className="size-3" />} tone="sky">
                {task.model === "opus" ? "Opus 4.8" : "Sonnet 4.6"}
              </Chip>
            )}
            <Chip icon={<Clock className="size-3" />}>
              {timeAgo(task.createdAt)}
            </Chip>
            {task.attachments?.length > 0 && (
              <Chip icon={<Paperclip className="size-3" />} tone="violet">
                {task.attachments.length} file
                {task.attachments.length === 1 ? "" : "s"}
              </Chip>
            )}
            <RunDuration
              createdAt={task.createdAt.getTime()}
              endedAt={task.endedAt ? task.endedAt.getTime() : null}
              active={ACTIVE_STATUSES.has(task.status)}
            />
          </div>
          {project && (
            <p className="mt-1.5 font-mono text-xs break-all text-neutral-600">
              {project.path}
            </p>
          )}
        </div>
      </div>

      <TaskLiveView
        taskId={task.id}
        runnerUrl={PUBLIC_RUNNER_URL}
        initialStatus={task.status}
        initialEvents={events}
        request={{
          text: task.requestText,
          attachments: (task.attachments ?? []).map((a) => ({
            name: a.name,
            type: a.type,
          })),
        }}
        projectId={task.projectId}
        agentId={task.agentId}
      />

      {task.error && (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          <span>{task.error}</span>
        </div>
      )}
    </div>
  );
}
