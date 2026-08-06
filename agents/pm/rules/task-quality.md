# Task Quality Self-Check

A quick, **blocking** pass the `pm` agent runs **after writing the task files and before
reporting** (workflow Phase 4). Tasks are lean briefs (see `task-template.md`), so this check
is light — it just makes sure each brief is clear, correctly scoped, and the set hangs
together. Re-read every task; if anything fails, **fix it and re-check** before reporting.

## Per-task checks (every `<NN>-<stack>-<slug>.md`)

- [ ] **Four sections, all present and short.** `## Issue`, `## Goal`, `## Suggested solution`,
  `## Affected areas` — each concise (no acceptance-criteria checklists, contract dumps,
  out-of-scope, or testing notes; those are the implementing agent's job).
- [ ] **Concrete where it counts.** Issue/goal are specific to this project, and **Affected
  areas** cites **real files/components/features** (from the graph) — not vague ("update the
  code"). If something's genuinely unknown, say so in one line rather than padding.
- [ ] **One stack, right assignee.** The task touches a single stack, and `assignee` is `fe`
  only if it's frontend-only, otherwise `swe`.

## Cross-task checks (the whole request folder)

- [ ] **Consistent naming of shared things.** When two tasks touch the same endpoint, field,
  component, or feature, they refer to it by the **same name** (e.g. both say
  `GET /layouts` + `archived`, not one using `is_archived`). Keep this to the Affected-areas
  lists — no full contract spec.
- [ ] **Coherent dependencies.** `depends_on` references real sibling files, ordering is
  sensible, and there are no cycles.
- [ ] **Complete coverage.** The tasks together deliver the approved solution — nothing
  orphaned, nothing depending on work no task covers.

## Report the result

In the Phase 5 report, state the outcome in one line, e.g.:

> Quality check: 3 lean tasks, one per stack, correctly assigned; the shared `archived` flag
> on `GET /layouts` is named consistently across the backend and frontend tasks.

If the check forced a revision, mention what you fixed. Never report tasks that failed a check.
