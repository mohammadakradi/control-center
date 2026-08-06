---
description: Branch, commit, push, and open a PR for the current frontend changes (guard-railed). Always returns a PR link.
argument-hint: [optional PR title / context]
model: claude-sonnet-5
---

Ship the current changes. Optional title/context: **$ARGUMENTS**

Follow the frontend engineering rules at `${CLAUDE_PLUGIN_ROOT}/rules/frontend-rules.md`. This
is the **only** command permitted to write to git, and it must follow these guardrails.

## Guardrails (do not violate)
- **Never commit directly to the default branch** (`main`/`master`). If currently on it,
  create a feature branch first.
- Only commit, push, and open a PR when this command is explicitly invoked.
- Use the project's existing commit-message style (check `git log`).

## Steps

1. **Sanity check.** Confirm there are changes to ship (`git status`). Read `CLAUDE.md` to
   recall conventions. Confirm typecheck/lint/build/tests were run for this change — if not,
   run them now and stop if they fail (report the failure).
2. **Branch.** If on the default branch, create a descriptive feature branch.
3. **Commit.** If the `/fe:task` or `/fe:fix` workflow already committed these changes, skip
   this step. Otherwise stage the relevant changes and commit with a message matching the
   project style. End the commit message with:

   ```text
   Co-Authored-By: Claude <noreply@anthropic.com>
   ```
4. **Push** the branch to the remote (`git push -u origin <branch>`).
5. **Open (or find) the PR.** Run `gh pr create` with a clear title and a body summarizing
   what changed, what was reused vs. added, and how it was verified (incl. the responsive/
   a11y checks). End the PR body with:

   ```text
   🤖 Generated with [Claude Code](https://claude.com/claude-code)
   ```

   **Capture the PR URL** that `gh pr create` prints. If a PR for this branch already exists
   (so `gh pr create` errors), don't fail — fetch the existing URL instead:

   ```bash
   gh pr view --json url --jq .url
   ```
6. **Always return the PR link.** End your response with the PR URL on its own line, clearly
   labeled — this is the required final output of every successful ship:

   ```text
   PR: https://github.com/<owner>/<repo>/pull/<number>
   ```

## If a PR link can't be produced

A ship must still hand back a link. If `gh` is unavailable or no remote is configured, you
can't open the PR yourself — so:

- Confirm the branch is committed (and pushed, if a remote exists).
- Return the **GitHub compare link** the user can click to open the PR manually:
  `https://github.com/<owner>/<repo>/compare/<branch>?expand=1` (derive `<owner>/<repo>` from
  `git remote get-url origin`).
- If there's no remote at all, say so plainly and give the exact `git`/`gh` commands needed to
  finish — never end a ship without either a PR link or a precise next step.
