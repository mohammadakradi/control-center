/**
 * The model + effort vocabulary and the per-agent policy that gates it.
 *
 * The direction of every default here is the point. This install auto-routed 17 runs onto
 * Fable 5 for $389 — twice Opus 5's per-token price — because the expensive tier was reachable
 * without anyone choosing it. So: an unconfigured agent must resolve to *not* having the
 * expensive model, and a broken policy must fail toward the cheap side, never the costly one.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_DENIED_MODELS,
  EFFORT_LEVELS,
  MODEL_CATALOG,
  MODEL_LABELS,
  effortForModel,
  allowedModelsFor,
  defaultAllowedModels,
  isModelAllowed,
  normalizeEffortChoice,
  normalizeModelChoice,
  policyFallback,
} from "./models";

test("an agent nobody has configured does not get the expensive model", () => {
  // The critical case: a fresh install, before anyone opens Settings. "No row" must mean the
  // defaults, not "everything allowed".
  const allowed = allowedModelsFor(null);
  assert.ok(!allowed.includes("fable-5"));
  assert.ok(allowed.includes("opus-5"));
  assert.ok(allowed.includes("sonnet-5"));
  assert.deepEqual(allowed, defaultAllowedModels());
});

test("Fable is denied by default, and is still a real selectable label", () => {
  // Denied by policy, not removed from the vocabulary — turning it on per agent must work.
  for (const fable of ["fable-5", "fable-5.1"] as const) {
    assert.ok(DEFAULT_DENIED_MODELS.includes(fable));
    assert.ok(MODEL_LABELS.includes(fable));
  }
});

test("only the Sonnet 5 / Opus 5 generations are on out of the box", () => {
  // An allowlist, so a model added to the catalog later starts off rather than appearing in
  // every picker the day it ships.
  assert.deepEqual(defaultAllowedModels(), ["sonnet-5", "sonnet-5.5", "opus-5.5", "opus-5"]);
});

test("the catalog is cheapest-first — the order the router clamps down", () => {
  // Clamping walks down this list. If a dearer model sat below a cheaper one, denying the
  // cheaper one would route a run *up* in price.
  for (let i = 1; i < MODEL_CATALOG.length; i++) {
    const prev = MODEL_CATALOG[i - 1];
    const cur = MODEL_CATALOG[i];
    assert.ok(
      cur.output >= prev.output && cur.input >= prev.input,
      `${cur.label} is cheaper than ${prev.label} but sits above it`,
    );
  }
  assert.equal(new Set(MODEL_LABELS).size, MODEL_LABELS.length, "labels must be unique");
});

test("an explicit policy is honored, including one that allows the expensive model", () => {
  assert.deepEqual(allowedModelsFor(["sonnet-5", "fable-5"]), ["sonnet-5", "fable-5"]);
  assert.ok(isModelAllowed("fable-5", ["fable-5"]));
  assert.ok(!isModelAllowed("fable-5", ["sonnet-5", "opus-5"]));
});

test("a policy listing nothing usable falls back to the cheapest model, never the dearest", () => {
  // The column is plain JSON: an import or a hand-edit can produce an empty or garbage list.
  // Refusing every dispatch would be a dead end, so the agent stays runnable — but a broken
  // policy must not become a licence to spend.
  for (const broken of [[], ["nonsense"], ["gpt-4"]]) {
    const allowed = allowedModelsFor(broken);
    assert.deepEqual(allowed, policyFallback());
    assert.equal(allowed[0], defaultAllowedModels()[0], "the cheapest default, not Haiku");
    assert.ok(!allowed.includes("fable-5"));
  }
});

test("policy resolution preserves the cheapest-first ladder order", () => {
  // The router clamps by walking this order downwards; a reordering here would silently make
  // it clamp upwards, onto a more expensive model.
  assert.deepEqual(allowedModelsFor(["fable-5", "sonnet-5", "opus-5"]), [
    "sonnet-5",
    "opus-5",
    "fable-5",
  ]);
});

test("an unknown model or effort routes instead of reaching the SDK", () => {
  assert.equal(normalizeModelChoice("gpt-4"), "auto");
  assert.equal(normalizeModelChoice(undefined), "auto");
  assert.equal(normalizeModelChoice(""), "auto");
  assert.equal(normalizeEffortChoice("turbo"), "auto");
  assert.equal(normalizeEffortChoice(null), "auto");
});

test("real choices survive normalization, legacy labels included", () => {
  assert.equal(normalizeModelChoice("opus-5"), "opus-5");
  assert.equal(normalizeModelChoice("auto"), "auto");
  // Older and legacy labels still resolve so a historical task can be continued as it started.
  assert.equal(normalizeModelChoice("opus-4.8"), "opus-4.8");
  assert.equal(normalizeModelChoice("sonnet-4.6"), "sonnet-4.6");
  assert.equal(normalizeModelChoice("opus"), "opus");
  assert.equal(normalizeModelChoice("fable-5.1"), "fable-5.1");
  for (const level of EFFORT_LEVELS) assert.equal(normalizeEffortChoice(level), level);
});

test("max effort is deliberately not offered", () => {
  // This control exists to reduce spend; `max` is the one direction that raises it. It is a
  // valid SDK level, so this is a product decision and the test records it as one.
  assert.ok(!(EFFORT_LEVELS as readonly string[]).includes("max"));
  assert.equal(normalizeEffortChoice("max"), "auto");
});

test("effort is clamped to what the model accepts", () => {
  // Current models take every offered level unchanged.
  for (const level of EFFORT_LEVELS) assert.equal(effortForModel("opus-5.5", level), level);
  // The 4.6 generation predates xhigh: step down, never up.
  assert.equal(effortForModel("opus-4.6", "xhigh"), "high");
  assert.equal(effortForModel("sonnet-4.6", "medium"), "medium");
  // Haiku 4.5 has no effort control — sending one is a 400, so the answer is "omit it".
  assert.equal(effortForModel("haiku-4.5", "low"), null);
  // A legacy alias isn't in the catalog; it runs on a current model, so pass the level through.
  assert.equal(effortForModel("opus", "high"), "high");
});
