# Test scenario: a task seals only on a real report, and a late gate still reaches you

_Task: stop sealing a task on narration, and keep its approval gate reachable · 2026-09-04_

## Setup / preconditions
- A user with an Anthropic token saved under **Settings** (dispatch answers 412 without one).
- Any registered project. Start the app: `pnpm app` (or `pnpm dev` for foreground logs — the
  runner prints each turn's classification, which is what you are really watching).
- The behaviour under test is the **runner's** turn-end classification, so nothing here
  needs a specific agent; it needs an agent that ends a turn *mid-work*, which the swe/fe
  agents do naturally on any multi-step request.

## Happy path
1. Dispatch a task with a request big enough that the agent narrates before acting — e.g.
   `/swe:task` with "find out why X happens" against a real file. Watch the transcript.
2. Wait for a turn that ends on a tool-call preamble — the shape is
   *"Smoking gun found. Let me confirm the reconciler's status coverage."* Short, no bullet
   list, no report gate, no `[[DONE]]`.
   - **Expected:** the task stays **running**. The transcript shows a nudge, not an `end`.
     The status chip never flips to **Done** and no report card appears.
   - **Was:** exactly this message sealed `task_2ad6afb5` as Done at 09:31:24 and became the
     task's report while the agent kept working.
3. Let the run reach its real proposal gate.
   - **Expected:** the gate renders as normal — **Awaiting proposal**, with the agent's
     summary and Approve / Request changes. No `Stream closed` anywhere in the transcript.
4. Approve, let it build, and let it reach the report gate. Approve that too.
   - **Expected:** the task goes **Done** with the *report* as its report — the same as
     before this change. Nothing about a well-behaved run got slower or noisier.
5. Scroll the finished task's transcript to the bottom.
   - **Expected:** the terminal `end` really is last. No assistant/tool events appear after
     it, even for a task that had subagents running when it finished.

## Edge / failure cases
1. **A terse-but-real report.** During a run, reply to the task with something that makes the
   agent answer in one short paragraph ending in e.g. "Both are now fixed and re-reviewed
   clean." (≥60 chars, states work was carried out).
   - **Expected:** still treated as a report — the task completes rather than being nudged.
   - Contrast: "The tests pass now." (19 chars) is *not* enough on its own; expect a nudge.
     This is the accepted trade-off — one extra turn, never a false Done.
2. **A structured message that signs off with a next step.** A long, bulleted analysis whose
   last line is "Let me confirm the reconciler's status coverage."
   - **Expected:** nudged, not sealed. Formatting alone no longer buys a seal.
3. **A report that defers to you.** A run ending "…all four are fixed. Let me know if you'd
   rather I split the commit."
   - **Expected:** final — "Let me know" closes reports and must not be read as a preamble.
4. **A gate raised after the runner already sealed the run** (the `Stream closed` bug). Hard
   to force by hand; the reliable way is to watch for it in a real run where a turn seals and
   the agent then calls `request_approval` within ~15s.
   - **Expected:** the task **re-opens** — status returns to **Awaiting proposal** /
     **Awaiting report**, the transcript logs `↩️ Re-opened this task…`, and the gate is
     answerable in the UI. The end time and any error clear.
   - **Expected when it cannot be honoured** (the run was *cancelled* by you, the worktree was
     already handed back, or the session is truly gone): the task stays finished, the agent's
     summary is still recorded in the transcript so nothing is lost, and the agent receives an
     explicit tool error telling it not to retry — never a silent hang.
5. **Stop a task, then let the agent try to gate.** Press **Stop** mid-run.
   - **Expected:** the task stays **Cancelled**. A late gate must never resurrect a run you
     deliberately stopped.
6. **Reply to a finished task.** Open a Done task and send a reply.
   - **Expected:** the reply is refused (HTTP 404 from the runner) rather than accepted into
     a closed session — the task does not sit in **building** forever having acknowledged a
     message nobody received. Use **Continue** to genuinely resume it.

## What success looks like
The only things that mark a task Done are a report gate, a trailing `[[DONE]]`, or closing
text that positively reads as a report. Narration is always answered with a nudge; a gate
raised by an agent that is still working is always delivered or explicitly refused, never
dropped; and a finished task's transcript ends at its `end` event.
