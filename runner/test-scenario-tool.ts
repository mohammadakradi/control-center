/**
 * `list_test_scenarios` / `complete_test_scenario` — how the qa agent sees what still needs
 * verifying, and records what a run found.
 *
 * The second one is the only thing in the system that marks a scenario passed, and that is a
 * deliberate choice rather than a convenience. A `/qa:test` run reaching `done` means the run
 * finished, not that the feature works: a QA pass that walks ten steps and fails six is a
 * *successful run reporting a broken feature*. Inferring "passed" from the task's exit status
 * would mark that feature verified. So the agent states the counts and the rule lives in
 * `lib/test-scenarios.ts`: a scenario passes when zero steps failed and at least one ran.
 *
 * The same two properties as `./backlog-tool` are load-bearing here:
 *
 * **The project is not an argument.** It comes from the session's handle. Scenarios are shared
 * install-wide like the backlog, and a project id is guessable — an agent testing one project
 * must not be able to close out another project's verification work.
 *
 * **The handler never throws.** A rejected MCP handler surfaces as a session-level error, which
 * would turn "that scenario name is ambiguous" into a dead task. Refusals come back as ordinary
 * tool results with `isError: true`, which is what tells the model to adjust.
 */
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../lib/db";
import { features, projects } from "../lib/db/schema";
import {
  groupScenarios,
  listTestScenarios,
  recordScenarioRun,
  resolveScenarioRef,
  syncProjectTestScenarios,
} from "../lib/test-scenarios";

/**
 * How many scenarios one launch may complete. A QA run exercises one scenario, occasionally a
 * handful; twenty is far above any real pass and bounds what a looping agent can close out
 * before a human sees it. The counter lives in the tool's closure, so a continue or resume gets
 * a fresh allowance — same as the backlog tool's.
 */
export const MAX_COMPLETIONS_PER_TASK = 20;

/** Steps one run may claim. A four-digit step count is a confused agent, not a thorough one,
 *  and these numbers are rendered in the UI. */
const MAX_STEPS = 500;

export type TestScenarioToolContext = {
  /** The project this session runs against. Deliberately not a tool argument. */
  projectId: string;
  /** Needed to archive the markdown when a scenario leaves `open`. */
  projectPath: string;
  /** The run recording the result, for the scenario's history. Null for a session with no row. */
  taskId: string | null;
  /** Writes a line into the task transcript, so a completion is never silent. */
  onLog?: (message: string) => void;
};

const LIST_DESCRIPTION =
  "List this project's test scenarios — the manual verification documents the fe, swe and qa " +
  "agents write — with their status and the feature each belongs to. Call this at the start of " +
  "a QA session to see what is still unverified, or when the user asks what needs testing. " +
  "It re-scans the project's scenario folders first, so a scenario written moments ago by " +
  "another agent is included. Read-only.";

const COMPLETE_DESCRIPTION =
  "Record the outcome of running one test scenario, after you have walked every step in a " +
  "browser. Give the number of steps that PASSED and the number that FAILED. A scenario is " +
  "marked completed only when `failed` is 0 and at least one step passed — anything else " +
  "leaves it open, which is correct: a run that found failures has not verified the feature. " +
  "Call it once per scenario, at the end of the run, with counts you actually observed. Never " +
  "call it to 'tidy up' a scenario you did not run, and never pass failed: 0 for steps you " +
  "could not determine — an undetermined step is a failed one.";

function textResult(text: string, isError = false) {
  return {
    content: [{ type: "text" as const, text }],
    ...(isError ? { isError: true } : {}),
  };
}

/**
 * A transcript line is best-effort and must never decide the call's outcome — `onLog` writes to
 * the database, so it can fail on its own, and a scenario that was completed and then failed to
 * log is still completed. Unguarded, a throw here would escape the handler (the `catch` below
 * also logs), and a rejected MCP handler takes the task down rather than the tool call.
 */
function note(ctx: TestScenarioToolContext, message: string): void {
  try {
    ctx.onLog?.(message);
  } catch {
    /* not worth failing, or losing, a completion over */
  }
}

function refuse(ctx: TestScenarioToolContext, reason: string): string {
  note(ctx, `🧪 Test scenario not updated — ${reason}`);
  return `Could not update the test scenario: ${reason}`;
}

/** The project row, or null when it is no longer registered. The FK would catch an orphan, but
 *  foreign keys aren't reliably enforced on this database (see .swe/notes/gotchas-1.md). */
function liveProject(projectId: string) {
  return (
    db
      .select({ id: projects.id, path: projects.path })
      .from(projects)
      .where(eq(projects.id, projectId))
      .get() ?? null
  );
}

export function makeListScenariosTool(ctx: TestScenarioToolContext) {
  return tool("list_test_scenarios", LIST_DESCRIPTION, {}, async () => {
    try {
      const project = liveProject(ctx.projectId);
      if (!project) {
        return textResult(
          "This task's project is no longer registered, so it has no test scenarios.",
          true,
        );
      }
      syncProjectTestScenarios(project);
      const rows = listTestScenarios(project.id);
      if (rows.length === 0) {
        return textResult(
          "No test scenarios found in this project. They are read from .qa/scenarios/, " +
            ".fe/test-scenarios/ and .swe/test-scenarios/ — write one with /qa:scenario if the " +
            "feature under test has none.",
        );
      }
      const projectFeatures = db
        .select({ id: features.id, name: features.name })
        .from(features)
        .where(eq(features.projectId, project.id))
        .all();

      const lines: string[] = [];
      for (const group of groupScenarios(rows, projectFeatures)) {
        lines.push(
          `\n## ${group.featureName} — ${group.openCount} open, ${group.passedCount} passed, ${group.closedCount} closed`,
        );
        for (const s of group.scenarios) {
          const ran =
            s.lastPassed || s.lastFailed
              ? ` (last run: ${s.lastPassed} passed, ${s.lastFailed} failed)`
              : "";
          lines.push(`- [${s.status}] ${s.title} — \`${s.sourcePath}\`${ran}`);
        }
      }
      const open = rows.filter((r) => r.status === "open").length;
      return textResult(
        `${rows.length} test scenario(s) in this project, ${open} still open.${lines.join("\n")}`,
      );
    } catch (err) {
      return textResult(
        `Could not list test scenarios: ${(err as Error).message}`,
        true,
      );
    }
  });
}

export function makeCompleteScenarioTool(ctx: TestScenarioToolContext) {
  let completed = 0;

  return tool(
    "complete_test_scenario",
    COMPLETE_DESCRIPTION,
    {
      scenario: z
        .string()
        .describe(
          "Which scenario you ran: its project-relative path (e.g. " +
            "'.fe/test-scenarios/checkout.md'), its exact title, or its filename.",
        ),
      passed: z.number().int().describe("How many scenario steps passed."),
      failed: z
        .number()
        .int()
        .describe(
          "How many failed. Count a step you could not determine as failed — an honest " +
            "unknown is not a pass.",
        ),
    },
    async (args) => {
      try {
        const project = liveProject(ctx.projectId);
        if (!project) {
          return textResult(
            refuse(ctx, "this task's project is no longer registered."),
            true,
          );
        }

        if (!Number.isInteger(args.passed) || args.passed < 0 || args.passed > MAX_STEPS) {
          return textResult(
            refuse(ctx, `'passed' must be a whole number between 0 and ${MAX_STEPS}.`),
            true,
          );
        }
        if (!Number.isInteger(args.failed) || args.failed < 0 || args.failed > MAX_STEPS) {
          return textResult(
            refuse(ctx, `'failed' must be a whole number between 0 and ${MAX_STEPS}.`),
            true,
          );
        }
        if (completed >= MAX_COMPLETIONS_PER_TASK) {
          return textResult(
            refuse(
              ctx,
              `this run has already recorded ${MAX_COMPLETIONS_PER_TASK} scenario results, which is the limit for one launch. Put anything further in your report.`,
            ),
            true,
          );
        }

        // Scan first: a scenario the qa agent just wrote with /qa:scenario has no row yet, and
        // refusing to record a result for it would be a confusing dead end.
        syncProjectTestScenarios(project);

        const scenario = resolveScenarioRef(project.id, args.scenario);
        if (!scenario) {
          const known = listTestScenarios(project.id)
            .filter((s) => s.status === "open")
            .slice(0, 15)
            .map((s) => `  ${s.sourcePath}`)
            .join("\n");
          return textResult(
            refuse(
              ctx,
              `no single scenario in this project matches "${args.scenario}". ` +
                (known
                  ? `Use one of these exact paths:\n${known}`
                  : "This project has no open scenarios."),
            ),
            true,
          );
        }

        const result = recordScenarioRun(project, scenario, {
          taskId: ctx.taskId,
          passed: args.passed,
          failed: args.failed,
        });
        completed += 1;

        if (result.pinned) {
          note(ctx, `🧪 "${scenario.title}" was set by hand — run result not applied.`);
          return textResult(
            `"${scenario.title}" has a status set by a person (${scenario.status}), so this run did not change it. ` +
              "That is deliberate: a manual decision outranks an automatic one. Report your findings as usual.",
          );
        }

        if (result.scenario.status === "passed") {
          const archived =
            result.file === "moved"
              ? ` Its markdown was archived to \`${result.scenario.archivedPath}\`.`
              : result.file === "missing"
                ? " Its markdown was already gone from the working tree, so nothing was archived."
                : "";
          note(ctx, `🧪 Test scenario completed: "${scenario.title}" (${args.passed} steps passed)`);
          return textResult(
            `"${scenario.title}" is marked completed — ${args.passed} steps passed, none failed.${archived} ` +
              "There is nothing further for you to do about its status.",
          );
        }

        note(
          ctx,
          `🧪 Test scenario still open: "${scenario.title}" (${args.passed} passed, ${args.failed} failed)`,
        );
        return textResult(
          `"${scenario.title}" stays open — you recorded ${args.failed} failed step(s)` +
            (args.passed === 0 ? " and no passing steps" : "") +
            ". The result is recorded against it. File the product bugs you found and report them.",
        );
      } catch (err) {
        return textResult(
          refuse(ctx, `it could not be saved (${(err as Error).message}).`),
          true,
        );
      }
    },
  );
}

export function testScenarioTools(ctx: TestScenarioToolContext) {
  return [makeListScenariosTool(ctx), makeCompleteScenarioTool(ctx)];
}
