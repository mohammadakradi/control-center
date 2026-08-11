import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { ownedBy } from "@/lib/task-access";
import { and, desc, eq } from "drizzle-orm";
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
import { TaskList } from "@/components/TaskList";
import { card, CardSection, Chip, Fact, Tile } from "@/components/ui-cards";

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
  // Only this owner's runs — sign-in is optional, so the alternative is showing a visitor
  // everyone's history.
  const user = await getCurrentUser();
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
    .where(and(eq(tasks.agentId, id), ownedBy(user.id)))
    .orderBy(desc(tasks.createdAt))
    .all();

  // project id → name for the run rows; the join above already carries every project
  // this agent has run in.
  const projectNameById: Record<string, string> = {};
  for (const r of runs) projectNameById[r.task.projectId] = r.project.name;

  const done = runs.filter((r) => r.task.status === "done").length;
  const successRate = runs.length ? Math.round((done / runs.length) * 100) : 0;

  return (
    <div>
      <Link
        href="/agents"
        className="inline-flex items-center gap-1.5 text-sm text-fg-subtle hover:text-fg-strong"
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
              <span className="rounded-md border border-line-strong bg-surface-3 px-2 py-0.5 font-mono text-sm font-normal text-fg-subtle">
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
        <p className="mt-4 max-w-3xl leading-relaxed text-fg-muted">
          {agent.description}
        </p>
      )}

      <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* At a glance */}
        <section className={card}>
          {/* `text-fg-strong` matches what `CardSection` gives the "Recent runs" heading
              below, so the four card headings on this page stay one weight. */}
          <h2 className="mb-4 text-base font-semibold text-fg-strong">At a glance</h2>
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
              Plugin <span className="font-mono text-fg-muted">{agent.pluginId}</span>
            </Fact>
          </ul>
        </section>

        {/* Connected projects */}
        <section className={card}>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-semibold text-fg-strong">
              Connected projects
            </h2>
            <span className="text-xs text-fg-faint">{connected.length}</span>
          </div>
          {connected.length === 0 ? (
            <p className="py-2 text-sm text-fg-subtle">
              Not connected to any project yet. Open a project and run a task with
              this agent.
            </p>
          ) : (
            <ul className="space-y-2">
              {connected.map((p) => (
                <li key={p.id}>
                  <Link
                    href={`/projects/${p.id}`}
                    className="flex items-center gap-3 rounded-xl border border-line bg-surface-2 px-3.5 py-3 hover:border-line-strong hover:bg-surface-3"
                  >
                    <FolderGit2 className="size-4 shrink-0 text-fg-faint" />
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{p.name}</div>
                      <div className="truncate font-mono text-xs text-fg-faint">
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
          <h2 className="mb-4 inline-flex items-center gap-2 text-base font-semibold text-fg-strong">
            <SquareTerminal className="size-4 text-fg-faint" />
            Commands
          </h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {agent.commands.map((c) => (
              <div
                key={c.full}
                className="rounded-xl border border-line bg-surface-2 p-3.5"
              >
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="font-mono text-sm text-accent">{c.full}</span>
                  {c.argumentHint && (
                    <span className="font-mono text-xs text-fg-faint">
                      {c.argumentHint}
                    </span>
                  )}
                </div>
                {c.description && (
                  <p className="mt-1.5 text-sm leading-relaxed text-fg-subtle">
                    {c.description}
                  </p>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* Recent runs — the shared rows; the project cell earns its place here because one
            agent's runs span projects. Capped at 10 while the header counts them all. */}
        <CardSection
          title="Recent runs"
          className="lg:col-span-2"
          right={
            <span className="text-xs text-fg-faint">
              {`${runs.length} run${runs.length === 1 ? "" : "s"}`}
            </span>
          }
        >
          <TaskList
            history={runs.slice(0, 10).map((r) => r.task)}
            namespaceById={{ [agent.id]: agent.namespace }}
            projectNameById={projectNameById}
            emptyMessage="This agent hasn't run any tasks yet."
          />
        </CardSection>
      </div>
    </div>
  );
}
