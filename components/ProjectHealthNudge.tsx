import Link from "next/link";
import { Gauge } from "lucide-react";
import { buttonClasses } from "@/components/ui/button";
import { discoverBundledAgents } from "@/lib/discovery/agents";
import { scanProjectHealth, healthSummary } from "@/lib/project-health";
import { COMPOSE_PARAM } from "@/lib/ui";

/**
 * What this project's own documents cost per run, and the one action that fixes them.
 *
 * Exists because an app update cannot fix them. The updater swaps `~/.control-center/app/` and
 * migrates the database; a project folder is the user's, and nothing in the release goes near
 * it. So the agent rules that shrank `CLAUDE.md` from 147 KB to 13 KB on *this* install arrive
 * for everyone, while the 147 KB file on *their* install stays exactly as it was — quietly
 * costing ~38k tokens on every API call, which was 25% of this project's spend before it was
 * found (`.swe/notes/cost-and-context.md`).
 *
 * Renders nothing when a project is healthy, so it disappears the moment a re-onboard fixes it
 * — same shape as `TokenNudge`. Server component: it stats files, and file sizes are not
 * something to ship to the client and recompute.
 *
 * Deliberately a nudge and not an action. Rewriting a `CLAUDE.md` means deciding what survives,
 * which is the onboard skill's judgment; the missing-graph half of the problem *is* mechanical
 * and is already fixed without asking (`runner/post-update.ts`).
 */
export function ProjectHealthNudge({
  projectPath,
  agents,
}: {
  projectPath: string;
  /** The project's agents as the page already resolved them, so this doesn't re-scan disk. */
  agents: {
    namespace: string;
    version?: string | null;
    scope?: string | null;
  }[];
}) {
  const bundledVersions: Record<string, string | null> = {};
  for (const a of discoverBundledAgents()) bundledVersions[a.namespace] = a.version ?? null;

  const installedVersions: Record<string, { version: string | null; fromCli: boolean }> = {};
  for (const a of agents) {
    installedVersions[a.namespace] = {
      version: a.version ?? null,
      fromCli: a.scope !== "bundled",
    };
  }

  const health = scanProjectHealth(projectPath, { bundledVersions, installedVersions });
  const summary = healthSummary(health);
  if (!summary) return null;

  return (
    <div className="rounded-xl border border-warn-line bg-warn-soft px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <Gauge className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-warn">
              This project is paying for its own documents
            </p>
            <p className="mt-0.5 text-xs text-warn/80">{summary}</p>
          </div>
        </div>
        {/* Hands the composer over with `onboard` already picked, rather than dispatching
            here. The composer owns the model/effort choices that go with a run, so a second
            way to start one is a second thing to keep correct — but a bare `#new-task` anchor
            was worse: this card sits directly above the composer, so the scroll went nowhere
            visible and the button read as broken (reported 2026-09-07). Arriving with the
            command chosen is the difference. */}
        <Link
          href={`?${COMPOSE_PARAM}=onboard#new-task`}
          className={buttonClasses("secondary", "sm")}
        >
          Re-onboard
        </Link>
      </div>
      <ul className="mt-2.5 space-y-1 pl-7 text-xs text-warn/80">
        {health.findings.slice(0, 4).map((f) => (
          <li key={`${f.kind}:${f.subject}`}>
            <span className="font-mono">{f.subject}</span> — {f.detail}
          </li>
        ))}
      </ul>
      <p className="mt-2 pl-7 text-xs text-warn/70">
        Re-onboarding rewrites the managed sections against the current rules and keeps
        everything written by hand. It also builds the code graph.
      </p>
    </div>
  );
}
