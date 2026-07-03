import Link from "next/link";
import { desc } from "drizzle-orm";
import type { ReactNode } from "react";
import {
  Activity,
  ArrowRight,
  Boxes,
  Clock,
  FolderGit2,
  ListChecks,
} from "lucide-react";
import { db } from "@/lib/db";
import { projects, tasks } from "@/lib/db/schema";
import { syncAgents } from "@/lib/discovery/agents";
import { Avatar } from "@/components/AgentAvatar";
import { AgentContributors } from "@/components/AgentContributors";
import { StatusBadge } from "@/components/StatusBadge";
import { card } from "@/components/ui-cards";
import { ACTIVE_STATUSES, timeAgo } from "@/lib/ui";

export const dynamic = "force-dynamic";

export default function Dashboard() {
  const agentList = syncAgents();
  const projectList = db.select().from(projects).all();
  const allTasks = db.select().from(tasks).orderBy(desc(tasks.createdAt)).all();
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

  const agentName = (id: string) =>
    agentList.find((a) => a.id === id)?.namespace ?? "?";
  const projectName = (id: string) =>
    projectList.find((p) => p.id === id)?.name ?? "?";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="mt-1 text-sm text-neutral-400">
          Overview of your agents, projects, and recent activity.
        </p>
      </div>

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Agents */}
        <section className={card}>
          <CardHead title="Agents" href="/agents" linkLabel="View all" />
          {agentList.length === 0 ? (
            <Empty>No agents discovered. Install a Claude Code plugin.</Empty>
          ) : (
            <ul className="space-y-2">
              {agentList.map((a) => (
                <li key={a.id}>
                  <Link
                    href={`/agents/${encodeURIComponent(a.id)}`}
                    className="flex items-center gap-3 rounded-xl border border-neutral-800 bg-neutral-900/60 p-3 hover:border-neutral-700 hover:bg-neutral-900"
                  >
                    <Avatar namespace={a.namespace} size={40} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 font-mono text-sm text-sky-300">
                        /{a.namespace}
                        {a.version && (
                          <span className="text-xs font-normal text-neutral-500">
                            v{a.version}
                          </span>
                        )}
                      </div>
                      <div className="truncate text-xs text-neutral-500">
                        {a.commands.length} command
                        {a.commands.length === 1 ? "" : "s"}
                      </div>
                    </div>
                    <span className="shrink-0 text-xs text-neutral-500">
                      {runCount.get(a.id) ?? 0} run
                      {(runCount.get(a.id) ?? 0) === 1 ? "" : "s"}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Projects */}
        <section className={card}>
          <CardHead title="Projects" href="/projects" linkLabel="View all" />
          {projectList.length === 0 ? (
            <Empty>No projects yet. Add a local folder to get started.</Empty>
          ) : (
            <ul className="space-y-2">
              {projectList.slice(0, 6).map((p) => (
                <li key={p.id}>
                  <Link
                    href={`/projects/${p.id}`}
                    className="flex items-center gap-3 rounded-xl border border-neutral-800 bg-neutral-900/60 p-3 hover:border-neutral-700 hover:bg-neutral-900"
                  >
                    <FolderGit2 className="size-4 shrink-0 text-neutral-500" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{p.name}</div>
                      <div className="truncate font-mono text-xs text-neutral-500">
                        {p.path}
                      </div>
                    </div>
                    <AgentContributors namespaces={contributorsOf(p.id)} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* Recent activity */}
      <section className={card}>
        <CardHead title="Recent activity" />
        {recent.length === 0 ? (
          <Empty>No tasks yet. Add a project and dispatch one.</Empty>
        ) : (
          <ul>
            {recent.map((t) => (
              <li
                key={t.id}
                className="border-t border-neutral-800/80 first:border-t-0"
              >
                <Link
                  href={`/tasks/${t.id}`}
                  className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-lg px-2 py-3 hover:bg-white/2.5"
                >
                  <span className="min-w-28 shrink-0 font-mono text-sm text-sky-300">
                    /{agentName(t.agentId)}:{t.command}
                  </span>
                  <span className="hidden min-w-0 flex-1 truncate text-sm text-neutral-300 sm:block">
                    {t.requestText || (
                      <span className="text-neutral-600">no description</span>
                    )}
                  </span>
                  <span className="inline-flex min-w-0 shrink items-center gap-1.5 text-xs text-neutral-500">
                    <FolderGit2 className="size-3.5 shrink-0" />
                    <span className="truncate">{projectName(t.projectId)}</span>
                  </span>
                  <span className="hidden shrink-0 items-center gap-1 text-xs text-neutral-500 md:inline-flex">
                    <Clock className="size-3.5" />
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
  const cls = `${card} flex items-center gap-4 ${href ? "transition-colors hover:border-neutral-700" : ""}`;
  const body = (
    <>
      <div className="grid size-11 shrink-0 place-items-center rounded-xl border border-neutral-800 bg-neutral-900/60 text-neutral-400">
        {icon}
      </div>
      <div>
        <div
          className={`text-2xl font-bold tracking-tight ${tone === "warn" ? "text-amber-400" : ""}`}
        >
          {value}
        </div>
        <div className="text-xs text-neutral-500">{label}</div>
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

function CardHead({
  title,
  href,
  linkLabel,
}: {
  title: string;
  href?: string;
  linkLabel?: string;
}) {
  return (
    <div className="mb-4 flex items-center justify-between">
      <h2 className="text-base font-semibold">{title}</h2>
      {href && (
        <Link
          href={href}
          className="inline-flex items-center gap-1 text-xs text-sky-400 hover:text-sky-300"
        >
          {linkLabel ?? "View all"} <ArrowRight className="size-3.5" />
        </Link>
      )}
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="py-3 text-sm text-neutral-400">{children}</p>;
}
