# pm — portable project-manager agent

A Claude Code plugin that turns Claude into a **project manager**. Give it a request; it
analyzes the project (via the [graphify](https://github.com/safishamsi/graphify) code graph),
investigates the best solution, **proposes it for your approval**, then breaks the approved
solution into **stack-specific implementation tasks** — one per backend / frontend / services
/ devops / data — written to `.pm/tasks/`. Each task is self-contained and ready to hand to
the `swe` or `fe` agent.

It's the planning sibling of `swe`/`fe`: same graphify-powered analysis and approval gate, but
it **plans instead of building** — it never writes product code or touches git.

## Command
- **`/pm:plan <request>`** — analyze → propose (you approve) → write one task per stack to
  `.pm/tasks/<timestamp>-<slug>/` → report a clickable task list. (Runs on Sonnet 5;
  Fable 5 for very complex requests.)
- **`/pm:onboard`** — ensure the code graph exists and learn the project's stacks. (Sonnet 5.)

## The workflow
**investigate & analyze (graphify) → propose solution + task breakdown 🚦(you approve) →
write one self-contained task per stack → report.** One hard gate (the proposal); everything
else is autonomous.

## What a task contains
Each `.pm/tasks/<ts>-<slug>/<NN>-<stack>-<slug>.md` is a **short, simple brief** — four
sections: **Issue**, **Goal**, **Suggested solution**, and **Affected areas** (the
files/components and features it touches, cited from the graph) — plus frontmatter (`stack`,
`assignee`, `priority`, `depends_on`). The detailed technical plan and tests are the
implementing `swe`/`fe` agent's job, not the brief's.

## Hand-off to swe / fe
The platform renders each created task as a clickable chip → opens a modal with the task
rendered, a **Copy** button, and a **Create task** button that dispatches a job to the right
agent: **frontend-only → `fe`**, everything else → **`swe`**.

## Files it maintains in your project
- `.pm/tasks/<timestamp>-<slug>/` — one folder per request: `index.md` + one task `.md` per
  stack.
- `.pm/notes.md` — durable planning decisions & constraints, read before and updated after
  planning.
- `graphify-out/` — the code graph it analyzes with (generated/gitignored).

The pm agent only ever writes under `.pm/` (and the generated `graphify-out/`) — it plans;
the `swe`/`fe` agents build.
