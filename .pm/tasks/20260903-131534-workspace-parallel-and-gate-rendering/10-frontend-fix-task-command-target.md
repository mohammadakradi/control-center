---
title: Point "Create fix task" at a command that exists, and stop flagging non-findings
stack: frontend
assignee: fe
priority: P1
depends_on: [09-backend-validate-dispatch-command.md]
---

# Point "Create fix task" at a command that exists, and stop flagging non-findings

## Issue
Two defects in the follow-up callout, both visible in the user's screenshot of a **pm** report.

1. **The button dispatches a command that doesn't exist.** `createFixTask` hardcodes
   `command: "task"` and reuses the report's own `agentId`
   (`components/TaskLiveView.tsx:533-550`, the body at `:542`). On a pm task that is `/pm:task`,
   and pm has no `task` command — `agents/pm/commands/` holds `onboard.md` and `plan.md` only.
   It is also the wrong choice where it *does* resolve: `swe` and `fe` both ship a purpose-built
   `fix` command (`agents/{swe,fe}/commands/fix.md`, *"Handle a bug end-to-end — root-cause, plan
   the fix…"*), which is what "address the findings in this report" is, and the button asks for
   `task` anyway. Deeper still, a fix task raised from a **pm** report is being handed to the agent
   that plans rather than one that implements.
2. **The callout fires on text that isn't a finding.** In the screenshot the flagged reason is
   *"Recommendation — Filed the two out-of-scope findings…"* — a line whose whole point is that
   the work is already recorded elsewhere. `fixTaskReasons` (`lib/ui.ts:689-718`) matches
   `RECOMMENDATION_LINE` on any line and only excuses an explicit `ALL_CLEAR_LINE`, so a report
   that *mentions* recommendations gets an amber "This report flags follow-up work" banner it
   didn't earn — the same class of noise as the extra messages in task 05/06.

## Goal
The button always starts a run that actually exists and can do the work, and the callout appears
only when the report genuinely leaves something undone.

## Suggested solution
Choose the command from the agent's real command list rather than a literal — task 09 exposes it —
preferring `fix` where the agent has it and falling back to `task`. Where the report's own agent
can do neither (pm), the honest options are to dispatch to an agent that implements, or to not
offer the button; **prefer routing over hiding**, since a pm report's whole output is work someone
must pick up, and a dead button is worse than no button. Whichever way, don't guess client-side:
if no target resolves, the callout should still render its reasons and simply omit the action, and
a refused dispatch (task 09's 400) must surface rather than silently resetting `converting`
(`:548`) — today a failed create looks like a button that just doesn't work. For the reasons
themselves, tighten `RECOMMENDATION_LINE` so a line reporting *completed* or *already-filed*
follow-up doesn't count, and treat "filed as `bli_…`" style references the way `ALL_CLEAR_LINE` is
treated; keep the existing one-entry-per-kind cap and keep the matching in `lib/ui.ts` where
`pnpm test` can reach it. Preserve `evidenceOf`'s control/format-character stripping exactly as it
is — it is a Trojan-Source guard on text rendered as trusted evidence, so write any regex change
with `\uXXXX` escapes rather than literal bytes. Task 06 owns this callout's *design*; this task
owns its *content and target* — coordinate so neither rewrites the other's half.

## Affected areas
- `components/TaskLiveView.tsx` — `createFixTask` (`:533-550`), its `command`/`agentId` body
  (`:542`), the failure path (`:548`), and the callout's `onConvert` wiring (`:838`, `:882`)
- `lib/ui.ts` — `fixTaskReasons` (`:689-718`), `RECOMMENDATION_LINE` / `ALL_CLEAR_LINE`,
  `evidenceOf` (unchanged in substance), with specs in `lib/ui.test.ts`
- `app/(app)/tasks/[id]/page.tsx:139` — where `TaskLiveView` gets `agentId` / `projectId`, if the
  target agent has to be resolved server-side
- `agents/{swe,fe}/commands/fix.md`, `agents/pm/commands/` — read-only, the command inventory this
  reasons about (never edited here; `pnpm agents:sync` owns that directory)
- Features affected: the report card's follow-up callout and the fix-task dispatch
