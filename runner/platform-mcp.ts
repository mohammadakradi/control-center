/**
 * The in-process `swe-platform` MCP server: the tools an agent gets *because* it is running
 * under this platform rather than at a terminal.
 *
 * Four of them today. `request_approval` blocks the agent's turn until the user answers a
 * workflow gate in the UI — there is no stdin to read, so a gate has to be a tool call.
 * `add_backlog_item` (./backlog-tool) files follow-up work into the project's backlog, since an
 * agent's own report is not somewhere anyone goes looking later. `list_test_scenarios` and
 * `complete_test_scenario` (./test-scenario-tool) do the same job for verification work: the
 * scenarios the fe/swe agents write at their report gate were markdown nobody went back to, and
 * the second tool is the only thing that marks one passed. All are handed to every session in
 * ./session-manager.
 */
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { makeBacklogTool, type BacklogToolContext } from "./backlog-tool";
import {
  testScenarioTools,
  type TestScenarioToolContext,
} from "./test-scenario-tool";

/**
 * `proposal` and `report` are the fe/swe/pm workflow's two approvals: a plan, then a diff.
 * `question` is neither — the agent is blocked on something only the user can decide or do
 * (log in, choose a URL, allow an install). It exists because the qa agent has nothing to
 * approve: a test run produces a verdict, not a change, and forcing its "I'm stuck, may I…?"
 * through the change-report gate put Approve/Reject on a question (reported 2026-09-29).
 */
export type GateKind = "proposal" | "report" | "question";
export const GATE_KINDS = ["proposal", "report", "question"] as const satisfies readonly GateKind[];
export type GateDecision = { allow: boolean; feedback?: string };

export type PlatformServerOptions = {
  /** Resolves when the user answers the gate in the UI. **Rejects** when the gate cannot be
   *  raised at all — the run it belongs to has already ended and cannot be re-opened — and
   *  the rejection's message is what the agent is told. */
  onGate: (gate: GateKind, summary: string) => Promise<GateDecision>;
  /**
   * For an agent with nothing to approve (qa — see `questionOnlyGates` in ./gate-prompt): a
   * `proposal`/`report` call is never raised as a gate. Its summary goes here to be recorded as
   * the run's final report, and the agent is told to finish. The prompt already says this, but
   * a project's own CLAUDE.md describing the swe/fe report gate outweighed it on the first real
   * run (2026-09-29) — so it is enforced, not requested.
   */
  onFinalReport?: (summary: string) => void;
  /** Which project this session may file backlog items against, and where to log them. */
  backlog: BacklogToolContext;
  /** Which project's test scenarios this session may read and complete. Separate from
   *  `backlog` because it additionally needs the project's path (to archive a scenario's
   *  markdown) and the task id (to record which run produced a result). */
  testScenarios: TestScenarioToolContext;
};

/**
 * The blocking gate tool. Its handler doesn't settle until `onGate` does — that suspended
 * promise *is* the pause, and the decision comes back as the tool result so the agent reads the
 * user's answer where it would read any other tool's output.
 */
function makeApprovalTool(
  onGate: PlatformServerOptions["onGate"],
  onFinalReport?: PlatformServerOptions["onFinalReport"],
) {
  return tool(
    "request_approval",
    "Pause for the user at a workflow gate and wait for their answer in the platform UI. gate=\"proposal\" or \"report\" asks them to approve a plan or a change report; gate=\"question\" asks them something only they can answer or do (put the question in summary). Returns their answer.",
    { gate: z.enum(GATE_KINDS), summary: z.string() },
    async (args) => {
      if (onFinalReport && args.gate !== "question") {
        onFinalReport(args.summary);
        return {
          content: [
            {
              type: "text" as const,
              text: "Recorded as this run's final report — there is no approval step for this agent, so nothing is waiting on the user. Do not repeat the report. End your turn now with just [[DONE]].",
            },
          ],
        };
      }
      let decision: GateDecision;
      try {
        decision = await onGate(args.gate, args.summary);
      } catch (err) {
        // The gate could not be raised at all — the run this session belongs to has already
        // ended (see `gateAction`). Returned as a tool *error* rather than thrown, so the
        // agent reads a sentence explaining what happened where it reads every other tool
        // result, instead of an SDK-level `Stream closed` it can do nothing with.
        return {
          content: [{ type: "text" as const, text: (err as Error).message }],
          isError: true,
        };
      }
      const text = gateResultText(args.gate, decision);
      return { content: [{ type: "text" as const, text }] };
    },
  );
}

/** What the agent reads back from a gate. A question is answered, not approved — so its result
 *  carries the user's words as the answer, and a "no" is a no rather than "revise and retry". */
export function gateResultText(gate: GateKind, decision: GateDecision): string {
  if (gate === "question") {
    if (decision.allow) {
      return decision.feedback
        ? `User answered: ${decision.feedback}`
        : "User answered: yes, go ahead.";
    }
    return `User answered NO${decision.feedback ? `: ${decision.feedback}` : ""}. Do not do what you asked about; report where that leaves the run.`;
  }
  return decision.allow
    ? decision.feedback
      ? `User APPROVED with changes: ${decision.feedback}. Proceed, incorporating the feedback.`
      : "User APPROVED. Proceed."
    : `User did NOT approve. Feedback: ${decision.feedback ?? "(none given)"}. Revise and call request_approval again.`;
}

/**
 * Everything the server exposes. Exported separately so a spec can assert what a session is
 * actually handed: a tool that quietly stops being registered is otherwise invisible until an
 * agent tries to call it mid-task.
 */
export function platformTools(opts: PlatformServerOptions) {
  return [
    makeApprovalTool(opts.onGate, opts.onFinalReport),
    makeBacklogTool(opts.backlog),
    ...testScenarioTools(opts.testScenarios),
  ];
}

export function makePlatformServer(opts: PlatformServerOptions) {
  return createSdkMcpServer({
    name: "swe-platform",
    version: "0.3.0",
    tools: platformTools(opts),
  });
}
