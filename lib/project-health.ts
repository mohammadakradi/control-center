import { existsSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";

/**
 * What an already-onboarded project is costing per run, and what would fix it.
 *
 * An app update swaps `~/.control-center/app/` and runs migrations. It never touches a
 * *project* folder — so every doc the agents wrote under the old rules survives the update
 * untouched. That is not a detail: the single largest saving measured on this install was
 * `CLAUDE.md` going 147 KB → 13 KB, worth ~25% of the project's entire spend
 * (`.swe/notes/cost-and-context.md`), and an updating user gets exactly none of it. Their
 * agents behave better; their documents still cost what they always did.
 *
 * The platform can't fix that by itself. Rewriting a `CLAUDE.md` means deciding what to keep,
 * which is the onboard skill's judgment, not a `sed` script. What it *can* do is stop the
 * problem being invisible: measure the files against the budgets the rules already state, put
 * a number on them, and make the fix one click.
 *
 * Sizes are read with `statSync`, never by reading the files in — the whole point is to avoid
 * pulling large documents into memory (or, worse, into a prompt) just to learn they're large.
 */

/** Bytes per token, for turning a file size into what it costs in a prompt. The agent rules
 *  use the same ratio ("at 150 KB it is ~38k tokens"), so the two can't drift apart. */
const BYTES_PER_TOKEN = 4;

/**
 * The budgets, exactly as the agent rules state them. Sourced from
 * `agents/swe/rules/engineering-rules.md` (7, 10), `agents/fe/rules/frontend-rules.md` and
 * `agents/pm/rules/pm-rules.md` — if a rule changes, change it here too, or the app will
 * report a project as healthy against a budget nobody enforces any more.
 */
export const DOC_BUDGETS = {
  "CLAUDE.md": 20_000,
  ".fe/design-system.md": 25_000,
  ".swe/notes.md": 8_000,
  ".fe/notes.md": 8_000,
  ".pm/notes.md": 8_000,
} as const;

/** Per-file budget for a journal topic under `.{swe,fe,pm}/notes/`. */
export const NOTE_BUDGET = 30_000;

/** Journal directories to sweep for oversize topics. */
const NOTE_DIRS = [".swe/notes", ".fe/notes", ".pm/notes"] as const;

/**
 * `CLAUDE.md` is the only one of these the harness injects before the first turn, so it is
 * the only one whose size is paid on *every* API call rather than once when something reads
 * it. That distinction drives how findings are ranked, so it lives here rather than being
 * re-derived by each caller.
 */
const INJECTED = "CLAUDE.md";

export type HealthFinding = {
  kind: "oversize-doc" | "missing-graph" | "stale-plugin";
  /** Project-relative path, or the plugin namespace for `stale-plugin`. */
  subject: string;
  bytes?: number;
  budget?: number;
  /** Tokens this adds to *every* API call. Only ever set for `CLAUDE.md`. */
  tokensPerCall?: number;
  /** Ordering hint — higher is worse. Injected bloat outranks a read-on-demand file. */
  weight: number;
  detail: string;
};

export type ProjectHealth = {
  /** Onboarded at all? An un-onboarded project has nothing to remediate — it gets correct
   *  documents and a graph the first time it is onboarded, which is the normal path. */
  onboarded: boolean;
  hasGraph: boolean;
  findings: HealthFinding[];
  /** Tokens added to every call by injected docs. The headline number. */
  tokensPerCall: number;
};

function sizeOf(path: string): number | null {
  try {
    const s = statSync(path);
    return s.isFile() ? s.size : null;
  } catch {
    return null;
  }
}

export function estimateTokens(bytes: number): number {
  return Math.round(bytes / BYTES_PER_TOKEN);
}

/** Every journal topic that has outgrown `NOTE_BUDGET`, project-relative. */
function oversizeNotes(projectPath: string): { rel: string; bytes: number }[] {
  const out: { rel: string; bytes: number }[] = [];
  for (const dir of NOTE_DIRS) {
    let names: string[];
    try {
      names = readdirSync(resolve(projectPath, dir));
    } catch {
      continue; // the agent that owns this journal was never onboarded here
    }
    for (const name of names) {
      if (!name.endsWith(".md")) continue;
      const bytes = sizeOf(resolve(projectPath, dir, name));
      if (bytes !== null && bytes > NOTE_BUDGET) out.push({ rel: `${dir}/${name}`, bytes });
    }
  }
  return out;
}

/**
 * Measure one project against the documented budgets.
 *
 * `bundledVersions` is the version of each agent plugin shipped with *this* app, keyed by
 * namespace. When a namespace's plugin is instead a CLI install that is older, its rule
 * changes never arrived — `discoverAgents()` prefers the CLI copy — so the user can update the
 * app forever and keep running last month's workflow. Pass `installedVersions` to have that
 * checked; omit either map to skip the check.
 */
export function scanProjectHealth(
  projectPath: string,
  opts: {
    bundledVersions?: Record<string, string | null>;
    installedVersions?: Record<string, { version: string | null; fromCli: boolean }>;
  } = {},
): ProjectHealth {
  const onboarded = existsSync(resolve(projectPath, "CLAUDE.md"));
  const hasGraph = existsSync(resolve(projectPath, "graphify-out/graph.json"));
  const findings: HealthFinding[] = [];
  let tokensPerCall = 0;

  for (const [rel, budget] of Object.entries(DOC_BUDGETS)) {
    const bytes = sizeOf(resolve(projectPath, rel));
    if (bytes === null) continue;
    const injected = rel === INJECTED;
    if (injected) tokensPerCall += estimateTokens(bytes);
    if (bytes <= budget) continue;
    findings.push({
      kind: "oversize-doc",
      subject: rel,
      bytes,
      budget,
      ...(injected ? { tokensPerCall: estimateTokens(bytes) } : {}),
      // Injected bloat is paid per call; everything else is paid when something reads it.
      // A 3x-over CLAUDE.md is a worse problem than a 3x-over note, so the two can't share
      // a scale.
      weight: injected ? 1000 + bytes / budget : 100 + bytes / budget,
      detail: injected
        ? `${kb(bytes)} against a ${kb(budget)} budget — about ${estimateTokens(bytes).toLocaleString()} tokens added to every API call this project makes.`
        : `${kb(bytes)} against a ${kb(budget)} budget — read into context whenever an agent opens it.`,
    });
  }

  for (const note of oversizeNotes(projectPath)) {
    findings.push({
      kind: "oversize-doc",
      subject: note.rel,
      bytes: note.bytes,
      budget: NOTE_BUDGET,
      weight: 50 + note.bytes / NOTE_BUDGET,
      detail: `${kb(note.bytes)} against a ${kb(NOTE_BUDGET)} budget — split it into narrower topics.`,
    });
  }

  // Only worth reporting on a project that has been onboarded: an un-onboarded one builds its
  // graph the moment it is (runner/code-graph.ts), so there is nothing for the user to do.
  if (onboarded && !hasGraph) {
    findings.push({
      kind: "missing-graph",
      subject: "graphify-out/graph.json",
      weight: 500,
      detail:
        "No code graph, so every structural question falls back to grep-and-read. Built " +
        "automatically the next time this project is onboarded.",
    });
  }

  const { bundledVersions, installedVersions } = opts;
  if (bundledVersions && installedVersions) {
    for (const [ns, installed] of Object.entries(installedVersions)) {
      const bundled = bundledVersions[ns];
      if (!installed.fromCli || !bundled || !installed.version) continue;
      if (compareVersions(installed.version, bundled) >= 0) continue;
      findings.push({
        kind: "stale-plugin",
        subject: ns,
        weight: 800,
        detail:
          `A CLI-installed \`${ns}\` plugin (v${installed.version}) is being used instead of ` +
          `the v${bundled} bundled with this app, because a CLI install always wins. Updating ` +
          `the app does not update it — refresh it through the Claude Code CLI, or remove it ` +
          `to fall back to the bundled copy.`,
      });
    }
  }

  findings.sort((a, b) => b.weight - a.weight);
  return { onboarded, hasGraph, findings, tokensPerCall };
}

/** Compare dotted numeric versions. Non-numeric segments compare as 0 rather than throwing —
 *  a plugin free to write anything in `version` must not be able to break the scan. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".");
  const pb = b.split(".");
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = Number.parseInt(pa[i] ?? "0", 10) || 0;
    const nb = Number.parseInt(pb[i] ?? "0", 10) || 0;
    if (na !== nb) return na < nb ? -1 : 1;
  }
  return 0;
}

function kb(bytes: number): string {
  return `${Math.round(bytes / 1000)} KB`;
}

/**
 * One line summarising what a project's findings cost, or null when there is nothing to say.
 * Kept here (not in a component) so `pnpm test` can reach it — same reason as `lib/ui.ts`.
 */
export function healthSummary(health: ProjectHealth): string | null {
  if (!health.findings.length) return null;
  const injected = health.findings.find((f) => f.tokensPerCall);
  if (injected?.tokensPerCall) {
    return `~${injected.tokensPerCall.toLocaleString()} tokens on every API call, before this project's work even starts.`;
  }
  const missingGraph = health.findings.some((f) => f.kind === "missing-graph");
  if (missingGraph) return "No code graph — structural questions fall back to grep-and-read.";
  const stale = health.findings.find((f) => f.kind === "stale-plugin");
  if (stale) return `The ${stale.subject} agent is running an older CLI-installed copy.`;
  return `${health.findings.length} document${health.findings.length === 1 ? "" : "s"} over budget.`;
}
