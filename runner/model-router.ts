import { query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";

export const MODELS = {
  sonnet: "claude-sonnet-4-6",
  opus: "claude-opus-4-8",
} as const;

export type ModelChoice = "auto" | "sonnet" | "opus";
export type ResolvedModel = {
  id: string; // SDK model id
  label: "sonnet" | "opus";
  reason: string;
};

// Commands that are mechanical / read-only → always cheap (Sonnet).
// Shared across agents (swe + fe): includes fe's read-only `audit`.
const MECHANICAL = new Set(["ship", "review", "security", "onboard", "workspace", "audit"]);
// Commands that are inherently complex → Opus.
const COMPLEX_CMDS = new Set(["plan"]);

function pick(label: "sonnet" | "opus", reason: string): ResolvedModel {
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

/** Cheap one-shot complexity classifier (runs on Sonnet, no tools). */
async function classify(
  command: string,
  requestText: string,
): Promise<{ complex: boolean; reason: string }> {
  const prompt = `Classify this software-engineering request for model routing. Reply with ONLY one word on the first line — "simple" or "complex" — then a short reason on the next line.

simple = small, localized, low-risk change: a few files, clear scope, mechanical (rename, copy tweak, add a small function, trivial bug).
complex = multi-file or multi-system, architectural, ambiguous, security-sensitive, concurrency, data migrations, or large/uncertain scope.

Command: ${command}
Request: ${requestText || "(none given)"}`;

  let out = "";
  try {
    for await (const m of query({
      prompt,
      options: {
        model: MODELS.sonnet,
        allowedTools: [],
        systemPrompt: "You are a terse software task-complexity classifier.",
      },
    }) as AsyncIterable<SDKMessage>) {
      if (m.type === "assistant") out += textOf(m);
      if (m.type === "result") break;
    }
  } catch {
    return { complex: true, reason: "triage failed — defaulting to the stronger model" };
  }
  const firstLine = (out.trim().split(/\r?\n/)[0] || "").toLowerCase();
  const complex = /\bcomplex\b/.test(firstLine) && !/\bsimple\b/.test(firstLine);
  const reason = out.trim().split(/\r?\n/).slice(1).join(" ").trim().slice(0, 180);
  return { complex, reason: reason || firstLine };
}

/**
 * Decide which model a task should run on.
 * - explicit user choice (sonnet/opus) wins
 * - mechanical commands → sonnet; plan → opus
 * - task/fix on "auto" → triage the request (simple→sonnet, complex→opus)
 */
export async function resolveModel(
  command: string,
  requestText: string,
  choice: ModelChoice,
): Promise<ResolvedModel> {
  if (choice === "sonnet") return pick("sonnet", "selected by user");
  if (choice === "opus") return pick("opus", "selected by user");
  if (MECHANICAL.has(command)) return pick("sonnet", `mechanical command :${command}`);
  if (COMPLEX_CMDS.has(command)) return pick("opus", `:${command} is inherently complex`);

  const { complex, reason } = await classify(command, requestText);
  return complex
    ? pick("opus", `complex — ${reason}`)
    : pick("sonnet", `simple — ${reason}`);
}
