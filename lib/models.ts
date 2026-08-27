/**
 * The model + effort vocabulary, and the per-agent policy that gates it.
 *
 * This lives in `lib/` rather than `runner/` because three places need the same answer and
 * must not drift: dispatch (which refuses a disallowed choice), the runner's router (which
 * auto-selects within the policy), and the UI (which offers only what is allowed). A second
 * copy of this list is how a model becomes selectable in the picker but refused at dispatch.
 */

/** Selectable model labels, cheapest tier first. Stored on `tasks.model`. */
export const MODEL_LABELS = ["sonnet-5", "opus-5", "fable-5"] as const;
export type ModelLabel = (typeof MODEL_LABELS)[number];

/**
 * Labels that are no longer offered but still appear on old rows (and still resolve, so a
 * historical task can be continued on what it started with). Kept separate from
 * `MODEL_LABELS` so they never reach a picker.
 */
export const LEGACY_MODEL_LABELS = ["opus-4.8", "sonnet-4.6", "sonnet", "opus"] as const;

/**
 * Reasoning effort. The SDK's `Options.effort`, which guides thinking depth *and* how much
 * work the agent does per turn — at lower effort it makes fewer, more consolidated tool
 * calls and writes less preamble.
 *
 * That second effect is the one that matters for cost here. Thinking itself measured at only
 * 4% of output tokens on this install (~$22 of $2,813), so effort does not save money by
 * thinking less; it saves it by producing a shorter transcript, and transcript re-transmission
 * is 60% of the bill (`.swe/notes/cost-and-context.md`).
 *
 * `max` exists in the SDK but is deliberately not offered: this control was added to *reduce*
 * spend, and `max` is the one direction that raises it. Add it to this list if that changes.
 */
export const EFFORT_LEVELS = ["low", "medium", "high", "xhigh"] as const;
export type EffortLevel = (typeof EFFORT_LEVELS)[number];

/** What the user picked: a concrete choice, or "auto" to let the router decide. */
export type ModelChoice = "auto" | string;
export type EffortChoice = "auto" | EffortLevel;

const MODEL_SET: ReadonlySet<string> = new Set([...MODEL_LABELS, ...LEGACY_MODEL_LABELS]);
const EFFORT_SET: ReadonlySet<string> = new Set(EFFORT_LEVELS);

/** Is this a label the system knows at all (including retired ones)? */
export function isKnownModel(value: string | null | undefined): boolean {
  return MODEL_SET.has(value ?? "");
}

/** Anything unrecognised becomes "auto" rather than being handed to the SDK. */
export function normalizeModelChoice(value: string | null | undefined): string {
  return value === "auto" || isKnownModel(value) ? (value as string) : "auto";
}

/** Same for effort. An unknown or absent value routes rather than guessing a level. */
export function normalizeEffortChoice(value: string | null | undefined): EffortChoice {
  return EFFORT_SET.has(value ?? "") ? (value as EffortLevel) : "auto";
}

/**
 * Models an agent may use when nothing has been configured.
 *
 * **Fable 5 is denied by default, for every agent.** It is $10/$50 per Mtok against Opus 5's
 * $5/$25 — double the price — and when it was auto-routed here, 17 runs cost $389 (averaging
 * $23) with no evidence the escalation was needed. A model that costs twice as much should be
 * switched on deliberately, per agent, by someone who decided they want it.
 */
export const DEFAULT_DENIED_MODELS: readonly ModelLabel[] = ["fable-5"];

/** The default allowlist: everything except the denied set. */
export function defaultAllowedModels(): ModelLabel[] {
  return MODEL_LABELS.filter((m) => !DEFAULT_DENIED_MODELS.includes(m));
}

/**
 * Resolve a stored policy row into the set of models an agent may run.
 *
 * A missing row means "never configured" → the defaults above, **not** "everything allowed":
 * a fresh install must not auto-route to the expensive model just because nobody has opened
 * Settings yet. An empty stored list is a real, if unusable, configuration — every model
 * denied — and `policyFallback` is what stops that from making the agent undispatchable.
 */
export function allowedModelsFor(
  stored: readonly string[] | null | undefined,
): ModelLabel[] {
  if (!stored) return defaultAllowedModels();
  const allowed = MODEL_LABELS.filter((m) => stored.includes(m));
  return allowed.length > 0 ? allowed : policyFallback();
}

/**
 * What an agent runs on when its policy allows nothing at all.
 *
 * Denying every model is a configuration a UI shouldn't let you save, but the column is plain
 * JSON and an import or a hand-edit can produce it. Refusing every dispatch would be a
 * confusing dead end, so the cheapest model stays available and the UI says the policy was
 * ignored. Never the expensive one: a broken policy must fail toward the cheap side.
 */
export function policyFallback(): ModelLabel[] {
  return [MODEL_LABELS[0]];
}

/** Is this model allowed for this agent, given its stored policy? */
export function isModelAllowed(
  model: string,
  stored: readonly string[] | null | undefined,
): boolean {
  // A legacy label on an old task is judged by the policy too — but it can never be *picked*,
  // so this only matters when continuing a historical run.
  return (allowedModelsFor(stored) as readonly string[]).includes(model);
}
