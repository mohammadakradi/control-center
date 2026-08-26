import { homedir } from "node:os";
import { resolve } from "node:path";

/** Port the runner daemon listens on. */
export const RUNNER_PORT = Number(process.env.RUNNER_PORT ?? 4319);

/**
 * Interface the runner binds. Loopback by default — the daemon has no authentication of its own
 * (it is meant to be reachable only through the Next.js proxy routes, which do the auth), so a
 * default of "every interface" put task dispatch on the local network. It was one: @hono/node-server
 * binds all interfaces when no hostname is given.
 *
 * `RUNNER_HOST=0.0.0.0` is for containers only, where binding loopback *inside* the container
 * would make Docker's published port unreachable. Compose sets it, and publishes to 127.0.0.1.
 */
export function runnerHost(value = process.env.RUNNER_HOST): string {
  return value?.trim() || "127.0.0.1";
}
export const RUNNER_HOST = runnerHost();

/** Base URL the Next.js server uses to reach the daemon. Server-side only — the
 *  browser goes through the authenticated /api/tasks/[id]/* proxy routes. */
export const RUNNER_URL =
  process.env.RUNNER_URL ?? `http://localhost:${RUNNER_PORT}`;

/**
 * Local data dir (sqlite + uploads + the token vault). Both the Next app and the runner run
 * with cwd = repo root, so a checkout keeps its data in `./data`.
 *
 * `PLATFORM_DATA_DIR` moves it elsewhere, which an *installed* app requires: the `control-center`
 * CLI points it at `~/.control-center/data` so that replacing the app directory on update can't
 * take the database and encrypted tokens with it.
 */
export const DATA_DIR = process.env.PLATFORM_DATA_DIR?.trim()
  ? resolve(process.env.PLATFORM_DATA_DIR.trim())
  : resolve(process.cwd(), "data");
/** Where task attachments (docs/photos the user adds to a request) are stored, per task. */
export const UPLOADS_DIR = resolve(DATA_DIR, "uploads");

/** Claude Code plugin registry on this machine. */
export const CLAUDE_DIR = resolve(homedir(), ".claude");
export const INSTALLED_PLUGINS_JSON = resolve(
  CLAUDE_DIR,
  "plugins/installed_plugins.json",
);
export const KNOWN_MARKETPLACES_JSON = resolve(
  CLAUDE_DIR,
  "plugins/known_marketplaces.json",
);

/**
 * Agent plugins shipped inside the app (`agents/<namespace>`), so a fresh install has working
 * agents without the user first registering marketplaces with the Claude Code CLI. Both the Next
 * app and the runner run with cwd = app root, and the release tarball carries this directory.
 * `PLATFORM_AGENTS_DIR` overrides it.
 */
export const BUNDLED_AGENTS_DIR = process.env.PLATFORM_AGENTS_DIR?.trim()
  ? resolve(process.env.PLATFORM_AGENTS_DIR.trim())
  : resolve(process.cwd(), "agents");

/**
 * Per-task ceilings — the thing that stops a runaway run.
 *
 * There were none, and the cost of that is measurable: one `swe:task` on this install ran
 * 1,201 turns over 161 hours and cost $300, which was 11% of the install's entire two-month
 * spend. Nothing in the platform would have stopped it at $50, because nothing was watching.
 *
 * Both caps are enforced by the SDK, which ends the query with an `error_max_turns` /
 * `error_max_budget_usd` result — a subtype the stream loop already turns into a failed task
 * carrying the reason, so the user sees why it stopped instead of a silent halt.
 *
 * `0` (or a negative/unparseable value) means **no cap**, so an install that wants the old
 * unbounded behavior sets `CC_TASK_MAX_TURNS=0`. Defaults are deliberately generous: they are
 * a runaway guard, not a budget policy, and a cap that trips on ordinary work would just
 * teach people to turn it off.
 */
export function taskCap(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const n = Number(raw.trim());
  // NaN and negatives collapse to 0 = "no cap": an unreadable value must not silently
  // install a *tighter* limit than the operator asked for. An empty string is Number("") === 0,
  // which lands on "no cap" too — `CC_TASK_MAX_TURNS=` reads as "off", not as "default".
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Turns one subprocess launch may take before the SDK stops it. `0` = unlimited. */
export const TASK_MAX_TURNS = taskCap(process.env.CC_TASK_MAX_TURNS, 250);

/**
 * Dollars a *task* may spend in total, across every launch it takes (dispatch, continues and
 * resumes alike). Per-task rather than per-launch because each launch is a fresh subprocess
 * whose own counters restart — a per-launch cap on a task continued six times is six caps.
 * `tasks.usage_cost_usd` already accumulates the deltas, so the remaining allowance is
 * derivable at launch; see `remainingTaskBudgetUsd`. `0` = unlimited.
 */
export const TASK_MAX_BUDGET_USD = taskCap(process.env.CC_TASK_MAX_BUDGET_USD, 40);

/** Below this much remaining allowance a launch is refused rather than started: a session
 *  handed a few cents dies inside its first tool call, which reads as a crash, not a cap. */
export const MIN_LAUNCH_BUDGET_USD = 0.5;

/**
 * What this launch may still spend, given what the task has already spent. `null` means
 * "no cap configured" — the caller then omits `maxBudgetUsd` entirely rather than passing a
 * sentinel the SDK would read as a real number.
 *
 * Returns a value at or below `MIN_LAUNCH_BUDGET_USD` when the task is out of allowance; the
 * caller refuses the launch in that case instead of starting a session that cannot finish.
 */
export function remainingTaskBudgetUsd(
  spentUsd: number,
  cap = TASK_MAX_BUDGET_USD,
): number | null {
  if (cap <= 0) return null;
  // A negative or NaN spend reads as 0 rather than *widening* the allowance: usage is
  // accumulated from SDK deltas, and a bad row must not hand a run more budget than the cap.
  const spent = Number.isFinite(spentUsd) && spentUsd > 0 ? spentUsd : 0;
  return cap - spent;
}

/**
 * When the agent's transcript gets compacted (summarized server-side) instead of being
 * re-sent in full on every call.
 *
 * Claude Code auto-compacts as the context window fills, but these models have a **1M token
 * window**, so on this install it effectively never fired: exactly one `compact_boundary`
 * event across 207 tasks. Transcripts instead grew unbounded — 141k tokens re-sent on every
 * one of 32,688 API calls, which is where 60% of the spend went (`.swe/notes/
 * cost-and-context.md`). Compaction is the only mechanism that shrinks a live transcript;
 * the SDK exposes no context-editing (tool-result clearing) option.
 *
 * 200k is deliberately generous rather than aggressive. Compaction **summarizes and discards
 * detail**, so firing it early on a long build risks the agent losing a decision it made an
 * hour ago — a quality risk, not a free win. At 200k an ordinary task never reaches it and is
 * unaffected; only the long runs, where the transcript is already the dominant cost, compact.
 *
 * `0` disables the override and restores the SDK default (i.e. near-never).
 */
export const AUTO_COMPACT_WINDOW = taskCap(
  process.env.CC_AUTO_COMPACT_WINDOW,
  200_000,
);
