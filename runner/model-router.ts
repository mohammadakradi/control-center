import { query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";

/** Model labels (stored on the task) → SDK model ids. */
export const MODELS = {
  "sonnet-4.6": "claude-sonnet-4-6",
  "opus-4.8": "claude-opus-4-8",
  "sonnet-5": "claude-sonnet-5",
  "fable-5": "claude-fable-5",
} as const;

export type ModelLabel = keyof typeof MODELS;
export type ModelChoice = "auto" | ModelLabel | "sonnet" | "opus"; // last two: legacy stored labels
export type ResolvedModel = {
  id: string; // SDK model id
  label: ModelLabel;
  reason: string;
};

// Legacy labels from before the per-agent tiering (still stored on old tasks).
const LEGACY: Record<string, ModelLabel> = {
  sonnet: "sonnet-4.6",
  opus: "opus-4.8",
};

/** Complexity tiers, mapped to models per agent.
 *  - pm: planning quality is what matters → Sonnet 5 for complex, Sonnet 4.6 otherwise.
 *  - swe/fe (default): Fable 5 for complex builds, Opus 4.8 for routine work,
 *    Sonnet 4.6 for trivial/mechanical changes. */
type Tier = "complex" | "simple" | "trivial";
const TIERS: Record<string, Record<Tier, ModelLabel>> = {
  pm: { complex: "sonnet-5", simple: "sonnet-4.6", trivial: "sonnet-4.6" },
  default: { complex: "fable-5", simple: "opus-4.8", trivial: "sonnet-4.6" },
};

// Cheapest/fastest model — used for tiny side calls (naming a task) where quality
// of prose doesn't matter and latency/cost do.
const HAIKU = "claude-haiku-4-5-20251001";

// Commands that are mechanical / read-only → always the cheapest tier.
// Shared across agents (swe + fe): includes fe's read-only `audit`.
const MECHANICAL = new Set(["ship", "review", "security", "onboard", "workspace", "audit"]);
// Commands that are inherently complex → the agent's top tier.
const COMPLEX_CMDS = new Set(["plan"]);

function tiersFor(namespace: string): Record<Tier, ModelLabel> {
  return TIERS[namespace] ?? TIERS.default;
}

function pick(label: ModelLabel, reason: string): ResolvedModel {
  return { id: MODELS[label], label, reason };
}

function textOf(m: SDKMessage): string {
  const c = (m as { message?: { content?: unknown } }).message?.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c))
    return c
      .filter((b): b is { type: "text"; text: string } => b?.type === "text")
      .map((b) => b.text)
      .join("");
  return "";
}

/** Cheap one-shot complexity classifier (runs on Sonnet 4.6, no tools). */
async function classify(
  command: string,
  requestText: string,
): Promise<{ tier: Tier; reason: string }> {
  const prompt = `Classify this software-engineering request for model routing. Reply with ONLY one word on the first line — "trivial", "simple" or "complex" — then a short reason on the next line.

trivial = a tiny mechanical change: one file / one spot, no design decisions (rename, copy/text tweak, bump a value, toggle a flag).
simple = small, localized, low-risk change: a few files, clear scope (add a small function/component, straightforward bug fix).
complex = multi-file or multi-system, architectural, ambiguous, security-sensitive, concurrency, data migrations, or large/uncertain scope.

Command: ${command}
Request: ${requestText || "(none given)"}`;

  let out = "";
  try {
    for await (const m of query({
      prompt,
      options: {
        model: MODELS["sonnet-4.6"],
        allowedTools: [],
        systemPrompt: "You are a terse software task-complexity classifier.",
      },
    }) as AsyncIterable<SDKMessage>) {
      if (m.type === "assistant") out += textOf(m);
      if (m.type === "result") break;
    }
  } catch {
    return { tier: "complex", reason: "triage failed — defaulting to the strongest model" };
  }
  const firstLine = (out.trim().split(/\r?\n/)[0] || "").toLowerCase();
  const tier: Tier = /\btrivial\b/.test(firstLine)
    ? "trivial"
    : /\bcomplex\b/.test(firstLine) && !/\bsimple\b/.test(firstLine)
      ? "complex"
      : "simple";
  const reason = out.trim().split(/\r?\n/).slice(1).join(" ").trim().slice(0, 180);
  return { tier, reason: reason || firstLine };
}

/**
 * Generate a short, human-readable task title from the request, so task history reads
 * by intent ("Add invoice approval flow") instead of by command ("/swe:task"). Returns
 * null if there's no request to summarize or the model call fails — the caller then
 * falls back to a command-based default.
 */
export async function generateTitle(
  command: string,
  requestText: string,
): Promise<string | null> {
  const base = requestText.trim();
  if (!base) return null;

  const prompt = `Summarize this software task as a short title: 3–8 words, Title Case, no quotes, no trailing period. Name WHAT changes and WHERE (the feature/area/page), not the command or the agent. Reply with ONLY the title.

Command: ${command}
Request: ${base.slice(0, 1500)}`;

  let out = "";
  try {
    for await (const m of query({
      prompt,
      options: {
        model: HAIKU,
        allowedTools: [],
        systemPrompt: "You write terse, specific task titles.",
      },
    }) as AsyncIterable<SDKMessage>) {
      if (m.type === "assistant") out += textOf(m);
      if (m.type === "result") break;
    }
  } catch {
    return null;
  }

  // Take the first non-empty line, strip stray quotes/markdown/leading bullets, cap length.
  const line = out
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find(Boolean);
  if (!line) return null;
  const title = line
    .replace(/^[#*\-\s"'`]+/, "")
    .replace(/["'`.\s]+$/, "")
    .slice(0, 80)
    .trim();
  return title || null;
}

/**
 * Decide which model a task should run on.
 * - explicit user choice (a concrete model) wins — legacy "sonnet"/"opus" map to
 *   Sonnet 4.6 / Opus 4.8
 * - mechanical commands → the cheapest tier; `plan` → the agent's top tier
 * - task/fix on "auto" → triage the request into trivial/simple/complex and map it
 *   through the agent's tier table:
 *     pm      → complex: Sonnet 5 · otherwise: Sonnet 4.6
 *     swe/fe  → complex: Fable 5 · simple: Opus 4.8 · trivial: Sonnet 4.6
 */
export async function resolveModel(
  namespace: string,
  command: string,
  requestText: string,
  choice: ModelChoice,
): Promise<ResolvedModel> {
  const tiers = tiersFor(namespace);

  if (choice !== "auto") {
    const label = (LEGACY[choice] ?? choice) as ModelLabel;
    if (label in MODELS) return pick(label, "selected by user");
  }
  if (MECHANICAL.has(command))
    return pick(tiers.trivial, `mechanical command :${command}`);
  if (COMPLEX_CMDS.has(command))
    return pick(tiers.complex, `:${command} is inherently complex`);

  const { tier, reason } = await classify(command, requestText);
  return pick(tiers[tier], `${tier} — ${reason}`);
}
