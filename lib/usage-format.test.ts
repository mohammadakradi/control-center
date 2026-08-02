/**
 * Unit tests for the usage display formatters. Pure functions, no database — the point is
 * to pin the edges that would otherwise show a user something wrong: rounding that jumps a
 * unit, sub-cent spend rendered as `$0.00`, and "recorded nothing" vs "cost nothing".
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  formatCost,
  formatResetsIn,
  formatTokens,
  hasUsage,
  taskUsage,
  totalTokens,
  windowLabel,
  type TaskUsage,
} from "./usage-format";

const usage = (over: Partial<TaskUsage> = {}): TaskUsage => ({
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  costUsd: 0,
  ...over,
});

test("formatTokens abbreviates by magnitude", () => {
  assert.equal(formatTokens(0), "0");
  assert.equal(formatTokens(812), "812");
  assert.equal(formatTokens(999), "999");
  assert.equal(formatTokens(1_000), "1k");
  assert.equal(formatTokens(12_400), "12.4k");
  assert.equal(formatTokens(99_500), "99.5k");
  assert.equal(formatTokens(120_000), "120k"); // past 3 significant figures, drop the decimal
  assert.equal(formatTokens(1_200_000), "1.2M");
  assert.equal(formatTokens(537_000_000), "537M");
  assert.equal(formatTokens(2_500_000_000), "2.5B");
});

test("formatTokens promotes a value that rounds into the next unit", () => {
  // 999 600 → "1000k" would be silly; it should read as a megatoken.
  assert.equal(formatTokens(999_600), "1M");
  assert.equal(formatTokens(999_400), "999k");
});

test("formatTokens survives junk instead of rendering NaN", () => {
  assert.equal(formatTokens(Number.NaN), "0");
  assert.equal(formatTokens(-5), "0");
  assert.equal(formatTokens(Number.POSITIVE_INFINITY), "0");
});

test("formatCost keeps sub-cent spend visible", () => {
  assert.equal(formatCost(0), "$0.00");
  assert.equal(formatCost(0.0004), "<$0.01");
  assert.equal(formatCost(0.006), "$0.01");
  assert.equal(formatCost(1.234), "$1.23");
  assert.equal(formatCost(459.61), "$459.61");
  assert.equal(formatCost(1234.5), "$1,234.50");
  assert.equal(formatCost(Number.NaN), "$0.00");
});

test("hasUsage separates 'recorded nothing' from 'cost nothing'", () => {
  // A task that predates tracking, or whose subprocess died before reporting.
  assert.equal(hasUsage(usage()), false);
  // Tokens but no cost: a run that burned context without a billable turn still counts.
  assert.equal(hasUsage(usage({ inputTokens: 12 })), true);
  assert.equal(hasUsage(usage({ cacheReadTokens: 900 })), true);
  assert.equal(hasUsage(usage({ costUsd: 0.0001 })), true);
});

test("totalTokens sums all four token buckets", () => {
  assert.equal(
    totalTokens(
      usage({
        inputTokens: 1,
        outputTokens: 2,
        cacheReadTokens: 4,
        cacheCreationTokens: 8,
      }),
    ),
    15,
  );
});

test("taskUsage lifts the usage columns off a task row", () => {
  assert.deepEqual(
    taskUsage({
      usageInputTokens: 1,
      usageOutputTokens: 2,
      usageCacheReadTokens: 3,
      usageCacheCreationTokens: 4,
      usageCostUsd: 5.5,
    }),
    {
      inputTokens: 1,
      outputTokens: 2,
      cacheReadTokens: 3,
      cacheCreationTokens: 4,
      costUsd: 5.5,
    },
  );
});

test("formatResetsIn counts down in useful units", () => {
  const now = Date.parse("2026-08-01T12:00:00.000Z");
  const at = (ms: number) => new Date(now + ms).toISOString();
  const MIN = 60_000;

  assert.equal(formatResetsIn(at(8 * MIN), now), "8m");
  assert.equal(formatResetsIn(at(192 * MIN), now), "3h 12m");
  assert.equal(formatResetsIn(at(120 * MIN), now), "2h"); // no dangling "0m"
  // A 7-day window is why this isn't lib/ui.ts's formatDuration ("168h 0m").
  assert.equal(formatResetsIn(at(7 * 24 * 60 * MIN), now), "7d");
  assert.equal(formatResetsIn(at(28 * 60 * MIN), now), "1d 4h");
});

test("formatResetsIn degrades instead of showing a negative countdown", () => {
  const now = Date.parse("2026-08-01T12:00:00.000Z");
  assert.equal(formatResetsIn(new Date(now - 60_000).toISOString(), now), "any moment");
  assert.equal(formatResetsIn(null, now), null);
  assert.equal(formatResetsIn("not a date", now), null);
});

test("windowLabel names the known windows and humanizes the rest", () => {
  assert.equal(windowLabel("five_hour"), "5-hour window");
  assert.equal(windowLabel("seven_day"), "7-day window");
  assert.equal(windowLabel("seven_day_opus"), "7-day window (Opus)");
  // The SDK will add keys; an unknown one must still render, not vanish.
  assert.equal(windowLabel("thirty_day_sonnet"), "Thirty day sonnet");
});
