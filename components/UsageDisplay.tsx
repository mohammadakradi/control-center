import { Coins } from "lucide-react";
import {
  formatCost,
  formatTokens,
  hasUsage,
  type TaskUsage,
} from "@/lib/usage-format";

/**
 * Token/cost display, at two densities:
 *   `UsageBreakdown` — the labelled split, for a task's own page and for user totals.
 *   `UsageCost`      — just the money, for a row in a list.
 *
 * Both render `null` when nothing was recorded, so tasks that predate usage tracking (or
 * whose subprocess died before reporting) show nothing rather than a misleading zero.
 * Server components — usage is read straight off the task row.
 */

/** Labelled token/cost breakdown for one task or one user's totals. */
export function UsageBreakdown({
  usage,
  className = "",
}: {
  usage: TaskUsage;
  className?: string;
}) {
  if (!hasUsage(usage)) return null;

  const items: Array<{ label: string; value: string; strong?: boolean }> = [
    { label: "Input", value: formatTokens(usage.inputTokens) },
    { label: "Output", value: formatTokens(usage.outputTokens) },
    { label: "Cache read", value: formatTokens(usage.cacheReadTokens) },
    { label: "Cache write", value: formatTokens(usage.cacheCreationTokens) },
  ];
  // Only when there is money to report: a run can bank tokens without a billable turn,
  // and "$0.00" would read as "this was free" rather than "no cost was recorded".
  if (usage.costUsd > 0) {
    items.push({ label: "Cost", value: formatCost(usage.costUsd), strong: true });
  }

  return (
    // The icon sits outside the <dl>: a definition list may only contain dt/dd pairs
    // (optionally div-wrapped), so a sibling <svg> inside it would be invalid HTML.
    <div className={`flex flex-wrap items-center gap-x-2 gap-y-1 ${className}`}>
      <Coins className="size-3.5 shrink-0 text-fg-ghost" aria-hidden="true" />
      <dl className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        {items.map((item) => (
          <div key={item.label} className="flex items-center gap-1.5">
            <dt className="text-fg-faint">{item.label}</dt>
            <dd
              className={`font-mono ${item.strong ? "text-fg-strong" : "text-fg-subtle"}`}
            >
              {item.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/**
 * A task's cost, for dense list rows. A bordered `Chip` per row would compete with the
 * status badge in a list that runs to dozens of entries, so this matches the quiet
 * metadata treatment the surrounding row already uses.
 */
export function UsageCost({
  usage,
  className = "",
}: {
  usage: TaskUsage;
  className?: string;
}) {
  if (usage.costUsd <= 0) return null;
  return (
    <span className={`font-mono text-xs text-fg-faint ${className}`}>
      <span className="sr-only">Cost </span>
      {formatCost(usage.costUsd)}
    </span>
  );
}
