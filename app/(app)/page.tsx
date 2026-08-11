import Link from "next/link";
import { desc } from "drizzle-orm";
import type { ReactNode } from "react";
import {
  Activity,
  ArrowRight,
  Boxes,
  FolderGit2,
  ListChecks,
} from "lucide-react";
import { db } from "@/lib/db";
import { projects, tasks } from "@/lib/db/schema";
import { syncAgents } from "@/lib/discovery/agents";
import { Avatar } from "@/components/AgentAvatar";
import { AgentContributors } from "@/components/AgentContributors";
import { TaskList } from "@/components/TaskList";
import { TokenNudge } from "@/components/TokenNudge";
import { card, CardSection, PageHeader } from "@/components/ui-cards";
import { getCurrentUser } from "@/lib/auth";
import { ownedBy } from "@/lib/task-access";
import { ACTIVE_STATUSES } from "@/lib/ui";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  // Sign-in is optional; without one this is the local workspace. Either way the dashboard
  // shows only the caller's own runs.
  const user = await getCurrentUser();
  const agentList = syncAgents();
  const projectList = db.select().from(projects).all();
  const allTasks = db
    .select()
    .from(tasks)
    .where(ownedBy(user.id))
    .orderBy(desc(tasks.createdAt))
    .all();
  const recent = allTasks.slice(0, 8);

  const inProgress = allTasks.filter((t) => ACTIVE_STATUSES.has(t.status)).length;

  const runCount = new Map<string, number>();
  for (const t of allTasks)
    runCount.set(t.agentId, (runCount.get(t.agentId) ?? 0) + 1);

  // Agents that have contributed to each project (have run ≥1 task there).
  const nsOf = (id: string) =>
    agentList.find((a) => a.id === id)?.namespace ?? null;
  const contributors = new Map<string, Set<string>>();
  for (const t of allTasks) {
    const ns = nsOf(t.agentId);
    if (!ns) continue;
    if (!contributors.has(t.projectId)) contributors.set(t.projectId, new Set());
    contributors.get(t.projectId)!.add(ns);
  }
  const contributorsOf = (projectId: string) => [
    ...(contributors.get(projectId) ?? []),
  ];

  // Lookups for the shared task rows: agent id → namespace, project id → name.
  const namespaceById: Record<string, string> = {};
  for (const a of agentList) namespaceById[a.id] = a.namespace;
  const projectNameById: Record<string, string> = {};
  for (const p of projectList) projectNameById[p.id] = p.name;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description="Overview of your agents, projects, and recent activity."
      />

      <TokenNudge />

      {/* Stats */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          icon={<Boxes className="size-5" />}
          value={agentList.length}
          label={`Agent${agentList.length === 1 ? "" : "s"}`}
          href="/agents"
        />
        <Stat
          icon={<FolderGit2 className="size-5" />}
          value={projectList.length}
          label={`Project${projectList.length === 1 ? "" : "s"}`}
          href="/projects"
        />
        <Stat
          icon={<ListChecks className="size-5" />}
          value={allTasks.length}
          label="Tasks run"
        />
        <Stat
          icon={<Activity className="size-5" />}
          value={inProgress}
          label="In progress"
          tone={inProgress ? "warn" : undefined}
        />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Agents */}
        <CardSection title="Agents" right={<ViewAll href="/agents" />}>
          {agentList.length === 0 ? (
            <Empty>No agents discovered. Install a Claude Code plugin.</Empty>
          ) : (
            <ul className="space-y-2">
              {agentList.map((a) => (
                <li key={a.id}>
                  <Link
                    href={`/agents/${encodeURIComponent(a.id)}`}
                    className="flex items-center gap-3 rounded-xl border border-line bg-surface-2 p-3 hover:border-line-strong hover:bg-surface-3"
                  >
                    <Avatar namespace={a.namespace} size={40} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 font-mono text-sm text-accent">
                        /{a.namespace}
                        {a.version && (
                          <span className="text-xs font-normal text-fg-faint">
                            v{a.version}
                          </span>
                        )}
                      </div>
                      <div className="truncate text-xs text-fg-faint">
                        {a.commands.length} command
                        {a.commands.length === 1 ? "" : "s"}
                      </div>
                    </div>
                    <span className="shrink-0 text-xs text-fg-faint">
                      {runCount.get(a.id) ?? 0} run
                      {(runCount.get(a.id) ?? 0) === 1 ? "" : "s"}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardSection>

        {/* Projects */}
        <CardSection title="Projects" right={<ViewAll href="/projects" />}>
          {projectList.length === 0 ? (
            <Empty>No projects yet. Add a local folder to get started.</Empty>
          ) : (
            <ul className="space-y-2">
              {projectList.slice(0, 6).map((p) => (
                <li key={p.id}>
                  <Link
                    href={`/projects/${p.id}`}
                    className="flex items-center gap-3 rounded-xl border border-line bg-surface-2 p-3 hover:border-line-strong hover:bg-surface-3"
                  >
                    <FolderGit2 className="size-4 shrink-0 text-fg-faint" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{p.name}</div>
                      <div className="truncate font-mono text-xs text-fg-faint">
                        {p.path}
                      </div>
                    </div>
                    <AgentContributors namespaces={contributorsOf(p.id)} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardSection>
      </div>

      {/* Recent activity — same rows as project detail and agent detail, plus the project
          each task ran in, since this list spans all of them. */}
      <CardSection title="Recent activity">
        <TaskList
          history={recent}
          namespaceById={namespaceById}
          projectNameById={projectNameById}
          emptyMessage="No tasks yet. Add a project and dispatch one."
        />
      </CardSection>
    </div>
  );
}

function Stat({
  icon,
  value,
  label,
  href,
  tone,
}: {
  icon: ReactNode;
  value: number;
  label: string;
  href?: string;
  tone?: "warn";
}) {
  const cls = `${card} flex items-center gap-4 ${href ? "transition-colors hover:border-line-strong" : ""}`;
  const body = (
    <>
      <div className="grid size-11 shrink-0 place-items-center rounded-xl border border-line bg-surface-2 text-fg-subtle">
        {icon}
      </div>
      <div>
        <div
          className={`text-2xl font-bold tracking-tight ${tone === "warn" ? "text-warn" : ""}`}
        >
          {value}
        </div>
        <div className="text-xs text-fg-faint">{label}</div>
      </div>
    </>
  );
  return href ? (
    <Link href={href} className={cls}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/** `CardSection` header link through to the full list. */
function ViewAll({ href }: { href: string }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1 text-xs text-accent hover:text-accent-hover"
    >
      View all <ArrowRight className="size-3.5" aria-hidden="true" />
    </Link>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="py-3 text-sm text-fg-subtle">{children}</p>;
}
