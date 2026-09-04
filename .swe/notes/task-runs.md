# task runs

What happens around a single run: its own changes panel, how a turn's end is classified, the report card's fix-task offer, and skills + attachments.

<!-- Moved out of CLAUDE.md on 2026-08-24 to bring it inside its 20 KB budget (engineering rule 7). Content is verbatim; only the heading level and this header are new. -->

## A task's own changes (the task page's Changes card)
`GET /api/tasks/[id]/changes` answers "what did *this run* change", for both a plain checkout run
and a parallel run's isolated worktree. `lib/task-root.ts` resolves the root; `gitChanges` /
`gitFileDiff` are consumed **unchanged**, so all the hardening in the section below applies
untouched — this feature adds no git call of its own.
- **The only input is the task id.** No path, no directory, no project parameter: the root comes
  from the rows (`findOwnedTask` → the task, its `projectId` → the project). So the containment
  machinery below isn't bypassed here, it simply isn't reachable. Owner scoping is the whole
  boundary, and "not yours" answers exactly like "doesn't exist" (`lib/task-access`).
- **"Is this directory still a worktree" is a stricter question than it looks, and two weaker
  answers were both reproduced.** For a directory git no longer recognises, git walks *up* — and
  `data/worktrees/` is **inside the platform's own repo in a dev checkout** — so the panel rendered
  the platform checkout's entire change set under the task's name. `existsSync(workdir)` misses it;
  `existsSync(workdir + "/.git")` **also** misses it, because that is true for an **empty directory
  named `.git`** and for a symlink to a non-git directory, and git walks straight past both (found
  by the security audit, no race needed — one `mv .git .git.real && mkdir .git` from inside the
  worktree). `isTaskWorktree` (`lib/task-root.ts`) therefore requires: `.git` is a **regular file**
  (`lstat`, so a symlink is judged as itself, and nothing non-regular is ever opened — a planted
  FIFO would block the request), small enough to be a pointer, holding a `gitdir:` that **exists**
  and resolves **under the project's own `.git`** — which is also what bounds a *retargeted*
  pointer, the documented "`.git` file redirects a whole repo" class, at the one place holding both
  `project.path` and `task.workdir`. Containment is skipped when the project is *itself* a linked
  worktree (its `.git` is a file, so its worktrees' admin data lives under the main repo): a false
  negative there would silently show "no changes" for a legitimate run.
  - **Not race-free.** `.git` can go away between the check and git's own discovery in the child;
    the audit reproduced that across the spawn window. Closing it needs `GIT_CEILING_DIRECTORIES`
    on every invocation in `lib/git.ts` (the audit verified it works and leaves legitimate repos
    byte-identical) — shared git hardening this feature consumes unchanged, so it is filed, not
    smuggled in. What survives the clauses above leaks file *names* and line counts, never content.
  - `lib/task-root.test.ts` pins each clause **and** characterises the leak it prevents; reverting
    the guard to either weaker form turns four specs red (verified by reverting).
- **A removed worktree never falls back to the project checkout**, the same stance the diff route
  already takes: the checkout's uncommitted state belongs to whatever is running there now, so
  showing it as a finished isolated run's work would credit this task with someone else's edits.
  It reports its own `worktree-removed` scope and names the branch the commits are on.
- **The card states whose changes it is showing**, because "Changes" on a task page implies
  ownership it can't always claim: a worktree run's list *is* exclusively that run's (so it renders
  expanded), while a checkout run's is a shared tree's (collapsed, with a line saying so).
- **Not polled** — two git subprocesses per load, in the process that also serves the SSE streams.
  It refreshes when the run ends (`TaskLiveView`'s `router.refresh()` changes the server-rendered
  `status` prop) and on demand. Changes during a long run aren't live; that's the trade.
- Clicking a file opens the diff through the existing `/api/projects/[id]/diff?…&task=<id>`, which
  resolves the same worktree — `ChangesList`/`DiffModal` take an optional `taskId` for exactly that
  and send nothing extra when it's absent (the project page's own list is unchanged). Note those
  two routes still gate on a bare `existsSync(task.workdir)`; this card is what makes `?task=`
  one-click reachable, so moving them onto `resolveTaskWorkRoot` is filed.
- **The card's render decisions live in `taskChangesView` (`lib/ui.ts`), not in the component.**
  `pnpm test` cannot reach `components/`, and this is the branchiest part of the feature — which
  scope is exclusive, when to hide the card entirely, when "empty" is honest — so it sits beside
  `orderSkills` with specs. A stale response can't overwrite a newer one either: two loads overlap
  when a run ends mid-refresh, so `load()` stamps a sequence number and drops superseded replies.

## Is a turn's last message the report, or did the agent just stop?
`runner/completion.ts` (`classifyTurnEnd`) answers that for a turn ending with **no** report
gate, no `[[GATE:…]]` marker and no trailing `[[DONE]]` — the runner, not the SDK, decides when
a task is finished. A pause becomes a nudge; a final answer seals the task.
- **Sealing needs positive evidence (2026-09-04).** The first version asked "is there a signal
  of continuation?" and sealed whenever there wasn't — so a preamble naming no dispatched work
  and using no announcing verb went through. Reproduced: `task_2ad6afb5` sealed `done` on
  *"Smoking gun found. Let me confirm the reconciler's status coverage."*, which then became the
  task's report. Now a turn seals only if `looksLikeReport` says so — structured, or ≥60 chars
  carrying completion vocabulary (`REPORTED_WORK_RE`: complete/fixed/committed/passes/…, and
  **not** investigation verbs like "found"/"confirmed", which is what narration says), or ≥500
  chars of prose as a safety valve. Everything else is the new pause reason `"unfinished"`.
- **`NEXT_ACTION_RE` is the subset of `INTENT_RE` that pauses even a structured message** —
  "let me / let's / next I'll / now I'll / I'm going to / time to". `looksStructured` used to
  wave a bulleted analysis through on its formatting alone. A bare "I'll …" is deliberately not
  in it ("I'll hold off on committing" is how a report ends), and "let me know" is excluded from
  both patterns for the same reason.
- **The trade, accepted deliberately:** a terse marker-less summary may now cost one nudge turn.
  That is cheaper than sealing an unfinished task, and an agent that ends without a gate or
  `[[DONE]]` is off-contract anyway. Note "I'll wait for your approval" still pauses via
  `WAITING_RE` — pre-existing, pinned by a spec so the distinction stays visible.
- **`IN_FLIGHT_RE` catches "my dispatched work hasn't come back", which `WAITING_RE` misses**
  because the sentence never mentions waiting: *"both review agents are still running"*, *"the
  audit hasn't returned"*. Measured on a real transcript that ended exactly that way and was
  accepted as a finished report — the task went `done` while its subagents kept writing to the
  transcript.
- **It is deliberately far narrower than `WAITING_RE`** — a named piece of dispatched work
  (reviewer / auditor / subagent) *and* an explicit statement that it hasn't finished — and the
  reason is load-bearing: **`WAITING_RE` matches "I'll wait for your approval to push" and
  "Waiting for your go-ahead", both of which are finished reports.** So `WAITING_RE` must never
  be consulted anywhere the answer *seals* a task. `runner/completion.test.ts` pins both
  directions: six in-flight phrasings pause, and six finished-report phrasings (including
  "Tests are still running in CI, but the change is complete") stay final.
- **What this does NOT fix, knowingly:** a `[[DONE]]`/`[[GATE:REPORT]]` marker skips
  `classifyTurnEnd` entirely, so an agent can still stamp `[[DONE]]` on a report that says its
  reviews are outstanding and seal the task (`bli_dd973b87` is the agent-rules half). Not
  patched by running `WAITING_RE` at the seal point — that would nudge legitimate completions
  into a loop, per the bullet above. *(The other half of `bli_9119b0b6` — events landing after
  the terminal `end` — is fixed; see below.)*

## A gate raised after the runner sealed the run
Sealing used to be irreversible and silent about it: `finalize()` sets `handle.done` and calls
`closeInput()`, so the next `request_approval` died with **`Stream closed`** — the user was
handed a report on a finished task instead of the proposal the agent was trying to raise.
- **`gateAction` (`runner/session-manager.ts`, pure + specced) decides.** A gate on a live run
  is `deliver`. On a sealed run it is `reopen` — clear `done`, re-open the input channel, clear
  `endedAt`/`error`, status back to `awaiting_proposal`/`awaiting_report`, and log that it
  re-opened — *unless* honouring it could not work (this handle is no longer the task's live
  session, the input stream has ended, the worktree was already handed back so the agent's cwd
  is gone) or the seal was a **cancellation**, which a late gate must never undo. Those refuse.
- **`checkoutTaken` is the refusal both review lenses found independently.** `finalize` calls
  `promoteNext` *before* the grace window even opens, so for a **checkout-mode** run the next
  queued job may already be live in `project.path`. Re-opening there would put two
  `bypassPermissions` agents in one working tree — each staging, committing and clobbering the
  other's uncommitted work — which is far worse than the stranded gate this path exists to fix.
  `onGate` therefore re-checks `projectBusy(projectId, taskId)` at re-open time and refuses.
  Worktree-isolated runs own their tree, so it never applies to them. The window is real, not
  theoretical: an agent can be steered (by injected file/web content) to delay its
  `request_approval` until just after its turn's `result`.
- **A refusal is explicit, never a hang.** `onGate` rejects, and `runner/platform-mcp.ts`
  returns that message as a tool result with `isError: true`, so the agent reads a sentence it
  can act on where it reads every other tool result. The summary it wrote is still recorded in
  the transcript first — a gate the user can't answer must not also be invisible.
- **`SEAL_INPUT_GRACE_MS` (15 s) is what makes `reopen` reachable at all.** The input generator
  used to return on the next microtask after `close()`, so by the time a gate arrived the SDK
  stream was gone. It now holds one grace window per close (interruptible — a pushed message
  doesn't wait out the timer), and `isLive()` reports honestly once the generator has returned.
- **Nothing is persisted after the terminal `end`.** `finalize` sets `handle.sealed` right after
  writing `end`, and `record` drops everything — DB *and* SSE — while it is set (`recordAllowed`,
  exported for its spec). A re-open clears it, which is also why the refuse path un-seals just
  long enough to record the agent's summary.
- **`respond()`/`sendReply()` refuse a sealed session** (`replyAction`) instead of pushing into a
  closed channel and setting the task to `building` — a finished task that then sat in "building"
  forever, having acknowledged a reply nobody received. The runner returns 404.

## The report card, and offering a fix task
A change report can end with a "Create fix task" button that dispatches a fresh run against the
report's own text. `fixTaskReasons` (`lib/ui.ts`) decides whether that button exists; the card
in `components/TaskLiveView.tsx` renders it.
- **The button and its explanation come from one list, so it can never appear unexplained.**
  This replaced a boolean (`reportHasFindings`) that decided the same thing and could not say
  why — so the card showed a bare CTA beside a report that never stated what needed fixing, and
  the only honest reaction was "why do I need a fix task?". Now: no reasons → no button; reasons
  → a `warn`-toned callout that names each signal (**Findings section**, **Severity callout**,
  **Unfinished item**, **Recommendation**) and **quotes the line that fired it**. The button
  lives *inside* that callout — the two used to sit a whole report apart.
- **Quoted, never paraphrased.** A summary of a finding is a second thing that can be wrong.
  The evidence is the report's own line, markdown furniture stripped and cut **by code point**
  (`[...str]`, like `cleanTitle`) so a cap can't split a surrogate pair.
- **`evidenceOf` strips `\p{Cc}`/`\p{Cf}`, and that is a security control.** Report text is
  agent-authored and steerable by a file or page the agent read, and React escapes *markup*, not
  Unicode — so a `U+202E` RIGHT-TO-LEFT OVERRIDE survives and makes the quote **display as
  something other than what it says**. Trojan Source, aimed at the one panel designed to be
  believed before a click. Reproduced in a browser: the same planted line renders as "…the log
  **no security** in plain text" in the report body and "…the log **ytiruces on** in plain text"
  in the callout. Real whitespace (TAB, NBSP, U+2028/9) becomes a space *first*, or stripping
  glues words together; `dir="ltr"` on the span bounds anything left. **Write these as `\uXXXX`
  escapes, never literal bytes** — a literal U+2028 is a JS line terminator and broke the parse.
  The markdown-rendered report *body* still has this exposure; it is pre-existing and filed
  (`bli_81e3ed7c`).
- **Judged per line, which is what makes an all-clear readable.** The old version tested the
  whole blob, so "no outstanding issues" lit up `issues?` for the entire report. A line matching
  an all-clear phrase is now skipped — *unless* it carries an explicit severity tag, since
  `[Medium] looks good overall, but…` is a grading, not reassurance.
- **One row per kind, capped at four.** An audit lists twenty findings; twenty near-identical
  callout rows would be a second copy of the report where the job was to explain one button.
- **It is still a guess about prose, and that's the point of showing it.** A report describing
  bugs it already *fixed* ("## Bugs found beyond the reported symptoms") still matches — but the
  user can now see the matched line and dismiss it, instead of being handed a silent verdict.
  It had **no specs at all** before; `lib/ui.test.ts` now covers each signal, the all-clear
  suppression, the cap, the code-point cut, and that exact false positive.

## Skills, and attaching files to a live run
- **A command is called a *skill* in the UI** ("Workflow" until 2026-08-13). The code keeps
  `commands` — that's the plugin directory's own name for them (`agents/<ns>/commands/*.md`)
  and the DB column — so `AgentCommand` isn't renamed; only what a user reads.
- **`orderSkills` (`lib/ui.ts`) decides both the order and whether `onboard` is offered.**
  Discovery sorts commands by filename, which put `audit`/`onboard` ahead of `task`; the picker
  shows working order instead (fe: task, fix, audit, review, plan, ship · swe: task, fix,
  security, review, plan, ship, workspace). A skill missing from that table keeps its
  alphabetical place after the listed ones, so a new command still appears without a code
  change.
  - `onboard` **leads** the row until the agent is onboarded on that project, and is **dropped**
    from it once it is. Onboarding is a one-time step, and a permanent chip for it sat in front
    of the skills people actually came for.
  - Which makes `ONBOARD_MARKERS` (`lib/discovery/projects.ts`) load-bearing rather than
    cosmetic: a namespace with no marker reads as "always onboarded", so its onboard skill would
    never be offered. pm's marker (`.pm/notes.md`) was added for exactly that reason. **Add one
    whenever an agent gains an `onboard` command.**
  - A "Re-onboard /ns" link keeps it reachable, because CLAUDE.md and `.fe/design-system.md` go
    stale and re-running onboarding is a real need. It re-includes the skill and selects it.
- **Files can be attached to a gate answer, not only to a finished task.** The composer with
  the attach button renders only on a *terminal* task, so for a run that was live — the one
  moment the agent is actually listening — there was no way to send a screenshot at all.
  `POST /api/tasks/[id]/respond` now takes multipart as well as JSON: the files are saved under
  the task's own upload directory and `attachmentNote` appends their paths to the feedback the
  agent receives. **Only paths we just wrote are appended** — accepting a client-supplied path
  here would turn gate feedback into "ask the agent to read any file on the device".
  - **Files are only accepted while a gate is actually pending** (`awaiting_proposal` /
    `awaiting_report`). Without that check `respond` was a write primitive needing no agent turn
    and no state change — a loop of multipart posts against your own task fills the disk faster
    than the `continue` path, which at least demands a terminal task and starts a session. Found
    by the security review of this change. Answering a gate clears it, so writes are bounded to
    one batch per gate. A text-only answer is unaffected.
  - **`saveAttachments` takes the task's existing attachments, not just their names**, and
    enforces cumulative ceilings (`MAX_TASK_FILES` 30, `MAX_TASK_BYTES` 100 MB) on top of the
    per-request 10 × 25 MB. Per-request caps bound one upload, never a sequence of them, and a
    task accepts batches at dispatch, at every gate and on every follow-up. Over-cap files are
    skipped, not an error — the caller reports what it got back.
- **A route that reads multipart uses `readFormData` (`lib/uploads.ts`), never
  `request.formData()` directly.** Undici throws on a `multipart/form-data` request with no
  `boundary`, and an unhandled throw in a route handler is an HTML 500 — the composer can't read
  an error out of that, so it showed a bare "Failed to dispatch task". This install's log had
  seven of them and no way to tell what had been sent. The helper returns null (→ 400 with
  `BAD_MULTIPART`) and logs the content-type that caused it.
- **The client sends multipart only when there are files**, JSON otherwise. The plain
  "Continue" button used to post a completely empty `FormData`.
- **A rejected `fetch` must be caught in the composer.** `NewTaskForm` didn't, so a network
  error left the button spinning on "Dispatching…" for good with nothing said — from the user's
  side, indistinguishable from the app ignoring them.
