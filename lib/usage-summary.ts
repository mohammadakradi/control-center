import { and, asc, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { db } from "./db";
import { projects, tasks } from "./db/schema";

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

/** Time window a spend query covers. Measured back from now against `tasks.createdAt`. */
export type SpendRange = "7d" | "30d" | "all";

/**
 * Parse a user-supplied range string (e.g. a `?range=` query param). Absent means "all"
 * (the historical behavior); anything not on the allowlist is `null` so the caller can
 * reject it instead of silently reinterpreting it.
 */
export function parseRange(value: string | null): SpendRange | null {
  if (value === null || value === "") return "all";
  return value === "7d" || value === "30d" || value === "all" ? value : null;
}

export type TaskSpend = {
  id: string;
  title: string | null;
  /** Only to feed `taskDisplayTitle()`: an untitled task should name itself here the same way
   *  it does in every other task list, rather than dropping straight to its command. */
  requestText: string;
  command: string;
  projectId: string;
  /** Null only if the project row is gone (the FK is cascade-on-paper but unenforced). */
  projectName: string | null;
  costUsd: number;
  createdAt: string; // ISO 8601
};

/** One project's share of the user's spend within the requested range. */
export type ProjectSpend = {
  projectId: string;
  projectName: string | null;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  taskCount: number;
  billedTaskCount: number;
};

export type SpendSummary = {
  /** The window every figure below (except `unattributed`) is scoped to. */
  range: SpendRange;
  totalCostUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  /** Tasks owned by this user, whether or not they recorded any usage. */
  taskCount: number;
  /** Tasks that actually recorded spend — the rest never reached a billable turn. */
  billedTaskCount: number;
  /** Most expensive runs, for "where did the money go". */
  topTasks: TaskSpend[];
  /** Spend per project within the range, most expensive first. */
  byProject: ProjectSpend[];
  /**
   * Spend on tasks with no owner — everything dispatched before `tasks.userId` existed.
   * Reported separately so a long history doesn't simply vanish from the UI: on this
   * instance 90 of 91 tasks are unowned, so a purely per-user figure reads as $0 next to
   * $459 of real spend. Aggregate only, and unowned by definition, so it discloses nothing
   * about another user.
   */
  unattributed: { costUsd: number; taskCount: number };
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** The oldest `createdAt` a range admits, or null when it admits everything. */
function rangeStart(range: SpendRange): Date | null {
  if (range === "all") return null;
  return new Date(Date.now() - (range === "7d" ? 7 : 30) * DAY_MS);
}

export function spendForUser(
  userId: string,
  { range = "all", topN = 5 }: { range?: SpendRange; topN?: number } = {},
): SpendSummary {
  const mine = eq(tasks.userId, userId);
  const start = rangeStart(range);
  // Every aggregate below except `unattributed` (all-time by design) uses this predicate.
  const scoped = start ? and(mine, gte(tasks.createdAt, start)) : mine;

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
    .where(scoped)
    .get();

  // LEFT join, not inner: the projects FK is unenforced in the real DB (see .swe/notes/gotchas-1.md),
  // and an orphaned task must not silently vanish from a billing figure.
  const top = db
    .select({
      id: tasks.id,
      title: tasks.title,
      requestText: tasks.requestText,
      command: tasks.command,
      projectId: tasks.projectId,
      projectName: projects.name,
      costUsd: tasks.usageCostUsd,
      createdAt: tasks.createdAt,
    })
    .from(tasks)
    .leftJoin(projects, eq(tasks.projectId, projects.id))
    .where(scoped)
    // Newest-first as a tiebreaker, so equal-cost rows come back in a stable order.
    .orderBy(desc(tasks.usageCostUsd), desc(tasks.createdAt))
    .limit(topN)
    .all()
    .filter((t) => t.costUsd > 0)
    .map((t) => ({ ...t, createdAt: t.createdAt.toISOString() }));

  const totalCost = sql<number>`COALESCE(SUM(${tasks.usageCostUsd}), 0)`;
  const byProject = db
    .select({
      projectId: tasks.projectId,
      projectName: projects.name,
      costUsd: totalCost,
      inputTokens: sql<number>`COALESCE(SUM(${tasks.usageInputTokens}), 0)`,
      outputTokens: sql<number>`COALESCE(SUM(${tasks.usageOutputTokens}), 0)`,
      cacheReadTokens: sql<number>`COALESCE(SUM(${tasks.usageCacheReadTokens}), 0)`,
      cacheCreationTokens: sql<number>`COALESCE(SUM(${tasks.usageCacheCreationTokens}), 0)`,
      taskCount: sql<number>`COUNT(*)`,
      billedTaskCount: sql<number>`COALESCE(SUM(CASE WHEN ${tasks.usageCostUsd} > 0 THEN 1 ELSE 0 END), 0)`,
    })
    .from(tasks)
    .leftJoin(projects, eq(tasks.projectId, projects.id))
    .where(scoped)
    .groupBy(tasks.projectId)
    // Name as a tiebreaker so equal-spend projects come back in a stable order.
    .orderBy(desc(totalCost), asc(projects.name))
    .all();

  const orphaned = db
    .select({
      cost: sql<number>`COALESCE(SUM(${tasks.usageCostUsd}), 0)`,
      taskCount: sql<number>`COUNT(*)`,
    })
    .from(tasks)
    .where(isNull(tasks.userId))
    .get();

  return {
    range,
    totalCostUsd: totals?.cost ?? 0,
    inputTokens: totals?.input ?? 0,
    outputTokens: totals?.output ?? 0,
    cacheReadTokens: totals?.cacheRead ?? 0,
    cacheCreationTokens: totals?.cacheCreation ?? 0,
    taskCount: totals?.taskCount ?? 0,
    billedTaskCount: totals?.billedTaskCount ?? 0,
    topTasks: top,
    byProject,
    unattributed: {
      costUsd: orphaned?.cost ?? 0,
      taskCount: orphaned?.taskCount ?? 0,
    },
  };
}
