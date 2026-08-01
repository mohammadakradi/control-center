import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { db } from "./db";
import { tasks } from "./db/schema";

/**
 * Per-user spend, aggregated from the totals `runner/usage.ts` records on each task.
 *
 * This is the half of the usage picture that actually works: real, already-collected
 * numbers straight out of the `tasks` table. (Claude *plan* rate limits are a separate,
 * best-effort thing — see `runner/usage-snapshot.ts` for why they're usually unavailable.)
 *
 * Always scoped to one user. Task transcripts are deliberately shared across the team, but
 * spend is closer to billing, so it isn't.
 */

export type TaskSpend = {
  id: string;
  title: string | null;
  command: string;
  costUsd: number;
  createdAt: string; // ISO 8601
};

export type SpendSummary = {
  totalCostUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  /** Tasks owned by this user, whether or not they recorded any usage. */
  taskCount: number;
  /** Tasks that actually recorded spend — the rest never reached a billable turn. */
  billedTaskCount: number;
  last30DaysCostUsd: number;
  /** Most expensive runs, for "where did the money go". */
  topTasks: TaskSpend[];
  /**
   * Spend on tasks with no owner — everything dispatched before `tasks.userId` existed.
   * Reported separately so a long history doesn't simply vanish from the UI: on this
   * instance 90 of 91 tasks are unowned, so a purely per-user figure reads as $0 next to
   * $459 of real spend. Aggregate only, and unowned by definition, so it discloses nothing
   * about another user.
   */
  unattributed: { costUsd: number; taskCount: number };
};

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export function spendForUser(userId: string, topN = 5): SpendSummary {
  const mine = eq(tasks.userId, userId);

  const totals = db
    .select({
      cost: sql<number>`COALESCE(SUM(${tasks.usageCostUsd}), 0)`,
      input: sql<number>`COALESCE(SUM(${tasks.usageInputTokens}), 0)`,
      output: sql<number>`COALESCE(SUM(${tasks.usageOutputTokens}), 0)`,
      cacheRead: sql<number>`COALESCE(SUM(${tasks.usageCacheReadTokens}), 0)`,
      cacheCreation: sql<number>`COALESCE(SUM(${tasks.usageCacheCreationTokens}), 0)`,
      taskCount: sql<number>`COUNT(*)`,
      billedTaskCount: sql<number>`COALESCE(SUM(CASE WHEN ${tasks.usageCostUsd} > 0 THEN 1 ELSE 0 END), 0)`,
    })
    .from(tasks)
    .where(mine)
    .get();

  const recent = db
    .select({ cost: sql<number>`COALESCE(SUM(${tasks.usageCostUsd}), 0)` })
    .from(tasks)
    .where(and(mine, gte(tasks.createdAt, new Date(Date.now() - THIRTY_DAYS_MS))))
    .get();

  const top = db
    .select({
      id: tasks.id,
      title: tasks.title,
      command: tasks.command,
      costUsd: tasks.usageCostUsd,
      createdAt: tasks.createdAt,
    })
    .from(tasks)
    .where(mine)
    // Newest-first as a tiebreaker, so equal-cost rows come back in a stable order.
    .orderBy(desc(tasks.usageCostUsd), desc(tasks.createdAt))
    .limit(topN)
    .all()
    .filter((t) => t.costUsd > 0)
    .map((t) => ({ ...t, createdAt: t.createdAt.toISOString() }));

  const orphaned = db
    .select({
      cost: sql<number>`COALESCE(SUM(${tasks.usageCostUsd}), 0)`,
      taskCount: sql<number>`COUNT(*)`,
    })
    .from(tasks)
    .where(isNull(tasks.userId))
    .get();

  return {
    totalCostUsd: totals?.cost ?? 0,
    inputTokens: totals?.input ?? 0,
    outputTokens: totals?.output ?? 0,
    cacheReadTokens: totals?.cacheRead ?? 0,
    cacheCreationTokens: totals?.cacheCreation ?? 0,
    taskCount: totals?.taskCount ?? 0,
    billedTaskCount: totals?.billedTaskCount ?? 0,
    last30DaysCostUsd: recent?.cost ?? 0,
    topTasks: top,
    unattributed: {
      costUsd: orphaned?.cost ?? 0,
      taskCount: orphaned?.taskCount ?? 0,
    },
  };
}
