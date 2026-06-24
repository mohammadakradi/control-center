import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

export type GateKind = "proposal" | "report";
export type GateDecision = { allow: boolean; feedback?: string };

/**
 * Builds an in-process MCP server exposing a single blocking `request_approval` tool.
 * The tool handler pauses the agent's turn until `onGate` resolves (i.e. until the user
 * responds in the UI), then returns the decision as the tool result so the agent continues.
 */
export function makeApprovalServer(
  onGate: (gate: GateKind, summary: string) => Promise<GateDecision>,
) {
  const requestApproval = tool(
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

  return createSdkMcpServer({
    name: "swe-platform",
    version: "0.1.0",
    tools: [requestApproval],
  });
}
