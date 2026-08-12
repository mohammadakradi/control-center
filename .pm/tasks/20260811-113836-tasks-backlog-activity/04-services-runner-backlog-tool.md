---
title: Runner MCP tool so agents can add backlog items
stack: services
assignee: swe
priority: P2
depends_on: [03-backend-backlog-model-api.md]
---

# Runner MCP tool so agents can add backlog items

## Issue
fe/swe agents sometimes surface issues mid-task that should become future work, but they
have no way to record them — the runner's in-process `swe-platform` MCP server
(`runner/approval-tool.ts`, wired into every session at `runner/session-manager.ts:498`)
only exposes `request_approval`.

## Goal
An agent asked to "add this to the backlog" can call an `add_backlog_item` tool and the item
appears in that project's backlog (from task 03) with source `agent`.

## Suggested solution
Add an `add_backlog_item` tool (title, description, assignee fe/swe) alongside
`request_approval` on the existing in-process MCP server, writing a `backlog_items` row for
the session's project — the runner already knows the task's project and has DB access.
Follow the existing tool's shape in `runner/approval-tool.ts`; mention the tool briefly in
the session system prompt (`runner/gate-prompt.ts` or where the gate instructions live) so
agents know it exists. Cover with a spec next to the code (`runner/*.test.ts` globs are
explicit in the `test` script).

## Affected areas
- `runner/approval-tool.ts` (or a sibling module) — new `add_backlog_item` MCP tool
- `runner/session-manager.ts` — server wiring at the `mcpServers` option (line ~498)
- `runner/gate-prompt.ts` — one-line mention so agents discover the tool
- `backlog_items` table from task 03 — written directly via `lib/db`
- Feature: agents feeding the per-project backlog on request
