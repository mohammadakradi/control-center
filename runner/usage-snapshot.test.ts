/**
 * Tests for the plan-limit snapshot normalizer.
 *
 *   pnpm test
 *
 * The SDK method behind this is explicitly experimental ("may change or be removed in any
 * release without notice"), so what's pinned here is that every unexpected shape degrades to
 * `available: false` with a reason — never a throw, and never a bogus number.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { normalizeWindowsForTest as normalizeWindows } from "./usage-snapshot";

test("pulls every window-shaped entry out of rate_limits", () => {
  // Real shape from sdk.d.ts: six named windows plus `extra_usage`, which is NOT a window.
  const windows = normalizeWindows({
    five_hour: { utilization: 42.5, resets_at: "2026-08-01T18:00:00Z" },
    seven_day: { utilization: 8, resets_at: "2026-08-07T00:00:00Z" },
    seven_day_opus: { utilization: null, resets_at: null },
    extra_usage: { is_enabled: true, monthly_limit: 100, used_credits: 10 },
  });
  assert.deepEqual(
    windows.map((w) => w.key),
    ["five_hour", "seven_day", "seven_day_opus"],
    "extra_usage has no `utilization`, so it isn't a window",
  );
  assert.equal(windows[0].utilization, 42.5);
  assert.equal(windows[0].resetsAt, "2026-08-01T18:00:00Z");
  assert.equal(windows[2].utilization, null, "a null utilization stays null, not 0");
});

test("keys are not hardcoded — a window the SDK adds later still comes through", () => {
  const windows = normalizeWindows({
    seven_day_some_future_model: { utilization: 5, resets_at: null },
  });
  assert.equal(windows.length, 1);
  assert.equal(windows[0].key, "seven_day_some_future_model");
});

test("utilization is clamped to 0-100 and junk becomes null", () => {
  const windows = normalizeWindows({
    a: { utilization: 250, resets_at: null },
    b: { utilization: -5, resets_at: null },
    c: { utilization: Number.NaN, resets_at: null },
    d: { utilization: "80", resets_at: null },
    e: { utilization: Number.POSITIVE_INFINITY, resets_at: null },
  });
  const byKey = Object.fromEntries(windows.map((w) => [w.key, w.utilization]));
  assert.equal(byKey.a, 100, "a percentage over 100 is clamped, not shown raw");
  assert.equal(byKey.b, 0);
  assert.equal(byKey.c, null);
  assert.equal(byKey.d, null, "a numeric string is not a number");
  assert.equal(byKey.e, null);
});

test("a resets_at that isn't a string becomes null", () => {
  const windows = normalizeWindows({ x: { utilization: 1, resets_at: 12345 } });
  assert.equal(windows[0].resetsAt, null);
});

test("shapes that aren't rate_limits at all yield no windows", () => {
  for (const junk of [null, undefined, 42, "nope", [], {}, { five_hour: null }]) {
    assert.deepEqual(normalizeWindows(junk), [], `input: ${JSON.stringify(junk)}`);
  }
});
