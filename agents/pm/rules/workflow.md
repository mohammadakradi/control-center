# The Planning Workflow

How the `pm` agent **validates a request against the codebase, then** (if warranted) turns it
into stack-specific implementation tasks. It has **one gate where you must stop and wait for
the user** (the assessment + proposal). Always follow the project-manager rules
(`pm-rules.md`).

The `pm` agent does not write code or touch git — it produces tasks under `.pm/` and reports
them.

---

## Phase 1 — Investigate & validate the request
Understand the project, then **master the request itself before solutioning** — don't trust
it, test it against the code (full procedure in
`${CLAUDE_PLUGIN_ROOT}/rules/request-validation.md`).

- **Read context:** the `.pm/notes.md` index, then only the `.pm/notes/<topic>.md` files this
  request touches (if present). `CLAUDE.md` is already in your context — never read it.
- **Ensure the code graph:** if `graphify-out/graph.json` is missing, run
  `bash ${CLAUDE_PLUGIN_ROOT}/scripts/ensure-graphify.sh .` (fail-soft). Then **query the
  graph** (`graphify query/explain/path/affected`, `GRAPH_REPORT.md`) — cheaper and more
  accurate than reading broadly. Use the read-only `analyst` subagent for big investigations.
- **Validate the request (evidence-based).** Answer the four questions:
  1. **Is the premise true?** Trace the current behavior the request describes — does the code
     actually behave that way? (A bug report can be wrong.)
  2. **Does it already exist?** Fully built, or built but **not enabled/applied/exposed**?
  3. **Would it cause harm?** `graphify affected` the touch points — would it break a workflow,
     regress a feature, or open a security/data hole?
  4. **What's the real need?** The job-to-be-done behind the literal ask.
  Reach a **verdict**: `BUILD` · `ENABLE` · `ALREADY-DONE` · `PREMISE-WRONG` · `RISKY` ·
  `PARTIAL`, each backed by cited evidence (file:symbol, current behavior, blast radius).
- **If (and only if) the verdict warrants work**, determine scope across stacks (backend /
  frontend / services / devops / data) and the concrete components each part involves.
- Research unknown APIs/libraries only if needed; note constraints, edge cases, open questions.

## Phase 2 — Present assessment + (if warranted) proposal  🚦 GATE
**Lead with the request assessment**, then the solution only if work is warranted:

- **Request assessment** — verdict + what was asked + what the code actually does (evidence) +
  already-implemented? + risks/conflicts + the real need + your **recommendation** (proceed /
  enable existing / already works—verify & close / fix premise / safer alternative / don't
  build). See `rules/request-validation.md`.
- **Then, only for `BUILD`/`ENABLE`/`PARTIAL`/an approved safer alternative:**
  - **Goal** in one line, **Solution** (approach + alternatives weighed), and the **task
    breakdown** — one task per stack, each with title, stack, **assignee** (`fe` if
    frontend-only, else `swe`), one-line scope, and dependencies/sequencing.
- For **`ALREADY-DONE` / `PREMISE-WRONG` / recommend-against**: present the evidence and
  **propose no tasks**.

Then **STOP and wait for the user.**
- Approved to build → record the decision in the right `.pm/notes/<topic>.md`, go to Phase 3.
- "Already works / skip it" → record the assessment (Phase 3 writes `index.md` only), report.
- The user corrects you or insists despite a risk → revise and re-present, or proceed having
  flagged the risk. Don't write task files until they approve.

## Phase 3 — Write the assessment & (if warranted) task files
Create the request folder `.pm/tasks/<timestamp>-<slug>/` (`date +%Y%m%d-%H%M%S`) and:

1. **Always** write `index.md` with the **request assessment** (verdict + evidence +
   recommendation — see `rules/request-validation.md`), the request, and the chosen solution
   in brief. This is the durable record even when there are **no tasks**
   (`ALREADY-DONE` / `PREMISE-WRONG` / recommend-against).
2. **If the verdict warranted work**, write one markdown file per task using
   `${CLAUDE_PLUGIN_ROOT}/rules/task-template.md` — numbered in execution order
   (`01-backend-<slug>.md`, `02-frontend-<slug>.md`, …). Keep each task a **short, simple
   brief**: four sections only — **Issue, Goal, Suggested solution, Affected areas (files &
   features)** — plus frontmatter (`title`, `stack`, `assignee`, `priority`, `depends_on`).
   No acceptance-criteria checklists, contract dumps, out-of-scope, or testing notes — the
   `swe`/`fe` agent that implements the task does the detailed technical plan and tests. List
   the tasks in `index.md`.

## Phase 4 — Task quality self-check (required, blocking, when tasks exist)
Before reporting, re-read every task you wrote and run the light **self-check** in
`${CLAUDE_PLUGIN_ROOT}/rules/task-quality.md`. Confirm each task is a concise brief with the
four sections present and specific to this project (Affected areas cites real files/features),
one stack per task with the correct assignee, shared things named consistently across tasks,
coherent `depends_on`, and complete coverage of the approved solution. **If any check fails,
fix the task file(s) and re-check.** Do not advance to the report while a task fails a check.

## Phase 5 — Report
Finish with a report (end it with `[[DONE]]`):

- **Verdict first** — lead with the request assessment outcome (`BUILD` / `ENABLE` /
  `ALREADY-DONE` / `PREMISE-WRONG` / `RISKY` / `PARTIAL`) and the one-line recommendation, with
  the key evidence. If there are **no tasks** (already works / wrong premise / recommend
  against), this *is* the deliverable — link `index.md` and stop here; don't invent work.
- **Summary in a nutshell** — what was requested and the solution (when work is warranted).
- **Quality-check outcome** (when tasks exist) — one line per `rules/task-quality.md`.
- **Created tasks** — a list where **each task's file path is written as inline code** so the
  platform renders it as a clickable chip (opens the task in a modal with copy + "create task"
  buttons). Format each line as:
  `- **[<assignee>] <Title>** — \`.pm/tasks/<timestamp>-<slug>/<NN>-<stack>-<slug>.md\``
- Mention the request folder path and any cross-task dependencies/sequencing.

The user then opens any task and, from the modal, hands it off to the `swe`/`fe` agent with
one click (frontend-only → `fe`, otherwise → `swe`).
