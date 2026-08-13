# Test scenario: skills, backlog titles, and attaching files to a live run

_Task: five requests in one — (1) a backlog run keeps the item's title instead of paying a
Haiku call to rename it, (2) attachments, (3) `onboard` only offered until it's done +
"Workflow" renamed to "Skill", (4) fe/swe skill order, (5) fe/swe file planned + out-of-scope
work into the backlog, escalating to pm what they couldn't scope · 2026-08-13_

## What changed

**Backlog → task titles**
- `lib/dispatch.ts`: `DispatchInput.title` is stored on the new row (normalised to one line,
  80 chars; empty stays null). The runner only names a task whose row has no title, so a
  pre-set title suppresses the naming call.
- `app/api/projects/[id]/backlog/[itemId]/run/route.ts` passes `item.title`.

**Attachments**
- `app/api/tasks/[id]/respond/route.ts` accepts multipart, so files can be attached to a
  **gate answer** (previously the only composer that took files appeared *after* a task
  finished). Saved under `data/uploads/<taskId>/`; their paths are appended to the feedback
  the agent receives.
- `lib/uploads.ts`: `readFormData` (a malformed multipart body → 400 with a readable message
  instead of an HTML 500) and `attachmentNote` (shared by the runner's prompt and the gate
  reply).
- `components/NewTaskForm.tsx` catches a rejected `fetch` (it used to leave the button
  spinning on "Dispatching…" forever). `components/TaskLiveView.tsx` sends JSON rather than
  an empty `FormData` when there are no files, and reports a gate answer that didn't land.

**Skills**
- `orderSkills` in `lib/ui.ts`: curated order (fe: task, fix, audit, review, plan, ship ·
  swe: task, fix, security, review, plan, ship, workspace), and `onboard` leads the row until
  the agent is onboarded, then disappears from it. A "Re-onboard /ns" link brings it back.
- `ONBOARD_MARKERS` gained `pm: ".pm/notes.md"`. Every user-visible "Workflow" is now "Skill"
  (new-task picker, Getting started, agents pages).

**Backlog ↔ agents**
- An item can be assigned to **pm**, and running it dispatches `/pm:plan` (not `/swe:task`).
- The swe/fe agents' rules now tell them to file planned tasks and out-of-scope findings as
  backlog items, using `assignee: "pm"` for anything they couldn't scope.

## Setup / preconditions

- The stack running: `pnpm dev` (dev container, http://localhost:3001) or the installed app
  (`control-center start`, http://localhost:7373). Both work; the paths below say "the app".
- A registered project that **has** a `CLAUDE.md` (so swe reads as onboarded) — this repo
  qualifies.
- An Anthropic token saved under Settings (needed only for the steps that actually dispatch).
- Have a screenshot or photo on hand (any `.png`/`.jpg` under 25 MB).

---

## 1 — The skill picker: order, and no `onboard` once onboarded

1. Open the project page. Under the agent cards, the section heading reads **Skill** (not
   "Workflow").
2. With **/swe** selected, the chips read, left to right: `task fix security review plan ship
   workspace`. **There is no `onboard` chip**, and a dotted-underline **Re-onboard /swe** link
   sits at the end of the row.
3. Click the **/fe** card. The chips read: `task fix audit review plan ship` — again no
   `onboard`, and the link now says **Re-onboard /fe**.
4. Click the **/pm** card. The only chip is `plan` (this repo has `.pm/notes.md`, so pm counts
   as onboarded).
5. Click **Re-onboard /fe**: an `onboard` chip appears at the front of the row **and is
   selected**, the description below updates, and the code on the right reads
   `/fe:onboard on Auto (smart)`. Nothing is dispatched until you press Run.
6. Switch to another agent and back — the row is collapsed again (the reveal doesn't stick).

**Edge case — a project that has *not* been onboarded.** Register a folder with no
`CLAUDE.md` (Projects → Add project). On its page with /swe selected, `onboard` is the
**first** chip and selected by default, and the amber "hasn't been onboarded on this project
yet" notice appears when you pick any other skill. That's the unchanged behaviour — the new
rule only hides `onboard` once the marker exists (`CLAUDE.md` for swe, `.fe/design-system.md`
for fe, `.pm/notes.md` for pm).

## 2 — A backlog item keeps its own title

1. On the project page find the **Backlog** card → **Add item**. Title it something you'll
   recognise and that a model would obviously rewrite, e.g.
   `zz check the footer year is not hardcoded`. Give it a one-line description. Save.
2. Press **Run** on that row. It flips to *In progress* and links to a task.
3. Open the task. **The task's name is the item's title, verbatim** — same words, same
   casing — in the page header and in the project's task list. Before this change it would
   have been re-titled into something like "Fix Hardcoded Footer Year" a few seconds after
   dispatch.
4. Watch it for ~15 seconds: the title must **not** change while the task runs. (Cancel the
   task when you've seen enough — the point is the name, not the work.)

**Contrast case:** dispatch anything from the **New task** form instead (Skill `task`, a
sentence as the prompt). That one *is* named by the model a few seconds in — untitled rows
still get a generated name, which is the behaviour we kept.

## 3 — Attaching a file to a task that is still running (the gate)

1. From **New task**, dispatch a `/swe:task` that will reach a proposal gate quickly, e.g.
   `rename the dashboard heading to "Overview"`.
2. Wait for the amber **Proposal — approve to start building** card.
3. The feedback box inside that card now has an **Attach files** bar under it. Click it and
   pick your screenshot (or drag the file onto the box — the whole box is a drop target).
   The file appears as a chip with its size.
4. Type a sentence of feedback, e.g. `use the wording in this screenshot`, then press
   **Approve with changes** (the button says "Approve with changes" as soon as there is text
   *or* a file).
5. The transcript shows your decision with `(+1 file)` appended, and the agent continues. In
   its next messages it should **Read** the file — you'll see a `Read` tool call naming a path
   under `data/uploads/<taskId>/`.
6. The task header's attachment count includes the new file.

**Edge case — approve with a file and no text.** Same flow, but leave the feedback box empty
and only attach a file. The button still reads "Approve with changes", and the agent is told
about the file.

## 4 — Attaching a file to a finished task, and to a new one

1. On a task that is `done`/`failed`, use the composer at the bottom ("Request changes or a
   follow-up"): attach a file, press **Send to agent**. It resumes and reads the file.
2. Press the plain **Continue from where it left off** button on a failed task (no text, no
   files). It resumes normally — this now goes out as JSON rather than an empty multipart
   body, so the visible behaviour must be unchanged.
3. From **New task**, attach a photo, write a prompt, press **Run task**. The task is created
   with the file attached (header shows the count).

**Edge case — the server goes away mid-send.** Stop the server (`pnpm stop`, or
`control-center stop`), then press **Run task** in a tab you already had open. Within a moment
you get a red **"Couldn't reach the server. Check it's still running and try again."** and the
button returns to "Run task". Before this change the button stayed on "Dispatching…" forever
with no message. Start the server again afterwards.

**Edge case — a malformed upload.** With the server running:

```
curl -s -w '\nHTTP %{http_code}\n' -X POST \
  http://localhost:3001/api/tasks/<any-of-your-failed-task-ids>/continue \
  -H 'Content-Type: multipart/form-data' --data-binary 'garbage'
```

Expect **HTTP 400** and
`{"error":"The upload didn't arrive intact — the request body wasn't valid form data. Try
again, or send the request without the attachment."}` — not a 500 HTML page. The server log
also gains one line naming the content-type it refused
(`[uploads] unreadable multipart body — content-type: "multipart/form-data" …`).

## 5 — Assigning a backlog item to pm

1. **Backlog → Add item.** Title it like a problem you can't scope, e.g.
   `zz uploads sometimes fail on the installed app`. In the **Agent** select, choose
   **/pm — Project manager — investigate & break it down**. Save.
2. The row shows `/pm`. Hovering **Run** says "Hand this to the pm agent to investigate and
   break into tasks".
3. Press **Run**. Open the task: the command is **`/pm:plan`**, not `/swe:task` (visible in
   the task header and in the task list row).
4. Let it finish planning (it stops at its own gate for approval — you can cancel instead;
   the point is the routing).
5. If you did let it write specs into `.pm/tasks/`, reload the project page: the backlog now
   also lists those specs as items with `/swe` or `/fe` assignees — the round trip from
   "problem" to "implementable tasks".

## 6 — Agents filing their own work (needs a real run)

1. Dispatch `/swe:plan` on a goal big enough to decompose, e.g.
   `add a per-project activity feed`. Approve the epic when it presents one.
2. After approval it files **one backlog item per planned task**. Reload the project page: the
   items are there, `source: agent`, with the epic's task titles.
3. Re-run the same `/swe:plan` on the same goal. The items are **not duplicated** — the agent
   is told "Already in this project's backlog" and reports that instead.
4. Dispatch `/fe:audit` (or `/swe:review` on a diff). Its report should end by naming the
   items it filed, with anything it couldn't scope filed as **`/pm`**.

> These last two depend on the agent following its rules, so treat a miss as a prompt bug, not
> a code bug: the platform side is proven by steps 1–5 (the tool accepts `pm`, dedupes by
> title, and a pm item dispatches `/pm:plan`).

## Clean-up

Delete the `zz …` backlog items you created (set them to **Cancelled** — there is no delete
endpoint, and cancelled items stop counting against the project's cap), and cancel any task
you left running.

## Automated coverage

`docker exec platform env -u RUNNER_HOST pnpm test` — 247 tests, including:
- `lib/dispatch.test.ts` — a caller-supplied title is stored (the mechanism that suppresses
  naming); normalisation and the empty cases.
- `lib/ui.test.ts` — fe and swe skill order, `onboard` hidden when onboarded / leading when
  not (all three namespaces), an unknown skill keeping its alphabetical place, no mutation of
  the caller's array.
- `lib/uploads.test.ts` — a boundary-less and a truncated multipart body both yield null; a
  real one still parses; the note's wording and paths; `saveAttachments` skipping empty files,
  reducing a traversing name to its basename, and not clobbering an earlier batch.
- `lib/backlog.test.ts` — `pm` accepted as an assignee, `dba` rejected.
- `runner/backlog-tool.test.ts` — the tool's enum accepts fe/swe/pm and rejects `PM`/`pm `/
  `dba`/`""`; a pm-assigned item stores and stays `todo`.
