/**
 * The in-process `swe-platform` MCP server: the tools an agent gets *because* it is running
 * under this platform rather than at a terminal.
 *
 * Two of them today. `request_approval` blocks the agent's turn until the user answers a
 * workflow gate in the UI — there is no stdin to read, so a gate has to be a tool call.
 * `add_backlog_item` (./backlog-tool) files follow-up work into the project's backlog, since an
 * agent's own report is not somewhere anyone goes looking later. Both are handed to every
 * session in ./session-manager.
 */
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { makeBacklogTool, type BacklogToolContext } from "./backlog-tool";

export type GateKind = "proposal" | "report";
export type GateDecision = { allow: boolean; feedback?: string };

export type PlatformServerOptions = {
  /** Resolves when the user answers the gate in the UI. */
  onGate: (gate: GateKind, summary: string) => Promise<GateDecision>;
  /** Which project this session may file backlog items against, and where to log them. */
  backlog: BacklogToolContext;
};

/**
 * The blocking gate tool. Its handler doesn't settle until `onGate` does — that suspended
 * promise *is* the pause, and the decision comes back as the tool result so the agent reads the
 * user's answer where it would read any other tool's output.
 */
function makeApprovalTool(onGate: PlatformServerOptions["onGate"]) {
  return tool(
    "request_approval",
    "Request the user's approval at a workflow gate (proposal or change report). Blocks until the user responds in the platform UI. Returns their decision.",
    { gate: z.enum(["proposal", "report"]), summary: z.string() },
    async (args) => {
      const decision = await onGate(args.gate, args.summary);
      const text = decision.allow
        ? decision.feedback
          ? `User APPROVED with changes: ${decision.feedback}. Proceed, incorporating the feedback.`
          : "User APPROVED. Proceed."
        : `User did NOT approve. Feedback: ${decision.feedback ?? "(none given)"}. Revise and call request_approval again.`;
      return { content: [{ type: "text" as const, text }] };
    },
  );
}

/**
 * Everything the server exposes. Exported separately so a spec can assert what a session is
 * actually handed: a tool that quietly stops being registered is otherwise invisible until an
 * agent tries to call it mid-task.
 */
export function platformTools(opts: PlatformServerOptions) {
  return [makeApprovalTool(opts.onGate), makeBacklogTool(opts.backlog)];
}

export function makePlatformServer(opts: PlatformServerOptions) {
  return createSdkMcpServer({
    name: "swe-platform",
    version: "0.2.0",
    tools: platformTools(opts),
  });
}
