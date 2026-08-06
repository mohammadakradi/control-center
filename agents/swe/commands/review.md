---
description: Review the current working diff for correctness and convention adherence (read-only).
argument-hint: [optional focus area]
model: claude-sonnet-5
---

Review the current changes. Optional focus: **$ARGUMENTS**

Follow the engineering rules at `${CLAUDE_PLUGIN_ROOT}/rules/engineering-rules.md`. This
command is **read-only** — report findings, do not modify code.

## Steps

1. **Ground yourself.** Read this project's `CLAUDE.md` for the project's conventions.
2. **Get the diff.** Use `git diff` (and `git diff --staged`) to see uncommitted changes.
   If the repo is clean, review the most recent commit instead and say so.
3. **Review** for:
   - **Correctness** — logic errors, edge cases, error handling, race conditions.
   - **Tests** — is the changed behavior covered? Are there obvious gaps?
   - **Conventions** — does it match the project's style, naming, and patterns?
   - **Scope** — any unrelated changes that don't belong in this diff?
4. **Report** findings grouped by severity (blocking / should-fix / nit). For each, give
   the `file:line`, what's wrong, and a concrete suggested fix. If it looks good, say so
   plainly.
