import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { agents, projects, tasks } from "@/lib/db/schema";
import { PUBLIC_RUNNER_URL } from "@/lib/config";
import { TaskLiveView } from "@/components/TaskLiveView";

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

  return (
    <div>
      {project && (
        <Link
          href={`/projects/${project.id}`}
          className="text-sm text-neutral-400 hover:text-white"
        >
          ← {project.name}
        </Link>
      )}
      <div className="mt-2 mb-5">
        <h1 className="font-mono text-xl text-sky-300">
          /{agent?.namespace ?? "?"}:{task.command}
        </h1>
        {task.requestText && (
          <p className="mt-1 text-neutral-300">{task.requestText}</p>
        )}
        <p className="mt-1 font-mono text-xs text-neutral-500">
          {project?.path}
          {task.branch ? ` · branch ${task.branch}` : ""}
        </p>
      </div>

      <TaskLiveView
        taskId={task.id}
        runnerUrl={PUBLIC_RUNNER_URL}
        initialStatus={task.status}
      />

      {task.error && (
        <p className="mt-4 rounded-lg border border-red-900 bg-red-950/40 px-3 py-2 text-sm text-red-300">
          {task.error}
        </p>
      )}
    </div>
  );
}
