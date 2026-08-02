/**
 * Display formatting for token/cost usage.
 *
 * Pure and locale-pinned on purpose: these values render in server components *and* in
 * client components, so anything locale- or clock-dependent has to be explicit or the two
 * renders disagree and React reports a hydration mismatch.
 */

/** The five usage quantities, named as the rest of the app names them. */
export type TaskUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd: number;
};

/** Lift the `usage*` columns off a task row into a {@link TaskUsage}. */
export function taskUsage(task: {
  usageInputTokens: number;
  usageOutputTokens: number;
  usageCacheReadTokens: number;
  usageCacheCreationTokens: number;
  usageCostUsd: number;
}): TaskUsage {
  return {
    inputTokens: task.usageInputTokens,
    outputTokens: task.usageOutputTokens,
    cacheReadTokens: task.usageCacheReadTokens,
    cacheCreationTokens: task.usageCacheCreationTokens,
    costUsd: task.usageCostUsd,
  };
}

/**
 * Did this task record anything at all?
 *
 * Tasks that predate usage tracking — and ones whose subprocess was killed before it could
 * report (see `runner/usage.ts`) — hold honest zeros. "No usage recorded" is not "free", so
 * the UI renders nothing for them rather than a misleading `$0.00`.
 */
export function hasUsage(u: TaskUsage): boolean {
  return totalTokens(u) > 0 || u.costUsd > 0;
}

export function totalTokens(u: TaskUsage): number {
  return (
    u.inputTokens + u.outputTokens + u.cacheReadTokens + u.cacheCreationTokens
  );
}

const UNITS = [
  { limit: 1e9, suffix: "B" },
  { limit: 1e6, suffix: "M" },
  { limit: 1e3, suffix: "k" },
] as const;

/**
 * Token counts at a glance: `812`, `12.4k`, `1.2M`, `537M`.
 *
 * Cache-read totals here run into the hundreds of millions, so the raw digits are unusable
 * in a chip. One decimal up to three significant figures keeps `1.2M` and `12.4k`
 * informative; past that (`537M`, `999k`) the decimal is noise.
 */
export function formatTokens(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  for (const { limit, suffix } of UNITS) {
    // Slightly below the limit: 999 600 rounds to "1000k", which should read "1M".
    if (n < limit * 0.9995) continue;
    const scaled = n / limit;
    const text =
      scaled < 100 ? scaled.toFixed(1).replace(/\.0$/, "") : String(Math.round(scaled));
    return `${text}${suffix}`;
  }
  return String(Math.round(n));
}

/**
 * A dollar figure. Sub-cent spend is real but unprintable at two decimals, so it reads
 * `<$0.01` rather than `$0.00` — the same "recorded but tiny ≠ free" distinction
 * {@link hasUsage} makes. The locale is pinned so the server and client agree on separators.
 */
export function formatCost(usd: number): string {
  if (!Number.isFinite(usd) || usd <= 0) return "$0.00";
  if (usd < 0.005) return "<$0.01";
  return `$${usd.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Countdown to a rate-limit window reset, e.g. `3h 12m`, `6d 4h`, `any moment`.
 *
 * Deliberately not `formatDuration` from `lib/ui.ts`: that one measures an elapsed run and
 * tops out at hours, so a 7-day window would read "168h 0m". `now` is a parameter so this
 * stays pure (and testable) instead of reaching for the clock.
 */
export function formatResetsIn(isoDate: string | null, now: number): string | null {
  if (!isoDate) return null;
  const at = Date.parse(isoDate);
  if (!Number.isFinite(at)) return null;
  const mins = Math.round((at - now) / 60_000);
  if (mins <= 0) return "any moment";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) {
    const rest = mins % 60;
    return rest ? `${hours}h ${rest}m` : `${hours}h`;
  }
  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  return rest ? `${days}d ${rest}h` : `${days}d`;
}

/**
 * Human label for a rate-limit window key. The SDK already ships six keys and will grow,
 * so unknown keys are humanized rather than dropped — `usage-snapshot.ts` deliberately
 * passes through anything window-shaped.
 */
export function windowLabel(key: string): string {
  switch (key) {
    case "five_hour":
      return "5-hour window";
    case "seven_day":
      return "7-day window";
    case "seven_day_opus":
      return "7-day window (Opus)";
    default:
      return key.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
  }
}
