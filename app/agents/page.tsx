import Link from "next/link";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { projectAgents } from "@/lib/db/schema";
import { syncAgents } from "@/lib/discovery/agents";
import { Avatar } from "@/components/AgentAvatar";

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
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Agents</h1>
          <p className="text-sm text-neutral-400">
            Auto-discovered from your installed Claude Code plugins.
          </p>
        </div>
      </div>

      {agents.length === 0 ? (
        <p className="text-neutral-400">No plugins installed.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {agents.map((a) => (
            <Link
              key={a.id}
              href={`/agents/${encodeURIComponent(a.id)}`}
              className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-5 transition-colors hover:border-neutral-700 hover:bg-neutral-900"
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-sm text-sky-400">
                  /{a.namespace}
                </span>
                <span className="text-xs text-neutral-500">
                  {counts.get(a.id) ?? 0} project
                  {(counts.get(a.id) ?? 0) === 1 ? "" : "s"}
                </span>
              </div>
              <div className="mt-2 flex items-center gap-3">
                <Avatar namespace={a.namespace} size={48} />
                <h2 className="text-lg font-medium">{a.name}</h2>
              </div>
              {a.description && (
                <p className="mt-2 line-clamp-2 text-sm text-neutral-400">
                  {a.description}
                </p>
              )}
              <div className="mt-3 flex flex-wrap gap-1.5">
                {a.commands.map((c) => (
                  <span
                    key={c.full}
                    className="rounded-md bg-neutral-800 px-2 py-0.5 font-mono text-xs text-neutral-300"
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
