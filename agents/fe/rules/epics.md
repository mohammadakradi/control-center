# Epics — Persistent Multi-task Plans

A single request runs the workflow once. But real frontend goals — a full page redesign, a
design-system migration, a dark-mode rollout, an accessibility cleanup — span **many**
requests and often many sessions. An **epic** is a persistent plan that survives across them:
a checklist the agent reads at the start of related work and updates as tasks complete, so
long-horizon UI work has memory and direction instead of being re-planned from scratch.

Epics live at **`.fe/epics/<slug>.md`** and are committed with the work, so the plan is
shared and durable.

## Epic file format

```markdown
# Epic: <title>

_Status: active | done · created <date> · updated <date>_

## Goal
<1–3 sentences: the UI outcome this epic delivers.>

## Constraints & decisions
- <key design/technical decisions, scope boundaries, things ruled out — append as made>
- <e.g. "reuse existing primary palette; no new accent colors", "Tailwind tokens only">

## Milestones
- [ ] M1 — <milestone>
  - [ ] <task> · (branch / PR once worked)
  - [ ] <task>
- [ ] M2 — <milestone>
  - [ ] <task>

## Log
- <date> — <what was completed, what changed in the plan, links to PRs/scenarios>
```

## How epics interact with the workflow

- **Creating one:** `/fe:plan <goal>` investigates, decomposes the goal into milestones and
  tasks, and writes `.fe/epics/<slug>.md`. It does **not** build — it produces the plan and
  stops for approval (Gate 1 semantics).
- **Advancing one:** at the start of any `/fe:task` or `/fe:fix`, check `.fe/epics/` for an
  active epic this request belongs to. If it does:
  - Read it first (authoritative context alongside `.fe/notes.md` and `.fe/design-system.md`).
  - Pick up the next unchecked task (or the one named in the request).
  - The per-request plan (workflow Phase 2) is just *that task's* decomposition.
  - After the commit, **update the epic**: check off the completed task(s) (`[ ]`→`[x]`),
    append a dated bullet **under the existing `## Log` heading** (do not add a second `Log`
    heading), record any new decision, bump the `updated` date, and set `Status: done` when
    the goal is fully met.
- **Keep it honest:** the epic reflects reality. Don't check off a task that isn't actually
  done and reviewed; do add tasks you discover are necessary.

Epics are for genuinely multi-step work. A one-shot restyle doesn't need one — the normal
per-request plan is enough.
