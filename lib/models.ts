/**
 * The model + effort vocabulary, and the per-agent policy that gates it.
 *
 * This lives in `lib/` rather than `runner/` because three places need the same answer and
 * must not drift: dispatch (which refuses a disallowed choice), the runner's router (which
 * auto-selects within the policy), and the UI (which offers only what is allowed). A second
 * copy of this list is how a model becomes selectable in the picker but refused at dispatch.
 */

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

const ALL_EFFORTS = EFFORT_LEVELS;
/** The 4.6 generation predates `xhigh` (it arrived with Opus 4.7). */
const NO_XHIGH = ["low", "medium", "high"] as const;

/**
 * Every Claude model this install can run, **cheapest first**. The one list — the picker, the
 * settings toggles, the router's clamping ladder and the display names all derive from it.
 *
 * Order is by per-token price, and within a price by age (older first). The router clamps a
 * denied model by walking *down* this list, so the order is what guarantees a policy change
 * can only ever make a run cheaper, never dearer. `lib/models.test.ts` pins it.
 *
 * Prices are Anthropic's first-party $/Mtok (input/output), shown in Settings so the reason a
 * model is off by default is on screen. Actual spend is read from the SDK's own
 * `total_cost_usd` (`runner/usage.ts`), never computed from these.
 *
 * Adding a model is one entry here. Claude Mythos is left out on purpose: it is only served
 * to Project Glasswing, so on every other account it would be a toggle that 400s.
 */
export const MODEL_CATALOG = [
  { label: "haiku-4.5", id: "claude-haiku-4-5", name: "Haiku 4.5", family: "Haiku", input: 1, output: 5, efforts: [] },
  { label: "sonnet-5", id: "claude-sonnet-5", name: "Sonnet 5", family: "Sonnet", input: 2, output: 10, efforts: ALL_EFFORTS },
  { label: "sonnet-5.5", id: "claude-sonnet-5-5", name: "Sonnet 5.5", family: "Sonnet", input: 2, output: 10, efforts: ALL_EFFORTS },
  { label: "sonnet-4.6", id: "claude-sonnet-4-6", name: "Sonnet 4.6", family: "Sonnet", input: 3, output: 15, efforts: NO_XHIGH },
  { label: "opus-5.5", id: "claude-opus-5-5", name: "Opus 5.5", family: "Opus", input: 4, output: 20, efforts: ALL_EFFORTS },
  { label: "opus-4.6", id: "claude-opus-4-6", name: "Opus 4.6", family: "Opus", input: 5, output: 25, efforts: NO_XHIGH },
  { label: "opus-4.7", id: "claude-opus-4-7", name: "Opus 4.7", family: "Opus", input: 5, output: 25, efforts: ALL_EFFORTS },
  { label: "opus-4.8", id: "claude-opus-4-8", name: "Opus 4.8", family: "Opus", input: 5, output: 25, efforts: ALL_EFFORTS },
  { label: "opus-5", id: "claude-opus-5", name: "Opus 5", family: "Opus", input: 5, output: 25, efforts: ALL_EFFORTS },
  { label: "fable-5", id: "claude-fable-5", name: "Fable 5", family: "Fable", input: 10, output: 50, efforts: ALL_EFFORTS },
  { label: "fable-5.1", id: "claude-fable-5-1", name: "Fable 5.1", family: "Fable", input: 10, output: 50, efforts: ALL_EFFORTS },
] as const satisfies readonly {
  label: string;
  id: string;
  name: string;
  family: "Haiku" | "Sonnet" | "Opus" | "Fable";
  input: number;
  output: number;
  /** Effort levels the model accepts. Empty = no effort control at all (Haiku 4.5 400s). */
  efforts: readonly EffortLevel[];
}[];

export type ModelInfo = (typeof MODEL_CATALOG)[number];

/** Selectable model labels, cheapest first. Stored on `tasks.model`. */
export const MODEL_LABELS = MODEL_CATALOG.map((m) => m.label);
export type ModelLabel = ModelInfo["label"];

/**
 * Bare aliases from before the per-agent tiering. They still appear on old rows (and still
 * resolve, so a historical task can be continued), but never reach a picker.
 */
export const LEGACY_MODEL_LABELS = ["sonnet", "opus"] as const;
/** What each legacy alias runs on now. */
export const LEGACY_MODEL_ALIASES: Record<(typeof LEGACY_MODEL_LABELS)[number], ModelLabel> = {
  sonnet: "sonnet-5",
  opus: "opus-4.8",
};

const CATALOG_BY_LABEL: ReadonlyMap<string, ModelInfo> = new Map(
  MODEL_CATALOG.map((m) => [m.label, m]),
);

/** Catalog entry for a label, or undefined for a legacy alias / unknown value. */
export function modelInfo(label: string): ModelInfo | undefined {
  return CATALOG_BY_LABEL.get(label);
}

/**
 * The effort level to actually send for this model: the requested level, or the highest one
 * below it the model accepts. `null` means the model has no effort control and the option
 * must be omitted entirely — sending it to Haiku 4.5 is a 400, not a no-op.
 */
export function effortForModel(label: string, level: EffortLevel): EffortLevel | null {
  const supported: readonly EffortLevel[] = modelInfo(label)?.efforts ?? EFFORT_LEVELS;
  if (supported.length === 0) return null;
  if (supported.includes(level)) return level;
  const below = EFFORT_LEVELS.slice(0, EFFORT_LEVELS.indexOf(level)).filter((l) =>
    supported.includes(l),
  );
  return below.at(-1) ?? supported[0];
}

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
 * Models an agent may use when nothing has been configured: the Sonnet 5 and Opus 5
 * generations. An allowlist rather than a denylist, so a model added to the catalog starts
 * **off** everywhere — it appears in Settings to be switched on, never silently in a picker.
 *
 * **Fable is denied by default, for every agent.** It is $10/$50 per Mtok against Opus 5's
 * $5/$25 — double the price — and when it was auto-routed here, 17 runs cost $389 (averaging
 * $23) with no evidence the escalation was needed. A model that costs twice as much should be
 * switched on deliberately, per agent, by someone who decided they want it. Haiku (no effort
 * control) and the 4.x generation are off for the plainer reason that nothing needs them.
 */
const DEFAULT_ALLOWED: readonly ModelLabel[] = ["sonnet-5", "sonnet-5.5", "opus-5.5", "opus-5"];

/** Everything outside the default allowlist. */
export const DEFAULT_DENIED_MODELS: readonly ModelLabel[] = MODEL_LABELS.filter(
  (m) => !DEFAULT_ALLOWED.includes(m),
);

/** The default allowlist, in ladder order. */
export function defaultAllowedModels(): ModelLabel[] {
  return MODEL_LABELS.filter((m) => DEFAULT_ALLOWED.includes(m));
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
 * confusing dead end, so the cheapest *default* model stays available and the UI says the
 * policy was ignored. Never the expensive one: a broken policy must fail toward the cheap side.
 * (Not the cheapest in the catalog: that is Haiku, which is off by default and is not an agent
 * a broken config should quietly hand your work to.)
 */
export function policyFallback(): ModelLabel[] {
  return [defaultAllowedModels()[0]];
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
