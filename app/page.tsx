import Link from "next/link";
import { desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { projects, tasks } from "@/lib/db/schema";
import { syncAgents } from "@/lib/discovery/agents";
import { StatusBadge } from "@/components/StatusBadge";
import { timeAgo } from "@/lib/ui";

export const dynamic = "force-dynamic";

export default function Dashboard() {
  const agentList = syncAgents();
  const projectList = db.select().from(projects).all();
  const recent = db
    .select()
    .from(tasks)
    .orderBy(desc(tasks.createdAt))
    .limit(8)
    .all();

  const agentName = (id: string) =>
    agentList.find((a) => a.id === id)?.namespace ?? "?";
  const projectName = (id: string) =>
    projectList.find((p) => p.id === id)?.name ?? "?";

  return (
    <div className="space-y-10">
      <section>
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="mt-1 text-sm text-neutral-400">
          {agentList.length} agent{agentList.length === 1 ? "" : "s"} ·{" "}
          {projectList.length} project{projectList.length === 1 ? "" : "s"}
        </p>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-medium">Agents</h2>
          <Link href="/agents" className="text-sm text-sky-400 hover:underline">
            View all →
          </Link>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {agentList.map((a) => (
            <Link
              key={a.id}
              href={`/agents/${encodeURIComponent(a.id)}`}
              className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4 hover:border-neutral-700"
            >
              <div className="font-mono text-sm text-sky-400">
                /{a.namespace}
              </div>
              <div className="mt-1 text-xs text-neutral-500">
                {a.commands.length} commands
              </div>
            </Link>
          ))}
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-medium">Recent tasks</h2>
          <Link
            href="/projects"
            className="text-sm text-sky-400 hover:underline"
          >
            Projects →
          </Link>
        </div>
        {recent.length === 0 ? (
          <p className="text-sm text-neutral-400">
            No tasks yet. Add a project and dispatch one.
          </p>
        ) : (
          <div className="grid gap-2">
            {recent.map((t) => (
              <Link
                key={t.id}
                href={`/tasks/${t.id}`}
                className="flex items-center justify-between rounded-lg border border-neutral-800 bg-neutral-900/40 p-3 hover:border-neutral-700"
              >
                <div className="min-w-0">
                  <span className="font-mono text-sm text-sky-300">
                    /{agentName(t.agentId)}:{t.command}
                  </span>
                  <span className="ml-2 text-sm text-neutral-400">
                    {projectName(t.projectId)}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="text-xs text-neutral-500">
                    {timeAgo(t.createdAt)}
                  </span>
                  <StatusBadge status={t.status} />
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
