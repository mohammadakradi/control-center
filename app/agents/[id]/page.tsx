import Link from "next/link";
import { notFound } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import {
  ArrowLeft,
  Boxes,
  FolderGit2,
  Hash,
  SquareTerminal,
} from "lucide-react";
import { db } from "@/lib/db";
import { agents, projectAgents, projects, tasks } from "@/lib/db/schema";
import { Avatar } from "@/components/AgentAvatar";
import { StatusBadge } from "@/components/StatusBadge";
import { card, Chip, Fact, Tile } from "@/components/ui-cards";
import { timeAgo } from "@/lib/ui";

export const dynamic = "force-dynamic";

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export default async function AgentDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: rawId } = await params;
  // Agent ids contain "@" (e.g. swe@swe-agent-local); the link encodes it, so
  // decode here in case the route param arrives still percent-encoded.
  const id = safeDecode(rawId);
  const agent = db.select().from(agents).where(eq(agents.id, id)).get();
  if (!agent) notFound();

  const connected = db
    .select({ project: projects })
    .from(projectAgents)
    .innerJoin(projects, eq(projectAgents.projectId, projects.id))
    .where(eq(projectAgents.agentId, id))
    .all()
    .map((r) => r.project);

  const runs = db
    .select({ task: tasks, project: projects })
    .from(tasks)
    .innerJoin(projects, eq(tasks.projectId, projects.id))
    .where(eq(tasks.agentId, id))
    .orderBy(desc(tasks.createdAt))
    .all();

  const done = runs.filter((r) => r.task.status === "done").length;
  const successRate = runs.length ? Math.round((done / runs.length) * 100) : 0;

  return (
    <div>
      <Link
        href="/agents"
        className="inline-flex items-center gap-1.5 text-sm text-neutral-400 hover:text-white"
      >
        <ArrowLeft className="size-4" /> Agents
      </Link>

      {/* Header */}
      <div className="mt-3 flex flex-wrap items-center gap-5">
        <Avatar namespace={agent.namespace} size={80} />
        <div className="min-w-0">
          <h1 className="flex flex-wrap items-center gap-2.5 text-3xl font-bold tracking-tight">
            {agent.name}
            {agent.version && (
              <span className="rounded-md border border-neutral-700 bg-neutral-800/60 px-2 py-0.5 font-mono text-sm font-normal text-neutral-400">
                v{agent.version}
              </span>
            )}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2.5 text-xs">
            <Chip icon={<Hash className="size-3" />} tone="sky">
              /{agent.namespace}
            </Chip>
            <Chip icon={<SquareTerminal className="size-3" />}>
              {agent.commands.length} command
              {agent.commands.length === 1 ? "" : "s"}
            </Chip>
            {agent.scope && (
              <Chip icon={<Boxes className="size-3" />}>scope · {agent.scope}</Chip>
            )}
          </div>
        </div>
      </div>

      {agent.description && (
        <p className="mt-4 max-w-3xl leading-relaxed text-neutral-300">
          {agent.description}
        </p>
      )}

      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        {/* At a glance */}
        <section className={card}>
          <h2 className="mb-4 text-base font-semibold">At a glance</h2>
          <div className="grid grid-cols-2 gap-3">
            <Tile value={String(agent.commands.length)} label="Commands" />
            <Tile value={String(connected.length)} label="Projects" />
            <Tile value={String(runs.length)} label="Total runs" />
            <Tile
              value={runs.length ? `${successRate}%` : "—"}
              label="Success rate"
              tone="ok"
            />
          </div>
          <ul className="mt-4 flex flex-col">
            <Fact icon={<FolderGit2 className="size-3.5" />}>
              <span className="break-all font-mono text-xs">
                {agent.sourcePath}
              </span>
            </Fact>
            <Fact icon={<Boxes className="size-3.5" />} tag={agent.scope ?? "—"}>
              Plugin <span className="font-mono text-neutral-300">{agent.pluginId}</span>
            </Fact>
          </ul>
        </section>

        {/* Connected projects */}
        <section className={card}>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-semibold">Connected projects</h2>
            <span className="text-xs text-neutral-500">{connected.length}</span>
          </div>
          {connected.length === 0 ? (
            <p className="py-2 text-sm text-neutral-400">
              Not connected to any project yet. Open a project and run a task with
              this agent.
            </p>
          ) : (
            <ul className="space-y-2">
              {connected.map((p) => (
                <li key={p.id}>
                  <Link
                    href={`/projects/${p.id}`}
                    className="flex items-center gap-3 rounded-xl border border-neutral-800 bg-neutral-900/60 px-3.5 py-3 hover:border-neutral-700 hover:bg-neutral-900"
                  >
                    <FolderGit2 className="size-4 shrink-0 text-neutral-500" />
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{p.name}</div>
                      <div className="truncate font-mono text-xs text-neutral-500">
                        {p.path}
                      </div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Commands */}
        <section className={`${card} lg:col-span-2`}>
          <h2 className="mb-4 inline-flex items-center gap-2 text-base font-semibold">
            <SquareTerminal className="size-4 text-neutral-500" />
            Commands
          </h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {agent.commands.map((c) => (
              <div
                key={c.full}
                className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-3.5"
              >
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="font-mono text-sm text-sky-300">{c.full}</span>
                  {c.argumentHint && (
                    <span className="font-mono text-xs text-neutral-500">
                      {c.argumentHint}
                    </span>
                  )}
                </div>
                {c.description && (
                  <p className="mt-1.5 text-sm leading-relaxed text-neutral-400">
                    {c.description}
                  </p>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* Recent runs */}
        <section className={`${card} lg:col-span-2`}>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-base font-semibold">Recent runs</h2>
            <span className="text-xs text-neutral-500">
              {runs.length} run{runs.length === 1 ? "" : "s"}
            </span>
          </div>
          {runs.length === 0 ? (
            <p className="py-4 text-sm text-neutral-400">
              This agent hasn&apos;t run any tasks yet.
            </p>
          ) : (
            <ul>
              {runs.slice(0, 10).map(({ task, project }) => (
                <li
                  key={task.id}
                  className="border-t border-neutral-800/80 first:border-t-0"
                >
                  <Link
                    href={`/tasks/${task.id}`}
                    className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-lg px-2 py-3 hover:bg-white/[0.025]"
                  >
                    <span className="min-w-28 shrink-0 font-mono text-sm text-sky-300">
                      /{agent.namespace}:{task.command}
                    </span>
                    <span className="hidden min-w-0 flex-1 truncate text-sm text-neutral-400 sm:block">
                      {task.requestText || (
                        <span className="text-neutral-600">no description</span>
                      )}
                    </span>
                    <span className="inline-flex min-w-0 shrink items-center gap-1.5 text-xs text-neutral-500">
                      <FolderGit2 className="size-3.5 shrink-0" />
                      <span className="truncate">{project.name}</span>
                    </span>
                    <span className="hidden shrink-0 text-xs text-neutral-500 md:block">
                      {timeAgo(task.createdAt)}
                    </span>
                    <StatusBadge status={task.status} />
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
