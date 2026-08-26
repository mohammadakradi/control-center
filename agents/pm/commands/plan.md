---
description: Analyze the project, investigate the best solution for a request, propose it for approval, then break it into stack-specific implementation tasks (.pm/tasks/<timestamp>/) — each hand-offable to the swe/fe agent.
argument-hint: <the request / feature / problem to plan>
---

Plan this request into implementation tasks: **$ARGUMENTS**

Follow the **planning workflow** in `${CLAUDE_PLUGIN_ROOT}/rules/workflow.md` and the
project-manager rules in `${CLAUDE_PLUGIN_ROOT}/rules/pm-rules.md`. **Read each of those
at most once**, at the start — they don't change mid-request, and a re-read is a second
full copy in the transcript, re-sent on every later call (rule 11). You **plan only — you
do
not write product code or touch git.**

In short:

1. **Investigate & validate the request** — read the `.pm/notes.md` index and only the topic
   files this touches (`CLAUDE.md` is already in your context — don't read it); ensure the
   graphify code graph exists (run `${CLAUDE_PLUGIN_ROOT}/scripts/ensure-graphify.sh .` if
   missing) and **query it** (`graphify query/explain/path/affected`). Then **master the
   request before solutioning** per `${CLAUDE_PLUGIN_ROOT}/rules/request-validation.md`: with
   cited evidence, is the premise true? does it **already exist** (fully, or built-but-not-
   enabled)? would it **break a workflow / regress / open a security hole** (`graphify
   affected`)? what's the **real need**? Reach a verdict: `BUILD` / `ENABLE` / `ALREADY-DONE`
   / `PREMISE-WRONG` / `RISKY` / `PARTIAL`. Use the `analyst` subagent for big investigations.
2. **Assessment + (if warranted) proposal** 🚦 — **lead with the request assessment** (verdict
   + what the code actually does + already-implemented? + risks + real need + recommendation).
   Then, only for `BUILD`/`ENABLE`/`PARTIAL`/an approved safer alternative, present the goal,
   solution (alternatives weighed), and **task breakdown** (one task per stack — each with
   title, stack, **assignee** (`fe` if frontend-only, else `swe`), one-line scope, deps). For
   `ALREADY-DONE`/`PREMISE-WRONG`/recommend-against, propose **no tasks**. **Stop and wait for
   the user;** revise if asked.
3. **Create the task files** — after approval, create `.pm/tasks/<YYYYMMDD-HHMMSS>-<slug>/`
   (timestamp from `date`) and write one **short, simple** markdown file per task using
   `${CLAUDE_PLUGIN_ROOT}/rules/task-template.md` — four sections only (**Issue, Goal,
   Suggested solution, Affected areas (files & features)**) plus frontmatter incl. `assignee`.
   No acceptance-criteria checklists, contract dumps, out-of-scope, or testing notes — the
   `swe`/`fe` agent does the detailed plan and tests. Write an `index.md` summarizing the
   request and listing the tasks.
4. **Quality self-check** (blocking, light) — re-read every task and run
   `${CLAUDE_PLUGIN_ROOT}/rules/task-quality.md`: confirm each is a concise brief with the four
   sections present and specific (Affected areas cites real files/features), one-stack-per-task,
   correct assignee, shared things named consistently, coherent `depends_on`, and complete
   coverage. Fix any task that fails and re-check before reporting.
5. **Report** — finish (ending with `[[DONE]]`) with a nutshell summary, the **quality-check
   outcome** in one line, and a list of created tasks where **each file path is inline code**
   so the UI makes it a clickable chip:
   `- **[<assignee>] <Title>** — \`.pm/tasks/<ts>-<slug>/<NN>-<stack>-<slug>.md\``
