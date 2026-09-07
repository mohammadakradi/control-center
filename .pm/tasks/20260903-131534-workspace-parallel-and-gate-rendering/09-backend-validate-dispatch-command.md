---
title: Refuse a dispatch whose command the target agent doesn't have
stack: backend
assignee: swe
priority: P1
depends_on: []
---

# Refuse a dispatch whose command the target agent doesn't have

## Issue
Nothing checks that the command being dispatched exists. `DispatchInput.command` is a bare
`string` (`lib/dispatch.ts:99`) and is stored as-is (`:226`); the runner then formats it blind into
`/${agent.namespace}:${task.command} ${task.requestText}`
(`runner/session-manager.ts:723-724`). When the command doesn't exist, Claude Code receives that
line as **plain prose** — no error, no refusal, no gate protocol. The task runs, looks normal, and
does whatever the model makes of a sentence starting with a slash.

This is reachable today: the "Create fix task" button hardcodes `command: "task"` against the
current task's own `agentId` (`components/TaskLiveView.tsx:542`), and the pm agent has no `task`
command at all — `agents/pm/commands/` holds `onboard.md` and `plan.md` only. Pressing it on a pm
report dispatches `/pm:task`, which does not exist. Every other dispatch path happens to be safe
by construction, not by validation: `NewTaskForm` builds its picker from the discovered list
(`agent.commands`, `components/NewTaskForm.tsx:150-154`), so it can only offer real ones. The
ground truth is therefore already loaded and just never consulted — `readCommands`
(`lib/discovery/agents.ts:43-56`) parses each `commands/*.md` into `{ name, full, description }`.

## Goal
A dispatch naming a command the target agent doesn't have is refused with a clear message, from
every entry point — the API, the fix-task button, and the backlog run route — instead of silently
becoming a prose prompt. Callers can ask which commands an agent actually has.

## Suggested solution
Validate in `createAndStartTask` alongside the existing project/parallel refusals, so the check
covers every caller rather than one form: resolve the agent, compare against its discovered
command names, and return a 400 naming the commands that do exist. Keep the refusal shape the
other checks use (`{ ok: false, status, error }`) so the routes surface it unchanged. The
comparison should read the same discovered list the picker reads — do not introduce a hardcoded
per-namespace table, which would drift the moment an agent gains a command (and `pnpm agents:sync`
plus the prefer-a-CLI-copy rule in `.swe/notes/agents-bundling.md` mean the real list can differ
from the vendored one on a given install). Expose that list to clients that need to choose a
command programmatically rather than offer a dropdown — task 10 needs exactly this. Note the one
thing validation must not do: block a legitimately installed agent whose commands simply aren't
discoverable yet (no `commands/` directory reads as an empty list, `agents.ts:45`); an agent with
no discovered commands should not be turned into a project-wide dispatch failure.

## Affected areas
- `lib/dispatch.ts` — `DispatchInput.command` (`:99`), the refusal block in `createAndStartTask`
  (beside the parallel/workspace checks at `:167-183`), the insert at `:226`
- `lib/dispatch.test.ts` — the specs that pin each refusal; add both directions (real command
  passes, unknown command 400s)
- `lib/discovery/agents.ts:43-56`, `:102`, `:148` — `readCommands` / `AgentCommand`, the source of
  truth being consulted
- `app/api/tasks/route.ts` and the backlog run route — they pass `command` straight through and
  will now surface the 400
- `runner/session-manager.ts:723-724` — the blind slash-command formatting this protects
- Features affected: every dispatch path (new task form, fix-task button, backlog runs)
