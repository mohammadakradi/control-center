/**
 * Per-task token/cost accounting, derived from SDK `result` messages.
 *
 * ## Why this isn't just "sum the result messages"
 *
 * Measured against the 118 `result` messages this app had already persisted in
 * `task_events` (not assumed from the type definitions):
 *
 * - `modelUsage` and `total_cost_usd` are **cumulative for the lifetime of one SDK
 *   subprocess** — every turn re-reports the running total, and `total_cost_usd`
 *   equals Σ`modelUsage[*].costUSD` exactly.
 * - `usage` (the snake_case block) is **per-turn but incomplete**: it only covers the
 *   main model, missing the router/title (haiku) and subagent models. On one real
 *   result it read 5 889 input tokens where `modelUsage` totalled 7 120.
 * - A continue/resume spawns a **new subprocess**, so the cumulative counters **restart
 *   part-way through a task's history**.
 *
 * So summing `total_cost_usd` per result over-counts (~2× on a resumed task) and summing
 * `usage` under-counts. Instead we track the cumulative snapshot and accumulate its
 * **deltas**, treating any counter going backwards as "new subprocess, start again".
 *
 * The same helper serves both the live path (`session-manager.ts`, one fresh accumulator
 * per launch) and the history backfill (`backfill-usage.ts`, which replays a task's
 * persisted events), so the two can't drift apart.
 *
 * ## Known limitation
 *
 * Usage is banked only when a `result` message arrives, i.e. at turn boundaries. A
 * subprocess killed mid-turn — the runner restarting under `tsx watch`, the container
 * going down — reports nothing, so that spend is never attributed and the task reads $0
 * even though tokens were burned. `task_566f891c` is the worked example: 1 371 persisted
 * events, zero `result` messages, and therefore zero recoverable usage. Per-turn accrual
 * from assistant messages would close the gap, but those counts overlap `modelUsage` and
 * would need their own de-duplication, so it is deliberately out of scope here.
 */
import { sql } from "drizzle-orm";
import { tasks } from "../lib/db/schema";

/** Tokens and cost consumed — either a cumulative snapshot or an increment. */
export type UsageTotals = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd: number;
};

export const ZERO_USAGE: UsageTotals = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  costUsd: 0,
};

/** Cost is a float, so compare with a tolerance far below a millionth of a dollar —
 *  only a genuine subprocess restart drops it, and that drops it by cents or dollars. */
const COST_EPSILON = 1e-6;

/**
 * Ceilings, not just a finiteness check. better-sqlite3 does NOT reject an absurd value
 * bound to an INTEGER column — it silently stores e.g. `1e308` with storage class `real` —
 * so a single bogus field from a misbehaving subprocess would poison a task's totals with
 * no exception for the caller's try/catch to catch. These bounds sit ~1000× above anything
 * this app has ever recorded (its largest task to date: ~537M cache-read tokens, $24.59)
 * and well inside exact-integer range, so a real reading can never hit them.
 */
const MAX_TOKENS = 1e12;
const MAX_COST_USD = 1e6;

/** True for an SDK `result` message (success *and* error subtypes carry usage). */
export function isResultMessage(m: unknown): boolean {
  return (
    typeof m === "object" &&
    m !== null &&
    (m as { type?: unknown }).type === "result"
  );
}

/** All five accumulated quantities, so per-field logic can iterate rather than repeat. */
const FIELDS = [
  "inputTokens",
  "outputTokens",
  "cacheReadTokens",
  "cacheCreationTokens",
  "costUsd",
] as const;
type Field = (typeof FIELDS)[number];

/** A cumulative snapshot, plus the fields whose raw reading this turn was unusable.
 *  Tracking that matters: an unusable value reads as 0, and a 0 is indistinguishable from
 *  "this counter went backwards" — which would otherwise be taken as a subprocess restart.
 *  See {@link usageDelta}. */
type Snapshot = { totals: UsageTotals; suspect: ReadonlySet<Field> };

/** One raw field, coerced. `invalid` marks a value that was *present but unusable*
 *  (non-numeric, NaN/Infinity, negative, or past the ceiling) — as opposed to absent,
 *  which is a legitimate zero. */
function reading(raw: unknown, max: number): { value: number; invalid: boolean } {
  if (raw === undefined || raw === null) return { value: 0, invalid: false };
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0 || raw > max) {
    return { value: 0, invalid: true };
  }
  return { value: raw, invalid: false };
}

/** Sum `modelUsage` across every model the subprocess used (main agent, subagents,
 *  and the router/title calls). Returns null when the field is absent or unusable. */
function cumulativeFromModelUsage(m: unknown): Snapshot | null {
  const mu = (m as { modelUsage?: unknown }).modelUsage;
  if (typeof mu !== "object" || mu === null) return null;
  const entries = Object.values(mu as Record<string, unknown>).filter(
    (e): e is Record<string, unknown> => typeof e === "object" && e !== null,
  );
  if (entries.length === 0) return null;

  const totals: UsageTotals = { ...ZERO_USAGE };
  const suspect = new Set<Field>();
  const take = (field: Field, raw: unknown, max: number, whole: boolean) => {
    const r = reading(raw, max);
    if (r.invalid) suspect.add(field);
    totals[field] += whole ? Math.round(r.value) : r.value;
  };

  for (const e of entries) {
    take("inputTokens", e.inputTokens, MAX_TOKENS, true);
    take("outputTokens", e.outputTokens, MAX_TOKENS, true);
    take("cacheReadTokens", e.cacheReadInputTokens, MAX_TOKENS, true);
    take("cacheCreationTokens", e.cacheCreationInputTokens, MAX_TOKENS, true);
    take("costUsd", e.costUSD, MAX_COST_USD, false);
  }

  // `modelUsage` was present but no entry yielded a single token, so it tells us nothing
  // about this turn (empty or malformed entries). Report "no snapshot" rather than a
  // token-less one, so the caller falls back to the per-turn `usage` block — which may
  // still carry real numbers — instead of silently recording nothing. Checked on tokens
  // BEFORE the headline cost is folded in: a non-zero `total_cost_usd` would otherwise
  // make the snapshot look usable, and the fallback preserves that cost anyway.
  if (
    totals.inputTokens === 0 &&
    totals.outputTokens === 0 &&
    totals.cacheReadTokens === 0 &&
    totals.cacheCreationTokens === 0
  ) {
    return null;
  }

  // `total_cost_usd` is the SDK's headline figure and usually equals the sum above — but
  // not always: in 3 of the 118 result messages this app had recorded, the headline lagged
  // the per-model sum by ~$1–1.5 and was corrected by a duplicate result message 2–4 ms
  // later (e.g. task_f68c9003, task_events 14821 → 14822). Trusting the headline there
  // would permanently understate a subprocess that happened to die while lagging, so take
  // whichever figure is larger: the headline can also exceed the sum if some spend isn't
  // attributed per-model, and under-reporting is the worse error either way. An unusable
  // headline is simply ignored — the per-model sum is still good, so don't mark cost
  // suspect and lose a turn's real spend over it.
  const headline = reading((m as { total_cost_usd?: unknown }).total_cost_usd, MAX_COST_USD);
  if (!headline.invalid) totals.costUsd = Math.max(totals.costUsd, headline.value);
  return { totals, suspect };
}

/** Fallback for a result with no usable `modelUsage`: the per-turn `usage` block is
 *  already an increment, so lift it onto the last known cumulative snapshot. */
function synthesizeCumulative(seen: UsageTotals, m: unknown): Snapshot {
  const u = (m as { usage?: unknown }).usage;
  const turn =
    typeof u === "object" && u !== null ? (u as Record<string, unknown>) : {};
  const suspect = new Set<Field>();
  const lift = (field: Field, raw: unknown): number => {
    const r = reading(raw, MAX_TOKENS);
    if (r.invalid) suspect.add(field);
    return seen[field] + Math.round(r.value);
  };
  const headline = reading((m as { total_cost_usd?: unknown }).total_cost_usd, MAX_COST_USD);
  return {
    totals: {
      inputTokens: lift("inputTokens", turn.input_tokens),
      outputTokens: lift("outputTokens", turn.output_tokens),
      cacheReadTokens: lift("cacheReadTokens", turn.cache_read_input_tokens),
      cacheCreationTokens: lift("cacheCreationTokens", turn.cache_creation_input_tokens),
      // Cost stays cumulative even here; never let it go backwards.
      costUsd: Math.max(seen.costUsd, headline.invalid ? 0 : headline.value),
    },
    suspect,
  };
}

/**
 * How much *new* usage this `result` message represents, given the last cumulative
 * snapshot seen from the same subprocess.
 *
 * Decided **per field**, not for the message as a whole. A field whose reading was
 * unusable reads as 0, and treating that 0 as "the counter went backwards" would classify
 * the whole message as a fresh subprocess — re-banking every *other* field's full
 * cumulative value instead of its increment, and leaving the zero in the snapshot so the
 * next turn over-counts too. (Measured: one bad field on turn 2 of 3 banked $2.70 against
 * $1.70 of real spend.) So restart is judged only on fields we actually read, and an
 * unusable field carries its last good value forward and banks nothing.
 *
 * @returns `delta` — usage to add to the task row; `next` — the snapshot to pass in next
 *          time. Non-result messages yield a zero delta and an unchanged snapshot.
 */
export function usageDelta(
  seen: UsageTotals,
  message: unknown,
): { delta: UsageTotals; next: UsageTotals } {
  if (!isResultMessage(message)) return { delta: ZERO_USAGE, next: seen };
  const { totals: cum, suspect } =
    cumulativeFromModelUsage(message) ?? synthesizeCumulative(seen, message);

  // Cost is a float, so allow a hair of noise before calling it a decrease.
  const wentBackwards = (f: Field) =>
    cum[f] < seen[f] - (f === "costUsd" ? COST_EPSILON : 0);

  // A field is only untrustworthy where BOTH hold: a reading was dropped (so the total may
  // be understated) AND it now sits below the last snapshot. Either alone is fine — a
  // dropped reading among several good ones still leaves a usable sum, and a plain decrease
  // with every reading intact is a genuine subprocess restart.
  const unusable = (f: Field) => suspect.has(f) && wentBackwards(f);
  const restart = FIELDS.some((f) => !unusable(f) && wentBackwards(f));

  const delta: UsageTotals = { ...ZERO_USAGE };
  const next: UsageTotals = { ...ZERO_USAGE };
  for (const f of FIELDS) {
    if (unusable(f)) {
      next[f] = seen[f]; // keep the last good baseline; bank nothing for this field
    } else if (restart) {
      next[f] = cum[f];
      delta[f] = cum[f]; // fresh subprocess: the whole snapshot is new usage
    } else {
      next[f] = cum[f];
      delta[f] = Math.max(0, cum[f] - seen[f]);
    }
  }
  return { delta, next };
}

export function addUsage(a: UsageTotals, b: UsageTotals): UsageTotals {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheCreationTokens: a.cacheCreationTokens + b.cacheCreationTokens,
    costUsd: a.costUsd + b.costUsd,
  };
}

/** Nothing to write. */
export function isZeroUsage(u: UsageTotals): boolean {
  return (
    u.inputTokens === 0 &&
    u.outputTokens === 0 &&
    u.cacheReadTokens === 0 &&
    u.cacheCreationTokens === 0 &&
    u.costUsd < COST_EPSILON
  );
}

/** `set` clause that ADDS usage to whatever the row already holds. Done in SQL rather
 *  than read-modify-write because the web process reads these same rows, and a resumed
 *  task must add to its earlier runs instead of replacing them. */
export function usageIncrement(delta: UsageTotals) {
  return {
    usageInputTokens: sql`${tasks.usageInputTokens} + ${delta.inputTokens}`,
    usageOutputTokens: sql`${tasks.usageOutputTokens} + ${delta.outputTokens}`,
    usageCacheReadTokens: sql`${tasks.usageCacheReadTokens} + ${delta.cacheReadTokens}`,
    usageCacheCreationTokens: sql`${tasks.usageCacheCreationTokens} + ${delta.cacheCreationTokens}`,
    usageCostUsd: sql`${tasks.usageCostUsd} + ${delta.costUsd}`,
  };
}

/** `set` clause that REPLACES a row's usage with recomputed totals (the backfill, which
 *  derives the whole history from `task_events` and so must be re-runnable). */
export function usageAbsolute(total: UsageTotals) {
  return {
    usageInputTokens: total.inputTokens,
    usageOutputTokens: total.outputTokens,
    usageCacheReadTokens: total.cacheReadTokens,
    usageCacheCreationTokens: total.cacheCreationTokens,
    usageCostUsd: total.costUsd,
  };
}

/**
 * Prefixes of the log lines `session-manager.ts` writes exactly once per launch (initial
 * dispatch, or continue/resume). **`session-manager.ts` builds its messages from these
 * constants**, so a reworded log can't silently break history replay — the compiler ties
 * the two together. Replay keys off these rather than the SDK's own `init` message, which
 * can fire several times inside a single subprocess.
 */
export const LAUNCH_LOG = {
  dispatched: "Dispatched:",
  continuing: "Continuing",
} as const;

/** Does this event mark the start of a new SDK subprocess? */
export function isLaunchBoundary(event: { type: string; payload: unknown }): boolean {
  if (event.type !== "log") return false;
  const message = (event.payload as { message?: unknown } | null)?.message;
  return (
    typeof message === "string" &&
    (message.startsWith(LAUNCH_LOG.dispatched) ||
      message.startsWith(LAUNCH_LOG.continuing))
  );
}

/**
 * Total usage of a task, replayed from its persisted events in order. Resets the
 * cumulative snapshot at every launch boundary, so each subprocess's usage is counted
 * in full.
 *
 * For any task whose logs predate those markers, the backwards-counter check in
 * {@link usageDelta} is only a *partial* safety net: it catches a new subprocess whose
 * counters start lower than the previous one's, but a resume whose fresh snapshot happens
 * to exceed the earlier totals without ever dipping below them reads as a continuation and
 * under-counts. Every task in this app's history carries a boundary marker (the log strings
 * have existed since continue/resume was introduced), so that path is dormant rather than
 * load-bearing — worth knowing before relying on it for imported history.
 */
export function usageFromEvents(
  events: Array<{ type: string; payload: unknown }>,
): UsageTotals {
  let total: UsageTotals = { ...ZERO_USAGE };
  let seen: UsageTotals = { ...ZERO_USAGE };
  for (const event of events) {
    if (isLaunchBoundary(event)) {
      seen = { ...ZERO_USAGE }; // fresh subprocess: its counters start from zero
      continue;
    }
    if (event.type !== "message") continue;
    const { delta, next } = usageDelta(seen, event.payload);
    total = addUsage(total, delta);
    seen = next;
  }
  return total;
}
