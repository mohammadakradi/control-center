/**
 * Unit tests for the usage accounting helper.
 *
 *   pnpm test
 *
 * The headline test replays a fixture captured from this app's own `task_events`
 * (`task_f68c9003`: two subprocesses, five result messages, one of them a resume) and
 * asserts the totals a human can verify by hand from the per-subprocess finals.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import {
  LAUNCH_LOG,
  ZERO_USAGE,
  addUsage,
  isLaunchBoundary,
  isResultMessage,
  isZeroUsage,
  usageDelta,
  usageFromEvents,
  type UsageTotals,
} from "./usage";

/** A result message carrying one model's cumulative counters. */
function result(
  cum: { in: number; out: number; cr?: number; cc?: number },
  totalCostUsd: number,
  extra: Record<string, unknown> = {},
) {
  return {
    type: "result",
    subtype: "success",
    is_error: false,
    total_cost_usd: totalCostUsd,
    usage: {
      input_tokens: 0,
      output_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    },
    modelUsage: {
      "claude-opus-5": {
        inputTokens: cum.in,
        outputTokens: cum.out,
        cacheReadInputTokens: cum.cr ?? 0,
        cacheCreationInputTokens: cum.cc ?? 0,
        webSearchRequests: 0,
        costUSD: totalCostUsd,
        contextWindow: 200000,
        maxOutputTokens: 64000,
      },
    },
    ...extra,
  };
}

const launchLog = { type: "log", payload: { message: "Continuing task (fresh session)" } };

test("first result in a subprocess counts its whole snapshot", () => {
  const { delta, next } = usageDelta(ZERO_USAGE, result({ in: 100, out: 50, cr: 900 }, 1.5));
  assert.deepEqual(delta, {
    inputTokens: 100,
    outputTokens: 50,
    cacheReadTokens: 900,
    cacheCreationTokens: 0,
    costUsd: 1.5,
  });
  assert.deepEqual(next, delta);
});

test("later results in the same subprocess count only the increment", () => {
  const first = usageDelta(ZERO_USAGE, result({ in: 100, out: 50, cr: 900 }, 1.5));
  const second = usageDelta(first.next, result({ in: 180, out: 120, cr: 2400 }, 4.25));
  assert.deepEqual(second.delta, {
    inputTokens: 80,
    outputTokens: 70,
    cacheReadTokens: 1500,
    cacheCreationTokens: 0,
    costUsd: 2.75,
  });
});

test("counters going backwards mean a new subprocess — count the snapshot in full", () => {
  const first = usageDelta(ZERO_USAGE, result({ in: 9242, out: 74997 }, 8.75));
  // A resume: the fresh subprocess reports its own, much smaller, running total.
  const resumed = usageDelta(first.next, result({ in: 907, out: 54897 }, 7.13));
  assert.equal(resumed.delta.inputTokens, 907);
  assert.equal(resumed.delta.outputTokens, 54897);
  assert.equal(resumed.delta.costUsd, 7.13);
});

test("a launch boundary resets the snapshot even when the new subprocess reports MORE", () => {
  // The case backwards-detection alone gets wrong: subprocess 2 out-spends subprocess 1,
  // so nothing goes backwards and a naive delta would silently drop 100 input tokens.
  const events = [
    { type: "message", payload: result({ in: 100, out: 40 }, 1) },
    launchLog,
    { type: "message", payload: result({ in: 150, out: 60 }, 2) },
  ];
  assert.equal(usageFromEvents(events).inputTokens, 250);
  assert.equal(usageFromEvents(events).outputTokens, 100);
  assert.equal(usageFromEvents(events).costUsd, 3);
});

test("an error result that reports no new usage adds nothing", () => {
  // Real shape from task_ff52d9fd: subtype error_during_execution, zeroed `usage`, and the
  // same cumulative cost as the previous result.
  const first = usageDelta(ZERO_USAGE, result({ in: 143, out: 5486 }, 1.4668365));
  const errored = usageDelta(first.next, {
    ...result({ in: 143, out: 5486 }, 1.4668365),
    subtype: "error_during_execution",
    is_error: true,
  });
  assert.ok(isZeroUsage(errored.delta), `expected zero delta, got ${JSON.stringify(errored.delta)}`);
});

test("usage is still captured for a failed run (error results carry it)", () => {
  const { delta } = usageDelta(ZERO_USAGE, {
    ...result({ in: 500, out: 200 }, 3),
    subtype: "error_max_turns",
    is_error: true,
  });
  assert.equal(delta.inputTokens, 500);
  assert.equal(delta.costUsd, 3);
});

test("falls back to the per-turn `usage` block when modelUsage is unusable", () => {
  const base = {
    type: "result",
    subtype: "success",
    total_cost_usd: 0.5,
    usage: {
      input_tokens: 12,
      output_tokens: 34,
      cache_read_input_tokens: 56,
      cache_creation_input_tokens: 78,
    },
  };
  for (const modelUsage of [undefined, null, {}, "nope", 42]) {
    const { delta } = usageDelta(ZERO_USAGE, { ...base, modelUsage });
    assert.deepEqual(
      delta,
      {
        inputTokens: 12,
        outputTokens: 34,
        cacheReadTokens: 56,
        cacheCreationTokens: 78,
        costUsd: 0.5,
      },
      `modelUsage=${JSON.stringify(modelUsage)}`,
    );
  }
});

test("the per-turn fallback accumulates instead of resetting", () => {
  const noModelUsage = (turn: number) => ({
    type: "result",
    subtype: "success",
    total_cost_usd: turn,
    usage: { input_tokens: 10, output_tokens: 20 },
  });
  const first = usageDelta(ZERO_USAGE, noModelUsage(1));
  const second = usageDelta(first.next, noModelUsage(2));
  assert.equal(first.delta.inputTokens, 10);
  assert.equal(second.delta.inputTokens, 10); // the increment, not the running total
  assert.equal(second.next.inputTokens, 20);
  assert.equal(second.delta.costUsd, 1);
});

test("hostile numbers from the subprocess can never poison a row", () => {
  const junk = {
    type: "result",
    subtype: "success",
    total_cost_usd: Number.NaN,
    usage: {},
    modelUsage: {
      a: { inputTokens: -5000, outputTokens: Number.POSITIVE_INFINITY, costUSD: "1e9" },
      b: { inputTokens: "999999", outputTokens: null, costUSD: Number.NaN },
      c: null,
      d: { inputTokens: 10.6, outputTokens: 2.4, costUSD: 0.5 },
    },
  };
  const { delta } = usageDelta(ZERO_USAGE, junk);
  for (const [k, v] of Object.entries(delta)) {
    assert.ok(Number.isFinite(v), `${k} is not finite: ${v}`);
    assert.ok(v >= 0, `${k} is negative: ${v}`);
  }
  // Only the one well-formed entry counts, and token counts stay integers.
  assert.equal(delta.inputTokens, 11);
  assert.equal(delta.outputTokens, 2);
  assert.equal(Number.isInteger(delta.inputTokens), true);
  assert.equal(delta.costUsd, 0.5);
});

test("a headline cost that lags the per-model sum banks the LARGER figure", () => {
  // Observed in 3 of this app's 118 real result messages (e.g. task_events 14821): the
  // subprocess reports total_cost_usd BELOW Σ modelUsage[*].costUSD, then emits a
  // duplicate result 2–4 ms later where the headline has caught up. Trusting the headline
  // understates the spend.
  const lagging = {
    type: "result",
    subtype: "success",
    total_cost_usd: 9.546418699999998, // headline, stale
    usage: {},
    modelUsage: {
      "claude-opus-4-8": {
        inputTokens: 1000,
        outputTokens: 60000,
        cacheReadInputTokens: 9000000,
        cacheCreationInputTokens: 500000,
        costUSD: 6.640529199999998,
      },
      "claude-sonnet-4-6": {
        inputTokens: 67,
        outputTokens: 6443,
        cacheReadInputTokens: 219741,
        cacheCreationInputTokens: 57015,
        costUSD: 4.0, // sum = 10.6405292, i.e. $1.09 above the headline
      },
    },
  };
  const { delta, next } = usageDelta(ZERO_USAGE, lagging);
  assert.ok(
    Math.abs(delta.costUsd - 10.640529199999998) < 1e-9,
    `expected the per-model sum ($10.6405), got ${delta.costUsd}`,
  );
  assert.ok(Math.abs(next.costUsd - 10.640529199999998) < 1e-9);
});

test("a subprocess that DIES on a lagging headline still records its full cost", () => {
  // The failure mode the previous test's aggregate assertions can't see: because deltas
  // telescope, a wrong intermediate value is invisible once a later result corrects it.
  // Here the lagging message is the LAST one the subprocess ever emits (crash, cancel,
  // runner restart), so the understatement would be permanent and unrecoverable.
  const events = [
    { type: "log", payload: { message: "Dispatched: /swe:task x" } },
    { type: "message", payload: result({ in: 500, out: 20000 }, 5.0) },
    {
      type: "message",
      payload: {
        ...result({ in: 900, out: 40000 }, 6.1), // headline stalled at 6.1…
        modelUsage: {
          a: {
            inputTokens: 900,
            outputTokens: 40000,
            cacheReadInputTokens: 0,
            cacheCreationInputTokens: 0,
            costUSD: 7.5, // …while the per-model sum says 7.5
          },
        },
      },
    },
    // no further result: the subprocess died here
  ];
  const total = usageFromEvents(events);
  assert.ok(
    Math.abs(total.costUsd - 7.5) < 1e-9,
    `a died-while-lagging subprocess must record $7.50, got ${total.costUsd}`,
  );
});

test("a headline ABOVE the per-model sum is kept (unattributed spend)", () => {
  const { delta } = usageDelta(ZERO_USAGE, {
    type: "result",
    subtype: "success",
    total_cost_usd: 12,
    usage: {},
    modelUsage: { a: { inputTokens: 1, outputTokens: 1, costUSD: 3 } },
  });
  assert.equal(delta.costUsd, 12);
});

test("float noise in cost is not mistaken for a subprocess restart", () => {
  const first = usageDelta(ZERO_USAGE, result({ in: 100, out: 100 }, 5.000000001));
  const second = usageDelta(first.next, result({ in: 100, out: 100 }, 5));
  assert.ok(isZeroUsage(second.delta), `expected no restart, got ${JSON.stringify(second.delta)}`);
});

test("non-result messages are ignored", () => {
  const seen: UsageTotals = { ...ZERO_USAGE, inputTokens: 7, costUsd: 1 };
  for (const m of [
    { type: "assistant", message: { content: "hi" } },
    { type: "system", subtype: "init" },
    null,
    undefined,
    "result",
    { type: "stream_event" },
  ]) {
    const { delta, next } = usageDelta(seen, m);
    assert.ok(isZeroUsage(delta));
    assert.deepEqual(next, seen);
  }
  assert.equal(isResultMessage({ type: "result" }), true);
  assert.equal(isResultMessage({ type: "assistant" }), false);
});

test("launch boundaries are recognised, other logs are not", () => {
  assert.equal(isLaunchBoundary({ type: "log", payload: { message: "Dispatched: /swe:task x" } }), true);
  assert.equal(isLaunchBoundary({ type: "log", payload: { message: "Continuing task (fresh session)" } }), true);
  assert.equal(
    isLaunchBoundary({ type: "log", payload: { message: "Queued — waiting for another job." } }),
    false,
  );
  assert.equal(isLaunchBoundary({ type: "message", payload: { message: "Dispatched: x" } }), false);
  assert.equal(isLaunchBoundary({ type: "log", payload: null }), false);
});

test("addUsage / isZeroUsage", () => {
  assert.ok(isZeroUsage(ZERO_USAGE));
  const sum = addUsage(
    { inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheCreationTokens: 4, costUsd: 0.5 },
    { inputTokens: 10, outputTokens: 20, cacheReadTokens: 30, cacheCreationTokens: 40, costUsd: 1.25 },
  );
  assert.deepEqual(sum, {
    inputTokens: 11,
    outputTokens: 22,
    cacheReadTokens: 33,
    cacheCreationTokens: 44,
    costUsd: 1.75,
  });
  assert.equal(isZeroUsage(sum), false);
});

test("replays a real task's recorded events to the totals a human can check by hand", () => {
  const events = JSON.parse(
    readFileSync(join(import.meta.dirname, "__fixtures__/task-f68c9003-events.json"), "utf8"),
  ) as Array<{ type: string; payload: unknown }>;

  const total = usageFromEvents(events);

  // Two subprocesses; each one's final cumulative snapshot, added together:
  //   subprocess 1 → 9 242 in / 74 997 out / 7 285 678 cache-read / 441 080 cache-write / $8.7571198
  //   subprocess 2 → 1 067 in / 66 443 out / 9 219 741 cache-read / 557 015 cache-write / $10.6405292
  assert.equal(total.inputTokens, 10_309);
  assert.equal(total.outputTokens, 141_440);
  assert.equal(total.cacheReadTokens, 16_505_419);
  assert.equal(total.cacheCreationTokens, 998_095);
  assert.ok(
    Math.abs(total.costUsd - 19.397649) < 1e-9,
    `cost was ${total.costUsd}, expected 19.397649`,
  );

  // The naive readings this helper exists to avoid: summing every result's
  // total_cost_usd over-counts, summing the per-turn `usage` block under-counts.
  const naiveSum = events
    .filter((e) => e.type === "message")
    .reduce((a, e) => a + (e.payload as { total_cost_usd: number }).total_cost_usd, 0);
  assert.ok(naiveSum > 42, `naive cost sum should be ~42.6, was ${naiveSum}`);
  const naiveUsage = events
    .filter((e) => e.type === "message")
    .reduce((a, e) => a + (e.payload as { usage: { input_tokens: number } }).usage.input_tokens, 0);
  assert.ok(naiveUsage < total.inputTokens, `per-turn usage should under-count, was ${naiveUsage}`);
});

// ─── Hardening added after review ───────────────────────────────────────────────

test("absurd magnitudes are rejected, not stored (SQLite won't reject them for us)", () => {
  // better-sqlite3 silently stores 1e308 in an INTEGER column as a float rather than
  // throwing, so a bogus field would poison a total with nothing for a try/catch to catch.
  const { delta } = usageDelta(ZERO_USAGE, {
    type: "result",
    modelUsage: {
      "claude-opus-5": {
        inputTokens: 1e308,
        outputTokens: Number.MAX_VALUE,
        cacheReadInputTokens: 9.3e18,
        cacheCreationInputTokens: 500,
        costUSD: 1e9,
      },
    },
    total_cost_usd: 1e12,
  });
  assert.equal(delta.inputTokens, 0, "1e308 must not reach the column");
  assert.equal(delta.outputTokens, 0);
  assert.equal(delta.cacheReadTokens, 0);
  assert.equal(delta.cacheCreationTokens, 500, "a plausible value alongside still counts");
  assert.equal(delta.costUsd, 0, "an absurd cost must not reach the column");
});

test("a plausibly large real reading is still accepted", () => {
  // The biggest task in this app's real history is ~537M cache-read tokens / $24.59;
  // the ceiling must sit far above anything genuine.
  const { delta } = usageDelta(ZERO_USAGE, {
    type: "result",
    modelUsage: {
      "claude-opus-5": {
        inputTokens: 5_000_000,
        cacheReadInputTokens: 900_000_000,
        costUSD: 250,
      },
    },
    total_cost_usd: 250,
  });
  assert.equal(delta.inputTokens, 5_000_000);
  assert.equal(delta.cacheReadTokens, 900_000_000);
  assert.equal(delta.costUsd, 250);
});

test("modelUsage present but every entry malformed falls back to the per-turn usage block", () => {
  // Otherwise the turn would silently record nothing, even though `usage` had real numbers.
  const { delta } = usageDelta(ZERO_USAGE, {
    type: "result",
    modelUsage: { "claude-opus-5": {}, "claude-haiku-4-5": { nonsense: "x" } },
    usage: { input_tokens: 120, output_tokens: 45 },
    total_cost_usd: 0.5,
  });
  assert.equal(delta.inputTokens, 120, "should fall back rather than record zero");
  assert.equal(delta.outputTokens, 45);
  assert.equal(delta.costUsd, 0.5);
});

test("isLaunchBoundary matches the messages session-manager actually builds", () => {
  // session-manager.ts composes these from LAUNCH_LOG, so this pins the real shapes —
  // a reworded log would fail here rather than silently breaking history replay.
  const real = [
    `${LAUNCH_LOG.dispatched} /swe:task add a thing`,
    `${LAUNCH_LOG.continuing} task (resuming session abcd1234)`,
    `${LAUNCH_LOG.continuing} task (fresh session — inspecting working tree)`,
    `${LAUNCH_LOG.continuing} with requested changes (resuming session abcd1234)`,
    `${LAUNCH_LOG.continuing} with requested changes (fresh session)`,
  ];
  for (const message of real) {
    assert.ok(
      isLaunchBoundary({ type: "log", payload: { message } }),
      `should be a boundary: ${message}`,
    );
  }
  // Every other log session-manager writes must NOT reset the accumulator.
  const notBoundaries = [
    "🧠 Model: opus-5 — complex — multi-file work",
    "Queued — waiting for another job on this project to finish.",
    "Agent paused mid-workflow; nudging it to finish (continue → report gate).",
    "usage accounting skipped: database is locked",
    "error: something failed",
  ];
  for (const message of notBoundaries) {
    assert.ok(
      !isLaunchBoundary({ type: "log", payload: { message } }),
      `should NOT be a boundary: ${message}`,
    );
  }
});

test("one unusable field does not make the whole message look like a restart", () => {
  // Regression: clamping an absurd value to 0 made it read as "counter went backwards",
  // which classified the message as a fresh subprocess and re-banked every OTHER field's
  // full cumulative total — then left the 0 in the snapshot so the next turn double-counted
  // as well. Measured before the fix: $2.70 banked against $1.70 of real spend.
  const turn = (input: unknown, output: number, cacheRead: number, costUSD: number) => ({
    type: "result",
    modelUsage: {
      "claude-opus-5": {
        inputTokens: input,
        outputTokens: output,
        cacheReadInputTokens: cacheRead,
        cacheCreationInputTokens: 0,
        costUSD,
      },
    },
    total_cost_usd: costUSD,
  });

  let seen: UsageTotals = { ...ZERO_USAGE };
  let banked: UsageTotals = { ...ZERO_USAGE };
  const bank = (m: unknown) => {
    const { delta, next } = usageDelta(seen, m);
    banked = addUsage(banked, delta);
    seen = next;
  };

  bank(turn(1000, 800, 500, 1)); //          cumulative, all good
  bank(turn(1e308, 1200, 900, 1.6)); //      turn 2: inputTokens unusable
  bank(turn(1050, 1300, 950, 1.7)); //       turn 3: recovers

  // The real spend is simply the last cumulative snapshot of this one subprocess.
  assert.equal(banked.outputTokens, 1300, "co-reported fields must not be re-banked");
  assert.equal(banked.cacheReadTokens, 950);
  assert.ok(Math.abs(banked.costUsd - 1.7) < 1e-9, `cost was ${banked.costUsd}, want 1.7`);
  // inputTokens banked nothing while unusable, then resumed from its last good baseline.
  assert.equal(banked.inputTokens, 1050);
});

test("a genuine subprocess restart is still detected and banked in full", () => {
  // The per-field change must not cost us real restart detection: with no boundary marker
  // to key off (older history), every counter dropping at once is still a new subprocess.
  const one = {
    type: "result",
    modelUsage: { "claude-opus-5": { inputTokens: 5000, outputTokens: 4000, costUSD: 9 } },
    total_cost_usd: 9,
  };
  const two = {
    type: "result",
    modelUsage: { "claude-opus-5": { inputTokens: 300, outputTokens: 200, costUSD: 0.5 } },
    total_cost_usd: 0.5,
  };
  const first = usageDelta(ZERO_USAGE, one);
  const second = usageDelta(first.next, two);
  assert.equal(second.delta.inputTokens, 300, "full snapshot, not a difference");
  assert.equal(second.delta.outputTokens, 200);
  assert.ok(Math.abs(second.delta.costUsd - 0.5) < 1e-9);
});
