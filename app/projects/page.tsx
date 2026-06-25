import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { agents, projects, tasks } from "@/lib/db/schema";
import { AddProjectForm } from "@/components/AddProjectForm";
import { AgentContributors } from "@/components/AgentContributors";

export const dynamic = "force-dynamic";

export default function ProjectsPage() {
  const list = db
    .select()
    .from(projects)
    .orderBy(desc(projects.createdAt))
    .all();

  // Agents that have contributed to each project (have run ≥1 task there).
  const contribRows = db
    .selectDistinct({ projectId: tasks.projectId, namespace: agents.namespace })
    .from(tasks)
    .innerJoin(agents, eq(tasks.agentId, agents.id))
    .all();
  const contributors = new Map<string, string[]>();
  for (const r of contribRows) {
    const arr = contributors.get(r.projectId) ?? [];
    arr.push(r.namespace);
    contributors.set(r.projectId, arr);
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold">Projects</h1>
      <p className="mt-1 text-sm text-neutral-400">
        Local folders the agent can work in. Add one by absolute path.
      </p>

      <div className="mt-5 rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
        <AddProjectForm />
      </div>

      <div className="mt-6 grid gap-3">
        {list.length === 0 ? (
          <p className="text-neutral-400">No projects yet.</p>
        ) : (
          list.map((p) => (
            <Link
              key={p.id}
              href={`/projects/${p.id}`}
              className="flex items-center justify-between rounded-xl border border-neutral-800 bg-neutral-900/40 p-4 hover:border-neutral-700"
            >
              <div className="min-w-0">
                <div className="truncate font-medium">{p.name}</div>
                <div className="truncate font-mono text-xs text-neutral-500">
                  {p.path}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-3 text-xs">
                {p.isWorkspace && (
                  <span className="rounded-full border border-violet-500/30 bg-violet-500/15 px-2 py-0.5 text-violet-300">
                    workspace · {p.members.length}
                  </span>
                )}
                <AgentContributors
                  namespaces={contributors.get(p.id) ?? []}
                  ringClass="ring-neutral-900"
                />
              </div>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
