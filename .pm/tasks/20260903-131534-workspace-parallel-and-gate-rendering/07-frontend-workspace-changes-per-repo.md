---
title: Show a workspace task's changes grouped per member repo
stack: frontend
assignee: fe
priority: P2
depends_on: [02-backend-workspace-task-changes.md]
---

# Show a workspace task's changes grouped per member repo

## Issue
On a workspace project the task page's Changes card is simply absent — and absent without a word
of explanation. `taskChangesView` (`lib/ui.ts:835`) maps `available === false` to
`{ kind: "hidden" }`, which is the right call for a non-git project but reads as "this task
changed nothing" on Award Maven, where in fact it may have changed files in three repos. Once task
02 reports changes per member repo, the card needs to render a list that spans repos rather than
one flat file list, and the diff modal needs to open the file from the right repo.

## Goal
A workspace task's Changes card shows every repo it touched, grouped and labelled by repo, with
the same states the single-repo card already has (exclusive worktree list, shared checkout note,
honest empty, removed worktree). Nothing is silently hidden.

## Suggested solution
Extend `taskChangesView` to fold the per-repo response task 02 returns into a grouped view model —
one group per repo carrying its label and its own scope — and keep the existing single-repo shape
working as a one-group case so the plain-git card is visually unchanged. Reuse the current
`ChangesList` rows inside a per-repo section header rather than inventing a second list style;
semantic tokens only. Pass the file's repo label through to `DiffModal` / the existing
`?task=<id>` diff call so the right member repo is resolved. Keep the "whose changes am I looking
at" honesty the card already has — that judgement is per repo now, since one member may be an
isolated worktree while another is a shared checkout. Reserve the hidden state for genuinely
nothing to say, and prefer a short explanatory empty state over silence when a repo can't be read.

## Affected areas
- `lib/ui.ts` — `taskChangesView` (`:832-842`) and its `TaskChangesView` / `TaskChangesResponse`
  types, with specs in `lib/ui.test.ts` (the branchiest part of the card lives here on purpose,
  since `pnpm test` can't reach `components/`)
- `components/` — the Changes card in `components/TaskLiveView.tsx`, plus `ChangesList` and
  `DiffModal` (which already take an optional `taskId`)
- `.fe/design-system.md` — record the grouped-per-repo changes pattern
- Features affected: the task page's Changes card and the diff modal, on workspace projects
