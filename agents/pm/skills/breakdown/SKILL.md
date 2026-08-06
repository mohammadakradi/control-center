---
name: breakdown
description: Break an approved solution into stack-specific, self-contained implementation tasks written under .pm/tasks/<timestamp>/. Use after the user approves a /pm:plan proposal. One task per stack (backend/frontend/services/devops/data), each assigned to swe or fe.
---

# Breaking a request into tasks

Goal: turn an approved solution into a set of **self-contained implementation tasks**, one per
stack, that the `swe`/`fe` agent (or a developer) can execute without further questions.

Read `${CLAUDE_PLUGIN_ROOT}/rules/pm-rules.md` and
`${CLAUDE_PLUGIN_ROOT}/rules/task-template.md` first.

## Procedure

### 1. Slice by stack
Map the approved solution onto stacks and create **one task per stack** it touches:
- **backend** — APIs, business logic, persistence access, server code.
- **frontend** — UI, components, styling, client state. (→ assignee `fe`.)
- **services** — background workers, queues, cron, schedulers, daemons.
- **devops** — infra, CI/CD, deploy, secrets/env, observability.
- **data** — schema, migrations, ETL, analytics.
Never combine two stacks in one task. Split within a stack only when pieces ship independently.
Determine **dependencies** between tasks and an execution order.

### 2. Assign
Set `assignee` per task: **`fe`** if it's frontend-only; **`swe`** otherwise (backend,
services, devops, data, fullstack).

### 3. Write the files
Get a timestamp: `date +%Y%m%d-%H%M%S`. Create `.pm/tasks/<timestamp>-<slug>/` and write:
- `<NN>-<stack>-<slug>.md` per task (numbered in execution order) as a **short, simple brief**
  from the task template — four sections only: **Issue, Goal, Suggested solution, Affected
  areas (files & features, cited from the graphify graph)** — plus frontmatter (`title`,
  `stack`, `assignee`, `priority`, `depends_on`). No acceptance-criteria checklists, contract
  dumps, out-of-scope, or testing notes; the `swe`/`fe` agent that implements the task does
  the detailed plan and tests.
- `index.md` — the request, the chosen solution in brief, and the task list with one-line
  summaries + assignees.

### 4. Quality self-check (blocking, light)
Before finishing, run the self-check in `${CLAUDE_PLUGIN_ROOT}/rules/task-quality.md` over
every task you wrote: each is a concise brief with the four sections present and specific to
this project (Affected areas cites real files/features), one stack per task with the correct
`assignee`, shared things named consistently across tasks, coherent `depends_on`, and complete
coverage of the approved solution. **If any task fails, fix it and re-check.** Don't finish
with a failing task; report the check's outcome.

### 5. Report
Return the created task list with each file path as **inline code** (clickable in the UI),
each line: `- **[<assignee>] <Title>** — \`.pm/tasks/<ts>-<slug>/<NN>-<stack>-<slug>.md\``.
End with `[[DONE]]`.
