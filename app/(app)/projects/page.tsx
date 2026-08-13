import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { FolderGit2 } from "lucide-react";
import { db } from "@/lib/db";
import { agents, projects, tasks } from "@/lib/db/schema";
import { AddProjectForm } from "@/components/AddProjectForm";
import { AgentContributors } from "@/components/AgentContributors";
import { getCurrentUser } from "@/lib/auth";
import { ownedBy } from "@/lib/task-access";
import { Chip, EmptyState, PageHeader } from "@/components/ui-cards";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const user = await getCurrentUser();
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
    .where(ownedBy(user.id))
    .all();
  const contributors = new Map<string, string[]>();
  for (const r of contribRows) {
    const arr = contributors.get(r.projectId) ?? [];
    arr.push(r.namespace);
    contributors.set(r.projectId, arr);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Projects"
        description="A project is a folder on this device that agents can work in. Add one by absolute path."
      />

      <div className="rounded-xl border border-line bg-surface p-4">
        <AddProjectForm />
      </div>

      <div className="grid gap-3">
        {list.length === 0 ? (
          <EmptyState
            icon={<FolderGit2 className="size-6" />}
            title="No projects yet"
            hint="Add a local folder above to give your agents somewhere to work."
          />
        ) : (
          list.map((p) => (
            <Link
              key={p.id}
              href={`/projects/${p.id}`}
              className="flex items-center justify-between rounded-xl border border-line bg-surface p-4 hover:border-line-strong"
            >
              <div className="min-w-0">
                <div className="truncate font-medium">{p.name}</div>
                <div className="truncate font-mono text-xs text-fg-faint">
                  {p.path}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-3 text-xs">
                {p.isWorkspace && (
                  <Chip tone="violet">workspace · {p.members.length}</Chip>
                )}
                <AgentContributors
                  namespaces={contributors.get(p.id) ?? []}
                  ringClass="ring-surface"
                />
              </div>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
