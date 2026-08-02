import Link from "next/link";
import { Coins } from "lucide-react";
import type { SpendSummary } from "@/lib/usage-summary";
import { CardSection, EmptyState, Tile } from "@/components/ui-cards";
import { UsageBreakdown } from "@/components/UsageDisplay";
import { formatCost, formatTokens, totalTokens } from "@/lib/usage-format";
import { timeAgo } from "@/lib/ui";

/**
 * The signed-in user's own spend, from the totals recorded on each task.
 *
 * Server component: `spendForUser()` is a direct query, so this renders with the page
 * instead of flashing in. The *plan-limit* half of `/api/usage` is a separate, best-effort
 * client component (`PlanLimits`) — it needs a runner probe and is usually unavailable.
 */
export function UsageSummaryCard({ spend }: { spend: SpendSummary }) {
  const tokens = totalTokens({
    inputTokens: spend.inputTokens,
    outputTokens: spend.outputTokens,
    cacheReadTokens: spend.cacheReadTokens,
    cacheCreationTokens: spend.cacheCreationTokens,
    costUsd: spend.totalCostUsd,
  });
  const billed = spend.billedTaskCount;
  // Built as strings rather than inline JSX: interleaving `{expr}` with prose drops the
  // spaces between them ("90 taskspredates"), which the rendered page duly showed.
  const plural = (n: number) => `${n} task${n === 1 ? "" : "s"}`;

  return (
    <CardSection
      // Not "Usage": this sits under the /usage page's own <h1>Usage</h1>, and a duplicate
      // heading is dead weight when navigating by headings.
      title="Your spend"
      right={
        <span className="text-xs text-fg-faint">
          {`${plural(spend.taskCount)} dispatched by you`}
        </span>
      }
    >
      {billed === 0 ? (
        <EmptyState
          icon={<Coins className="size-6" />}
          title="No usage recorded yet"
          hint="Dispatch a task and its token and cost totals will appear here once the first turn completes."
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Tile value={formatCost(spend.totalCostUsd)} label="Total spend" />
            <Tile
              value={formatCost(spend.last30DaysCostUsd)}
              label="Last 30 days"
            />
            <Tile value={formatTokens(tokens)} label="Tokens" />
            <Tile
              value={`${billed}`}
              label={`Billed task${billed === 1 ? "" : "s"}`}
            />
          </div>

          <UsageBreakdown
            usage={{
              inputTokens: spend.inputTokens,
              outputTokens: spend.outputTokens,
              cacheReadTokens: spend.cacheReadTokens,
              cacheCreationTokens: spend.cacheCreationTokens,
              // Cost already has its own tile above; the breakdown stays token-only.
              costUsd: 0,
            }}
            className="mt-4"
          />

          {spend.topTasks.length > 0 && (
            <>
              <h3 className="mt-6 mb-1 text-sm font-medium text-fg-muted">
                Most expensive runs
              </h3>
              <ul>
                {spend.topTasks.map((t) => (
                  <li key={t.id} className="border-t border-line first:border-t-0">
                    <Link
                      href={`/tasks/${t.id}`}
                      className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg px-2 py-2.5 hover:bg-hover"
                    >
                      <span className="min-w-0 flex-1 truncate text-sm text-fg">
                        {t.title || (
                          <span className="font-mono text-accent">/{t.command}</span>
                        )}
                      </span>
                      <span className="shrink-0 text-xs text-fg-faint">
                        {timeAgo(new Date(t.createdAt))}
                      </span>
                      <span className="shrink-0 font-mono text-sm text-fg-strong">
                        {formatCost(t.costUsd)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}

      {/* Most of this instance's history predates per-user attribution, so a purely
          personal figure would read as $0 next to hundreds of dollars of real spend.
          Aggregate only, and unowned by definition — it discloses nothing about anyone. */}
      {spend.unattributed.taskCount > 0 && (
        <p className="mt-4 border-t border-line pt-3 text-xs text-fg-faint">
          {`A further ${formatCost(spend.unattributed.costUsd)} across ${plural(
            spend.unattributed.taskCount,
          )} predates per-user attribution and isn't counted above.`}
        </p>
      )}
    </CardSection>
  );
}
