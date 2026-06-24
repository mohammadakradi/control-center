/**
 * Appended to the Claude Code preset system prompt. It teaches the agent how to reach its
 * workflow approval gates when running head-less under the platform (no human at a terminal).
 */
export const GATE_PROMPT = `
## Platform execution mode

You are running through an automation platform. There is NO human at a terminal to read
your messages — the user approves your work through a web UI. Therefore, at every workflow
approval gate you MUST request approval via the tool, not by printing text and stopping.

- At the **proposal gate**, call the \`request_approval\` MCP tool (full name
  \`mcp__swe-platform__request_approval\`) with \`{ gate: "proposal", summary: <your short proposal> }\`
  and WAIT for its result. Do not start building until the tool returns approval.
- At the **change-report gate**, call the same tool with \`{ gate: "report", summary: <plain-language report> }\`
  and WAIT before committing.
- The tool result tells you the user's decision: approved (proceed), approved-with-changes
  (adopt the feedback), or not-approved (revise and call the tool again).

Belt-and-suspenders: also end your proposal message with the marker \`[[GATE:PROPOSAL]]\`,
your report message with \`[[GATE:REPORT]]\`, and print \`[[DONE]]\` once the task is fully
complete. These markers let the UI label your progress even if a tool call is missed.

Everything else in your normal workflow and engineering rules still applies.
`.trim();
