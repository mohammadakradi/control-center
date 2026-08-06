# Task Template

Each implementation task the `pm` agent creates is written to
`.pm/tasks/<timestamp>-<slug>/<NN>-<stack>-<slug>.md` using this structure.

**Keep it short.** A task is a brief, not a spec — four small sections. State the problem,
the outcome, a suggested approach, and where it lands. The `swe`/`fe` agent that picks the
task up does its own deep investigation, detailed technical plan, tests, and edge-case work —
so do **not** write acceptance-criteria checklists, line-by-line steps, interface/contract
dumps, out-of-scope lists, or testing notes. Be concrete but concise; skimmable in ~30 seconds.

---

```markdown
---
title: <concise, action-oriented task title>
stack: backend | frontend | services | devops | data | fullstack
assignee: swe | fe          # fe only when the task is frontend-only; otherwise swe
priority: P1 | P2 | P3
depends_on: [<NN-other-task-file.md>, ...]   # [] if none
---

# <Title>

## Issue
<The problem or need, in this project's context — 1–3 sentences. What's the current
behavior/gap and why it matters.>

## Goal
<The outcome we want once this is done — 1–2 sentences. What "good" looks like.>

## Suggested solution
<The approach at a glance — a short paragraph or a few bullets. The intended shape, not a
step-by-step. The implementing agent may refine it.>

## Affected areas
<Where the work happens — the files/components/services and the features/flows it touches.
Cite real paths/symbols from the graphify graph.>
- <path or component> — <what changes / role>
- <feature or flow affected>
```

---

Guidelines:
- **One stack per task** (rule 4). If you're tempted to write "and also update the frontend",
  that's a separate task — split it and link via `depends_on`.
- **Assignee** (rule 6): `fe` for frontend-only work; `swe` for everything else.
- When several tasks touch a shared thing (an endpoint, field, or feature), **name it the same
  way** in each so the pieces line up — but keep it to the "Affected areas" list; don't expand
  into a full contract spec.
- Short and simple beats exhaustive. If a section would repeat another, cut it.
