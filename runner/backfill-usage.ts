/**
 * Backfill per-task token/cost totals from history. Every SDK `result` message this app
 * has ever seen is already persisted verbatim in `task_events`, so a task's usage can be
 * recomputed at any time — no model calls, no Anthropic token, nothing billed.
 *
 *   pnpm db:backfill-usage             # only tasks whose usage is still all-zero
 *   pnpm db:backfill-usage --dry-run   # show what would change, write nothing
 *   pnpm db:backfill-usage --all       # recompute every task (repairs a wrong total)
 *
 * Safe to re-run: totals are derived from the events and written absolutely, so a second
 * run over the same history is a no-op. It replays each task through the same helper the
 * live runner uses (`runner/usage.ts`), so backfilled and live rows mean the same thing.
 *
 * Tasks in a non-terminal status are skipped: writing an absolute total while the runner is
 * incrementing the same row would quietly discard the turn it just banked.
 */
import { asc, eq } from "drizzle-orm";
import { db } from "../lib/db";
import { taskEvents, tasks, type TaskStatus } from "../lib/db/schema";
import { isZeroUsage, usageAbsolute, usageFromEvents, type UsageTotals } from "./usage";

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const all = args.has("--all");

const usd = (n: number) => `$${n.toFixed(4)}`;
const num = (n: number) => n.toLocaleString("en-US");

/** A task the runner may still be banking usage for. Backfill writes totals *absolutely*,
 *  so racing a live increment would silently revert it — skip those and say so. Typed as
 *  `TaskStatus` so a typo fails the build; note `runner/server.ts` keeps a parallel list
 *  for orphan reconciliation, and the two must stay in step. */
const ACTIVE: ReadonlyArray<TaskStatus> = [
  "queued",
  "running",
  "awaiting_proposal",
  "building",
  "awaiting_report",
  "committing",
];

function main(): void {
  const everything = db.select().from(tasks).orderBy(asc(tasks.createdAt)).all();
  const active = everything.filter((t) => ACTIVE.includes(t.status));
  const rows = everything
    .filter((t) => !ACTIVE.includes(t.status))
    .filter((t) =>
      all
        ? true
        : isZeroUsage({
            inputTokens: t.usageInputTokens,
            outputTokens: t.usageOutputTokens,
            cacheReadTokens: t.usageCacheReadTokens,
            cacheCreationTokens: t.usageCacheCreationTokens,
            costUsd: t.usageCostUsd,
          }),
    );

  if (active.length > 0) {
    console.log(
      `Skipping ${active.length} task(s) that are still active (${active
        .map((t) => `${t.id}:${t.status}`)
        .join(", ")}) — the runner may be banking their usage right now, and an ` +
        `absolute write would revert it. Re-run once they finish.\n`,
    );
  }

  if (rows.length === 0) {
    console.log("Every task already has usage recorded — nothing to backfill.");
    return;
  }
  console.log(
    `${dryRun ? "Would backfill" : "Backfilling"} usage for ${rows.length} task(s)` +
      `${all ? " (--all: recomputing every task)" : ""}…\n`,
  );

  let changed = 0;
  let empty = 0;
  let grand: UsageTotals = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    costUsd: 0,
  };

  for (const t of rows) {
    const events = db
      .select({ type: taskEvents.type, payload: taskEvents.payload })
      .from(taskEvents)
      .where(eq(taskEvents.taskId, t.id))
      .orderBy(asc(taskEvents.id))
      .all();

    const total = usageFromEvents(events);
    if (isZeroUsage(total)) {
      // Nothing recoverable: either the task never reached a `result` (queued / dispatch
      // failure), or it died before any API call and its result reports an empty
      // `modelUsage` with zero cost. Leave the row's zeros alone.
      empty += 1;
      continue;
    }

    if (!dryRun) {
      db.update(tasks).set(usageAbsolute(total)).where(eq(tasks.id, t.id)).run();
    }
    changed += 1;
    grand = {
      inputTokens: grand.inputTokens + total.inputTokens,
      outputTokens: grand.outputTokens + total.outputTokens,
      cacheReadTokens: grand.cacheReadTokens + total.cacheReadTokens,
      cacheCreationTokens: grand.cacheCreationTokens + total.cacheCreationTokens,
      costUsd: grand.costUsd + total.costUsd,
    };
    console.log(
      `  ${t.id}  /${t.command.padEnd(9)} ${usd(total.costUsd).padStart(10)}  ` +
        `in ${num(total.inputTokens).padStart(9)}  out ${num(total.outputTokens).padStart(9)}  ` +
        `cache-read ${num(total.cacheReadTokens).padStart(12)}  ${t.title ?? t.command}`,
    );
  }

  console.log(
    `\n${dryRun ? "Would update" : "Updated"} ${changed} task(s)` +
      `${empty ? `, skipped ${empty} whose events report no usage` : ""}.`,
  );
  console.log(
    `Total: ${usd(grand.costUsd)} · ${num(grand.inputTokens)} input · ` +
      `${num(grand.outputTokens)} output · ${num(grand.cacheReadTokens)} cache-read · ` +
      `${num(grand.cacheCreationTokens)} cache-write tokens`,
  );
  if (dryRun) console.log("\n(--dry-run: nothing was written.)");
}

try {
  main();
  process.exit(0);
} catch (err) {
  console.error("Backfill failed:", err);
  process.exit(1);
}
