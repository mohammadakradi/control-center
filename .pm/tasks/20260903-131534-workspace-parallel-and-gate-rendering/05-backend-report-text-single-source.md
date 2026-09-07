---
title: One normalized source of truth for proposal, change-report and final-report text
stack: backend
assignee: swe
priority: P1
depends_on: []
---

# One normalized source of truth for proposal, change-report and final-report text

## Issue
Three different producers can become "the report", and none of them is normalized:

1. the `request_approval` `summary` argument (`runner/platform-mcp.ts:30-45` → `onGate`,
   `runner/session-manager.ts:680-693`),
2. the raw assistant message text on the marker fallback path, and
3. the runner's own passthrough synthesis, `${endText.trim()}\n\n[[DONE]]`
   (`runner/session-manager.ts:997-1014`), which cleans nothing at all.

Only the three literal marker tokens are ever stripped (`components/TaskLiveView.tsx:73-74`), so
narration and preamble ship verbatim into the card — `runner/completion.ts:7-11` already documents
a real transcript where *"I'll follow the fe:task workflow — first, investigation. Let me read the
workflow rules…"* rendered as the report.

On top of that, the gate **event itself** can be spurious. `hasGate` is computed from the
session-sticky `lastAssistantText` (`runner/session-manager.ts:884`, `:925`) rather than
turn-local text, so a turn whose gate was already resolved by the tool call still fires a second
`record(handle, "gate", …)` + `setStatus` (`:962-974`) with no `pendingApproval`. The user then
sees a fresh "please approve" card on already-approved content, and approving it takes
`respond()`'s fallback branch (`:1108-1127`), which injects a stray *"Approved. Proceed."* into
the live conversation and force-sets `building` — even for a report gate, which the real path maps
to `committing` (`:688` vs `:1124`).

## Goal
Whatever the producer, the text a proposal / change-report / final-report card renders has passed
through one normalizer that removes markers and narration; a gate event fires exactly once per
real gate; and answering a report gate reports `committing`.

## Suggested solution
Add a single `normalizeReportText` in `lib/ui.ts` — the tested, DOM-free home this logic already
belongs in, next to `stripMarkers` and `fixTaskReasons` — and route all three producers through
it. It should strip the markers and drop leading/trailing narration shapes ("Let me…", "I'll
now…", "First, I'll…", bare tool-call preambles), while never mangling a legitimate report; cut by
code point, as `cleanTitle` and `evidenceOf` already do, and keep `evidenceOf`'s
control/format-character stripping stance for anything rendered as trusted evidence. Then scope
`hasGate` to the turn-local text (or track that this turn's gate was already resolved via the
tool) so the phantom second gate can't fire, and make the `respond()` fallback map a report gate
to `committing`. The distinction between the three kinds should be carried by the event, not
inferred from prose downstream — task 06 depends on that.

## Affected areas
- `lib/ui.ts` — new `normalizeReportText` beside `stripMarkers` / `fixTaskReasons` (`:689-718`),
  with specs in `lib/ui.test.ts`
- `runner/session-manager.ts` — `onGate` (`:680-693`), `hasGate` / `lastAssistantText`
  (`:862-866`, `:884`, `:925`), `resultAction` (`:258-281`), the extra gate record (`:962-974`),
  the `complete` synthesis (`:997-1014`), `respond()` (`:1108-1127`, incl. the `building` at
  `:1124`)
- `runner/gate-prompt.ts:5-40` — the instruction to emit both the tool call and the marker, which
  is what makes the double-fire reachable
- Features affected: the proposal gate, the change-report gate, the final report, and the
  `awaiting_proposal` / `awaiting_report` / `building` / `committing` status labels
