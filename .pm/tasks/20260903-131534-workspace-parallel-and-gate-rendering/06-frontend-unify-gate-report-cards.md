---
title: Unify the three report cards, and stop showing "live" on a finished run
stack: frontend
assignee: fe
priority: P1
depends_on: [05-backend-report-text-single-source.md]
---

# Unify the three report cards, and stop showing "live" on a finished run

## Issue
The task page renders a proposal, a change report and a final report three different ways, and
tells the user a finished run is still live.

- **Two designs, not one.** A gate card (proposal and change report) is warn-toned with a `Flag`
  icon and capped at `max-h-72 overflow-auto`
  (`components/TaskLiveView.tsx:740-785`, `:913-924`); the final `[[DONE]]` report is neutral with
  a `FileText` icon, unbounded, and is the only one that gets the `fixTaskReasons` findings
  callout (`:834-894`). A substantive change report therefore scrolls inside a small box and
  offers no follow-up, while a terse final wrap-up gets the full treatment.
- **`[[GATE:PROPOSAL]]` has no branch.** `DONE_AT_END` and `REPORT_AT_END` exist; the proposal
  marker does not (`:70-72`), so a proposal message falls through to `{kind:"assistant"}` with its
  text **unstripped** (`:192-193`) — the marker leaks literally and the proposal never renders as
  a proposal. This is exactly what the user saw: a proposal presented as a report.
- **Duplicate cards.** The `hasReportGate` dedupe (`:300-307`) only drops a `fromMarker` *report*
  bubble; it never reconciles two `gate`-kind bubbles, so a second gate event puts a fresh
  interactive card on screen beside the resolved one.
- **"live" is a socket boolean.** The indicator is `connected ? "live" : active ? "reconnecting…"
  : "ended"` (`:567`) while `status` updates independently (`:329-346`) — so a `done` task shows
  "live" whenever the transport stays open.

## Goal
Proposal, change report and final report share one card design that scales to a long report, each
renders once, no marker text is ever visible, and the live indicator reflects the run's state
rather than the connection's.

## Suggested solution
Extract one report-card component parameterised by kind (proposal / change report / final report)
so heading, icon, tone and the follow-up affordance are decided in one place — reuse the existing
primitives in `components/ui-cards.tsx` and semantic tokens only, no `dark:` variants and no raw
palette shades. Drop the `max-h-72` cap for all three (or apply the same generous treatment
consistently) and let `components/Markdown.tsx` keep owning table/code overflow. Add a
`PROPOSAL_AT_END` branch mirroring `REPORT_AT_END` so a proposal renders as a proposal with its
marker stripped, and extend the dedupe to reconcile gate bubbles of the same kind. Render body
text through the `normalizeReportText` helper task 05 adds, rather than re-implementing stripping
here. For the indicator, derive the label from the run's status and use `connected` only to
distinguish "reconnecting" from "live" *while the run is active* — a terminal status must never
read as live. Keep the branchy decisions in `lib/ui.ts` where `pnpm test` can reach them, as
`taskChangesView` and `fixTaskReasons` already are.

## Affected areas
- `components/TaskLiveView.tsx` — `stripMarkers` / marker constants (`:70-74`), `eventToBubble`
  (`:171-209`), `seedFromEvents` (`:220-256`), the dedupe (`:300-307`), `GateCard` (`:724-785`),
  the resolved gate bubble (`:913-924`), the report bubble (`:834-894`), the indicator (`:567`)
- `lib/ui.ts` — `fixTaskReasons` (`:689-718`), `normalizeReportText` (from task 05), and any new
  card-kind decision helper, with specs in `lib/ui.test.ts`. **Task 10 owns the follow-up
  callout's content and its button target** (which lines count as reasons, which command gets
  dispatched); this task owns the card design around it — coordinate so neither undoes the other
- `components/ui-cards.tsx`, `components/Markdown.tsx` — the primitives the unified card reuses
- `.fe/design-system.md` — record the unified report-card pattern
- Features affected: the proposal gate, change-report gate, final report, and the run indicator
