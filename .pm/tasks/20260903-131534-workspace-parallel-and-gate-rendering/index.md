# Workspace parallel runs, per-task changes, and honest gate/report rendering

**Request (2026-09-03):** "I can't run some tasks in parallel, specially in Award Maven project.
Also sometimes report is not being displayed in its correct way — I need agents to always display
proposal, change report and final report in its correct way and design without displaying any
extra messages. Also sometimes task status is done, but agent still is running and stream is
live." Follow-up: "parallel run **and changes section per task** (in task detail page) is not
available for Award Maven project. Also right now, instead of proposal and tasks, you have given
me a report and task is done." Second follow-up: "when a feature is closed, don't display it in
feature section, filter it out — if user wanted to see closed features, they can filter on closed.
Also create fix task creates task for pm (`pm:task`) which is not available."

## Request assessment

- **Verdict:** BUILD — every premise is true; two were reproduced live on the running install,
  one of them on this planning task itself.
- **What was asked:** enable parallel runs (and the per-task Changes card) on the Award Maven
  project; make proposal / change report / final report always render correctly and without
  narration; stop tasks going `done` while the agent is still running.
- **What the code actually does:**
  - **Award Maven is the only `isWorkspace: true` project** in the install (root
    `/Users/moh/Dev/Vue/AW-Maven/portal`, members `../portal-frontend`, `../am-workers`). One flag
    disables both reported features:
    - Parallel: `parallelOffer` (`lib/dispatch.ts:89-94`) returns `isGit && !isWorkspace`, so the
      checkbox is never offered; `createAndStartTask` answers **400** for a workspace
      (`lib/dispatch.ts:174-183`); `launchMode` (`runner/worktree.ts:86-92`) has
      `canIsolate = isGit && !isWorkspace`, so a workspace always falls to `busy ? "queue" : "run"`
      — concurrency is hard-capped at 1. Confirmed empirically: **81/81 Award Maven tasks ran with
      `parallel = false` and `workdir = null`** (Control Center: 5 parallel / 3 worktrees;
      Finsight: 4 / 3).
    - Changes card: `resolveTaskWorkRoot` (`lib/task-root.ts:48`) returns
      `{ kind: "unavailable", reason: "workspace" }` before asking any git question, and
      `taskChangesView` (`lib/ui.ts:835`) maps `available === false` to `{ kind: "hidden" }` — so
      the card silently disappears with no explanation. Live check: Award Maven task →
      `{"available":false,"reason":"workspace"}`; Control Center task → `{"available":true,…}`.
  - **Report text has three unnormalized producers** and no shared "drop the narration" step: the
    `request_approval` `summary` (`runner/platform-mcp.ts:30-45` → `onGate`,
    `runner/session-manager.ts:680-693`), the raw assistant message (marker fallback), and the
    runner's own passthrough synthesis `${endText}\n\n[[DONE]]`
    (`runner/session-manager.ts:997-1014`). Only the three literal marker tokens are stripped
    (`components/TaskLiveView.tsx:73-74`); preamble is rendered verbatim.
  - **`[[GATE:PROPOSAL]]` has no client branch** (`components/TaskLiveView.tsx:70-72`, `:192-193`),
    unlike `[[DONE]]` / `[[GATE:REPORT]]` — so a proposal that misses its tool call has no
    proposal rendering at all and the marker leaks literally.
  - **A phantom duplicate gate:** `hasGate` reads the session-sticky `lastAssistantText`
    (`runner/session-manager.ts:884`, `:925`) rather than turn-local text, so a turn whose gate was
    already resolved by the tool call fires a **second** `gate` event (`:962-974`) with no
    `pendingApproval`. Approving it takes `respond()`'s fallback branch (`:1108-1127`), which
    injects a stray "Approved. Proceed." into the conversation and force-sets `building`.
  - **`classifyTurnEnd` seals a task on narration.** Reproduced on this very task
    (`task_2ad6afb5`): sealed `done` at `2026-09-03T09:31:24Z` while the session kept running and
    recording events past `end`. The sealing message was a tool-call preamble — *"Smoking gun
    found. Let me confirm the reconciler's status coverage."* `finalize()`
    (`runner/session-manager.ts:360-409`) never stops the SDK output iterator, and `record()`
    (`:879`) is unconditional. `finalize()` also calls `closeInput()` (`:406`), which is why the
    subsequent `request_approval` call for this very proposal failed with **`Stream closed`** —
    the user got a *report* on a *done* task instead of a proposal with tasks.
  - **The live event stream never closes gracefully.** The cold path sends
    `event: "closed"` (`runner/server.ts:124`); the live path just returns (`:128-145`), so the
    browser sees a plain EOF, `EventSource` auto-reconnects
    (`components/TaskLiveView.tsx:383-387`), and inside the 60 s post-`finalize` grace window
    (`runner/session-manager.ts:1023-1028`) `getHandle` still returns the finished handle — the
    reconnect parks on a promise that never resolves. `connected` stays `true` forever, and the
    indicator is `connected ? "live" : …` (`components/TaskLiveView.tsx:567`), a transport boolean
    decoupled from run state.
  - **No heartbeat vs. undici's 300 s default `bodyTimeout`:** the proxy is a bare `fetch`
    (`app/api/tasks/[id]/stream/route.ts:26-31`) with no dispatcher, and the runner emits no
    `: ping`. The install's `web.log` holds **224 × `UND_ERR_BODY_TIMEOUT` / "failed to pipe
    response"**.
  - **A closed feature never leaves the screen.** `listFeatures` (`lib/features.ts:186-193`)
    returns every row whatever its `status`, and there is no status filter anywhere — the project
    page's Features card (`app/(app)/projects/[id]/page.tsx:127`) shows a `Chip`
    (`components/FeatureManager.tsx:400-401`) and the backlog page's groups merely start collapsed
    (`components/FeatureGroup.tsx:41-43`, `:124-130`). This is a **documented design stance being
    reversed**: `lib/features.ts:345` says closing a feature out *"keeps it on screen forever as a
    collapsed heading, which is right for finished work"*. The precedent to follow already exists
    one page over — backlog *items* split on `isOpenBacklogStatus`, count the remainder in the
    header, and disclose it separately (`app/(app)/backlog/page.tsx:122`, `:159`, `:211-214`).
  - **"Create fix task" dispatches a command that doesn't exist.** `createFixTask` hardcodes
    `command: "task"` against the report's own `agentId` (`components/TaskLiveView.tsx:542`), and
    `agents/pm/commands/` holds only `onboard.md` and `plan.md` — so on a pm report the button
    asks for `/pm:task`. Nothing catches it: `DispatchInput.command` is a bare `string`
    (`lib/dispatch.ts:99`), stored unvalidated (`:226`), and the runner formats it blind into
    `/${namespace}:${command}` (`runner/session-manager.ts:723-724`), so Claude Code receives that
    line as **prose** — no error, the run just does something else. Every other path is safe by
    construction rather than by validation: `NewTaskForm` builds its picker from the discovered
    list (`components/NewTaskForm.tsx:150-154`), and `readCommands`
    (`lib/discovery/agents.ts:43-56`) already parses the real inventory — it is simply never
    consulted here. Two smaller problems ride along: `swe` and `fe` both ship a purpose-built
    `fix` command that the button ignores in favour of `task`, and a fix task raised from a *pm*
    report is handed to the agent that plans rather than one that implements.
  - **The follow-up callout fires on non-findings.** In the attached screenshot the flagged reason
    is *"Recommendation — Filed the two out-of-scope findings…"* — a line saying the work is
    already recorded. `fixTaskReasons` (`lib/ui.ts:689-718`) matches `RECOMMENDATION_LINE` on any
    line and only excuses an explicit `ALL_CLEAR_LINE`, so a report that merely *mentions*
    recommendations earns an amber "This report flags follow-up work" banner.
- **Already implemented?** No. The workspace refusals are deliberate and documented; the gate and
  stream defects are unfiled except the late-subagent-events half (`bli_9119b0b6`,
  `bli_dd973b87`, per `.swe/notes/task-runs.md`); the closed-feature stance is documented as
  intentional and is being changed on purpose.
- **Risks / conflicts:** the workspace isolation task is the only substantial one — N worktrees
  plus per-repo merge-back. Nothing here weakens owner scoping (`lib/task-access.ts`) or the
  `lib/git.ts` / `isTaskWorktree` containment work, which must be consumed unchanged.
- **Real need:** run several Award Maven tasks at once and see each one's diff; and be able to
  trust the task page — a gate is a gate, a report is a report, "done" means the agent stopped, a
  button starts a run that exists, and a finished feature gets out of the way.
- **Recommendation:** proceed with the ten tasks below.

## Tasks

| # | Title | Stack | Assignee | Depends on |
|---|---|---|---|---|
| 01 | Isolate a workspace's member repos so its tasks can run in parallel | services | swe | — |
| 02 | Report per-task changes for a workspace across its member repos | backend | swe | 01 |
| 03 | Stop sealing a task on narration, and keep its gate reachable | services | swe | — |
| 04 | Close the task event stream, and keep it alive while a run is quiet | backend | swe | — |
| 05 | One normalized source of truth for proposal, change-report and final-report text | backend | swe | — |
| 06 | Unify the three report cards, and stop showing "live" on a finished run | frontend | fe | 05 |
| 07 | Show a workspace task's changes grouped per member repo | frontend | fe | 02 |
| 08 | Hide closed features by default, with a filter to bring them back | frontend | fe | — |
| 09 | Refuse a dispatch whose command the target agent doesn't have | backend | swe | — |
| 10 | Point "Create fix task" at a command that exists, and stop flagging non-findings | frontend | fe | 09 |

Tasks 01→02→07, 05→06 and 09→10 are the only orderings that matter; 03, 04, 05, 08 and 09 are
independent of each other and of the workspace pair. **03 is the one to run first** — it is the
bug that made this very planning run misbehave. Tasks 06 and 10 both touch the follow-up callout:
06 owns its design, 10 owns its content and button target.

## Out of scope, filed separately

- `~/.control-center/data/platform.db` has reached **545 MB** (4.3 MB WAL) — worth a retention or
  vacuum story of its own. Filed as `bli_7a99ac63`.
- Award Maven's recorded `defaultBranch` is a **stale, upstream-less local branch**
  (`feature/in-app-ai-assistant-organization-program`, while the checkout is actually on
  `feature/use-the-in-app-ai-assistant-to-design-layouts-shape-starter`), spamming
  `fatal: no upstream configured for branch …` through the logs. Filed as `bli_c2b4d806`.
