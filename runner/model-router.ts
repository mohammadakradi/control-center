import { query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { TaskEnv } from "./user-env";

/** Model labels (stored on the task) → SDK model ids. Opus 4.8 stays resolvable
 *  (legacy/explicit) but auto-routing never selects it — Opus 5 replaced it. */
export const MODELS = {
  "sonnet-5": "claude-sonnet-5",
  "opus-5": "claude-opus-5",
  "opus-4.8": "claude-opus-4-8",
  "fable-5": "claude-fable-5",
} as const;

export type ModelLabel = keyof typeof MODELS;
export type ModelChoice = "auto" | ModelLabel | "sonnet" | "opus" | "sonnet-4.6"; // last three: legacy stored labels
export type ResolvedModel = {
  id: string; // SDK model id
  label: ModelLabel;
  reason: string;
};

// Legacy labels still stored on old tasks. Sonnet 4.6 is retired — anything that
// used it (or the bare aliases) now runs on the current tier equivalents.
const LEGACY: Record<string, ModelLabel> = {
  sonnet: "sonnet-5",
  "sonnet-4.6": "sonnet-5",
  opus: "opus-4.8",
};

/**
 * Complexity tiers, mapped to models per agent.
 *  - pm: Opus 5 for very complex planning; Sonnet 5 for everything else.
 *  - swe/fe (default): Opus 5 for complex and very complex work, Sonnet 5 for simple
 *    changes. Sonnet 4.6 / Opus 4.8 are never auto-selected.
 *
 * **Fable 5 is deliberately not auto-selected**, though it stays fully available when a user
 * picks it. It is $10/$50 per Mtok against Opus 5's $5/$25 — double the price on a tier
 * chosen by a *triage guess* about a request nobody has read yet. Measured on this install:
 * 17 auto-routed Fable runs cost $389, averaging $23 each, with no evidence the escalation
 * was needed. Paying twice as much is a decision worth making on purpose, so it moved to the
 * model picker. `CC_ENABLE_FABLE_TIER=1` restores the old auto-escalation.
 */
type Tier = "very-complex" | "complex" | "simple";
const FABLE_TIER_ENABLED = process.env.CC_ENABLE_FABLE_TIER === "1";
/** Top of the auto-routed ladder — Fable 5 only when an operator asked for it. */
const TOP: ModelLabel = FABLE_TIER_ENABLED ? "fable-5" : "opus-5";
const TIERS: Record<string, Record<Tier, ModelLabel>> = {
  pm: { "very-complex": TOP, complex: "sonnet-5", simple: "sonnet-5" },
  default: { "very-complex": TOP, complex: "opus-5", simple: "sonnet-5" },
};

// Cheapest/fastest model — used for tiny side calls (naming a task) where quality
// of prose doesn't matter and latency/cost do.
const HAIKU = "claude-haiku-4-5-20251001";

// Commands that are mechanical / read-only → always the cheapest tier.
// Shared across agents (swe + fe): includes fe's read-only `audit`.
const MECHANICAL = new Set(["ship", "review", "security", "onboard", "workspace", "audit"]);
// Commands that are inherently at least complex — triage still runs so a truly
// massive request can escalate to very-complex, but the floor is "complex".
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

/** Cheap one-shot complexity classifier (runs on Sonnet 5, no tools).
 *  `env` carries the task owner's token so triage bills them, not a shared credential. */
async function classify(
  command: string,
  requestText: string,
  env: TaskEnv,
): Promise<{ tier: Tier; reason: string }> {
  const prompt = `Classify this software-engineering request for model routing. Reply with ONLY the tier on the first line — "simple", "complex" or "very complex" — then a short reason on the next line.

simple = small, localized, low-risk change: one or a few files, clear scope, no design decisions (rename, copy tweak, small function/component, straightforward bug fix).
complex = multi-file work with real design decisions: a feature touching several components, a non-trivial bug, refactoring, API/schema changes with clear scope.
very complex = architectural or system-wide: multi-system/cross-stack, ambiguous or very large scope, security-sensitive, concurrency, data migrations, or high-risk changes.

Command: ${command}
Request: ${requestText || "(none given)"}`;

  let out = "";
  try {
    for await (const m of query({
      prompt,
      options: {
        model: MODELS["sonnet-5"],
        env,
        allowedTools: [],
        systemPrompt: "You are a terse software task-complexity classifier.",
      },
    }) as AsyncIterable<SDKMessage>) {
      if (m.type === "assistant") out += textOf(m);
      if (m.type === "result") break;
    }
  } catch {
    return {
      tier: "very-complex",
      reason: "triage failed — defaulting to the strongest model",
    };
  }
  const firstLine = (out.trim().split(/\r?\n/)[0] || "").toLowerCase();
  const tier: Tier = /very[\s-]?complex/.test(firstLine)
    ? "very-complex"
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
  env: TaskEnv,
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
        env,
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
 * - explicit user choice (a concrete model) wins — legacy labels ("sonnet",
 *   "sonnet-4.6", "opus") map to their current equivalents
 * - mechanical commands → the simple tier
 * - "auto" → triage the request into simple/complex/very-complex and map it
 *   through the agent's tier table (for `plan` the floor is "complex"):
 *     pm      → very complex: Fable 5 · otherwise: Sonnet 5
 *     swe/fe  → very complex: Fable 5 · complex: Opus 5 · simple: Sonnet 5
 */
export async function resolveModel(
  namespace: string,
  command: string,
  requestText: string,
  choice: ModelChoice,
  env: TaskEnv,
): Promise<ResolvedModel> {
  const tiers = tiersFor(namespace);

  if (choice !== "auto") {
    const label = (LEGACY[choice] ?? choice) as ModelLabel;
    if (label in MODELS) return pick(label, "selected by user");
  }
  if (MECHANICAL.has(command))
    return pick(tiers.simple, `mechanical command :${command}`);

  let { tier, reason } = await classify(command, requestText, env);
  if (COMPLEX_CMDS.has(command) && tier === "simple") {
    tier = "complex";
    reason = `:${command} is inherently complex (floor)`;
  }
  return pick(tiers[tier], `${tier} — ${reason}`);
}
