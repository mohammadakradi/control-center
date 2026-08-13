import Link from "next/link";
import { sql } from "drizzle-orm";
import { Boxes } from "lucide-react";
import { db } from "@/lib/db";
import { projectAgents } from "@/lib/db/schema";
import { syncAgents } from "@/lib/discovery/agents";
import { Avatar } from "@/components/AgentAvatar";
import { EmptyState, PageHeader } from "@/components/ui-cards";

export const dynamic = "force-dynamic";

export default function AgentsPage() {
  const agents = syncAgents(); // re-discover installed plugins on each load
  const counts = new Map<string, number>();
  for (const row of db
    .select({
      agentId: projectAgents.agentId,
      n: sql<number>`count(*)`,
    })
    .from(projectAgents)
    .groupBy(projectAgents.agentId)
    .all()) {
    counts.set(row.agentId, row.n);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Agents"
        description="An agent is an installed Claude Code plugin, auto-discovered from this device. Its skills are what you dispatch."
      />

      {agents.length === 0 ? (
        <EmptyState
          icon={<Boxes className="size-6" />}
          title="No agents discovered"
          hint="Install a Claude Code plugin and reload — agents are picked up automatically."
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {agents.map((a) => (
            <Link
              key={a.id}
              href={`/agents/${encodeURIComponent(a.id)}`}
              className="rounded-xl border border-line bg-surface p-5 transition-colors hover:border-line-strong hover:bg-surface-2"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate font-mono text-sm text-accent">
                  /{a.namespace}
                </span>
                <span className="shrink-0 text-xs text-fg-faint">
                  {counts.get(a.id) ?? 0} project
                  {(counts.get(a.id) ?? 0) === 1 ? "" : "s"}
                </span>
              </div>
              <div className="mt-2 flex items-center gap-3">
                <Avatar namespace={a.namespace} size={48} />
                <h2 className="flex items-center gap-2 text-base font-semibold text-fg-strong">
                  {a.name}
                  {a.version && (
                    <span className="rounded-md border border-line-strong bg-surface-3 px-1.5 py-0.5 font-mono text-xs font-normal text-fg-subtle">
                      v{a.version}
                    </span>
                  )}
                </h2>
              </div>
              {a.description && (
                <p className="mt-2 line-clamp-2 text-sm text-fg-subtle">
                  {a.description}
                </p>
              )}
              <div className="mt-3 flex flex-wrap gap-1.5">
                {a.commands.map((c) => (
                  <span
                    key={c.full}
                    className="rounded-md bg-surface-3 px-2 py-0.5 font-mono text-xs text-fg-muted"
                  >
                    {c.name}
                  </span>
                ))}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
