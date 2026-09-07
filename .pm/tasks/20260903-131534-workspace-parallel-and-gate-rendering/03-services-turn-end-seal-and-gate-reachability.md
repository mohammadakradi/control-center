---
title: Stop sealing a task on narration, and keep its gate reachable
stack: services
assignee: swe
priority: P1
depends_on: []
---

# Stop sealing a task on narration, and keep its gate reachable

## Issue
`classifyTurnEnd` (`runner/completion.ts`) decides whether a turn's last message is the final
report, and it accepts narration. Reproduced on the planning task for this very request
(`task_2ad6afb5`): the task was sealed `done` at `2026-09-03T09:31:24Z` on the message *"Smoking
gun found. Let me confirm the reconciler's status coverage."* — a tool-call preamble — while the
session kept running and kept recording events past `end`. `IN_FLIGHT_RE` cannot catch this,
because the sentence names no dispatched work. Two consequences the user hit directly: the
preamble becomes the task's report, and `finalize()`'s `closeInput()` (`:406`) then makes the next
`request_approval` call fail with **`Stream closed`** — so a proposal gate could not be raised at
all, and they were handed a report on a finished task instead of a proposal with tasks.
`finalize()` also never stops the SDK output iterator, and `record()` (`:879`) is unconditional,
so events keep landing after the terminal `end` (the known half, `bli_9119b0b6`).

## Goal
A task goes terminal only when the run is genuinely over. A short narration or tool-call preamble
can never seal a task or become its report; a gate raised by an agent that is still working is
always delivered; and no events are persisted after the terminal `end`.

## Suggested solution
Make sealing require positive evidence rather than the absence of a pause signal — a turn that
ends with no report gate, no `[[GATE:…]]` marker and no trailing `[[DONE]]` should be treated as
"the agent stopped mid-work" (nudge) unless its closing text looks like a real report. Note the
existing trap documented in `.swe/notes/task-runs.md`: `WAITING_RE` must never be consulted where
the answer *seals*, because "I'll wait for your approval to push" is a finished report — so the
new signal should lean on shape (length, structure, absence of "let me / I'll now / next I'll"
preamble shapes) rather than on waiting language. Separately, `request_approval` must never fail
silently: a gate raised on a handle the runner considers finished should re-open the task (back to
`awaiting_proposal` / `awaiting_report`) rather than hitting a closed input channel, and if it
truly cannot be honoured it should surface an explicit error the agent can react to. Finally, stop
persisting after the terminal `end` — either have `finalize()` end consumption, or gate `record()`
on `handle.done` so late subagent/background messages land nowhere.

## Affected areas
- `runner/completion.ts` — `classifyTurnEnd`, `IN_FLIGHT_RE`, `MARKERS` (`:30-32`, `:109-134`)
- `runner/session-manager.ts` — `resultAction` (`:258-281`), the `result` handler's `complete`
  branch (`:997-1014`), `finalize()` (`:360-409`) incl. `closeInput()` (`:406`), the unconditional
  `record()` (`:879`), and `respond()` (`:1108-1127`)
- `runner/platform-mcp.ts:30-45` — `request_approval` and its `onGate` handler
  (`runner/session-manager.ts:680-693`)
- `runner/completion.test.ts`, `runner/session-manager.test.ts` — the specs pinning both
  directions (pause vs. seal)
- Features affected: turn-end classification, the proposal/report gates, task status accuracy
