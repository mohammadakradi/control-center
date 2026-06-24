import Link from "next/link";
import { desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { AddProjectForm } from "@/components/AddProjectForm";

export const dynamic = "force-dynamic";

export default function ProjectsPage() {
  const list = db
    .select()
    .from(projects)
    .orderBy(desc(projects.createdAt))
    .all();

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
                <div className="font-medium">{p.name}</div>
                <div className="truncate font-mono text-xs text-neutral-500">
                  {p.path}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2 text-xs">
                {p.isWorkspace && (
                  <span className="rounded-full border border-violet-500/30 bg-violet-500/15 px-2 py-0.5 text-violet-300">
                    workspace · {p.members.length}
                  </span>
                )}
                <span
                  className={`rounded-full border px-2 py-0.5 ${
                    p.onboarded
                      ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-300"
                      : "border-neutral-600 bg-neutral-700/30 text-neutral-300"
                  }`}
                >
                  {p.onboarded ? "onboarded" : "not onboarded"}
                </span>
              </div>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
