import Link from "next/link";
import { FolderGit2 } from "lucide-react";
import type { ProjectSpend, SpendSummary } from "@/lib/usage-summary";
import { CardSection, EmptyState } from "@/components/ui-cards";
import {
  formatCost,
  formatTokens,
  hasUsage,
  isFiltered,
  NO_SPEND_IN_RANGE_HINT,
  rangeLabel,
  totalTokens,
} from "@/lib/usage-format";

/**
 * Where the money went, per project, for the range the page is showing.
 *
 * Server component, like the summary card above it — both read the same `SpendSummary`, so
 * the breakdown can never disagree with the totals it's a breakdown of.
 */

/** Rows past this are summarised rather than listed — but never silently dropped. */
const MAX_ROWS = 8;

export function ProjectSpendCard({ spend }: { spend: SpendSummary }) {
  // A project whose tasks never reached a billable turn holds honest zeros, and "$0.00"
  // reads as "this was free" rather than "nothing was recorded" — same gate the rest of
  // the usage UI uses.
  const projects = spend.byProject.filter(hasUsage);
  const shown = projects.slice(0, MAX_ROWS);
  const rest = projects.slice(MAX_ROWS);
  const restCost = rest.reduce((sum, p) => sum + p.costUsd, 0);
  const filtered = isFiltered(spend.range);

  return (
    <CardSection
      title="Spend by project"
      right={
        <span className="text-xs text-fg-faint">{rangeLabel(spend.range)}</span>
      }
    >
      {projects.length === 0 ? (
        <EmptyState
          icon={<FolderGit2 className="size-6" />}
          title={
            filtered
              ? `No project spend in the ${rangeLabel(spend.range).toLowerCase()}`
              : "No project spend recorded yet"
          }
          hint={
            filtered
              ? NO_SPEND_IN_RANGE_HINT
              : "Once one of your tasks records usage, the project it ran in appears here."
          }
        />
      ) : (
        <>
          <ul className="space-y-4">
            {shown.map((project) => (
              <li key={project.projectId}>
                <ProjectRow project={project} total={spend.totalCostUsd} />
              </li>
            ))}
          </ul>
          {rest.length > 0 && (
            // Truncating a list without saying so makes a partial view look complete.
            <p className="mt-4 border-t border-line pt-3 text-xs text-fg-faint">
              {`A further ${formatCost(restCost)} across ${rest.length} smaller project${
                rest.length === 1 ? "" : "s"
              }.`}
            </p>
          )}
        </>
      )}
    </CardSection>
  );
}

function ProjectRow({
  project,
  total,
}: {
  project: ProjectSpend;
  total: number;
}) {
  // Clamped for the same reason `PlanLimits` clamps: a width over 100% silently overflows
  // the track, and a NaN width is dropped by the browser, leaving a bar that reads "full".
  const share =
    total > 0 ? Math.max(0, Math.min(100, (project.costUsd / total) * 100)) : 0;

  const meta = [
    `${formatTokens(totalTokens(project))} tokens`,
    `${project.taskCount} run${project.taskCount === 1 ? "" : "s"}`,
    // Printed as text as well as drawn, so the bar can stay decorative.
    ...(share > 0 ? [`${share < 0.5 ? "<1" : Math.round(share)}% of spend`] : []),
  ].join(" · ");

  return (
    <>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <span className="inline-flex min-w-0 items-center gap-1.5 text-sm text-fg">
          <FolderGit2 className="size-3.5 shrink-0 text-fg-ghost" aria-hidden="true" />
          {/* The FK isn't enforced in the real database, so a task can outlive its
              project row — in which case there's nothing to link to. */}
          {project.projectName ? (
            <Link
              href={`/projects/${project.projectId}`}
              className="min-w-0 truncate hover:text-accent-hover"
            >
              {project.projectName}
            </Link>
          ) : (
            <span className="min-w-0 truncate text-fg-subtle">Unknown project</span>
          )}
        </span>
        {project.costUsd > 0 ? (
          <span className="font-mono text-sm text-fg-strong">
            {formatCost(project.costUsd)}
          </span>
        ) : (
          <span className="text-xs text-fg-faint">No cost recorded</span>
        )}
      </div>
      {share > 0 && (
        // Decorative: the share is already in `meta` below, and the design system's rule
        // is that a bar is never the only signal.
        <div
          aria-hidden="true"
          className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-3"
        >
          <div className="h-full rounded-full bg-accent" style={{ width: `${share}%` }} />
        </div>
      )}
      <p className="mt-1 text-xs text-fg-faint">{meta}</p>
    </>
  );
}
