---
description: Review the current working diff for design-system fidelity, reuse/duplication, accessibility, responsiveness, and UI correctness (read-only).
argument-hint: [optional focus area]
model: claude-sonnet-5
---

Review the current frontend changes. Optional focus: **$ARGUMENTS**

Follow the frontend engineering rules at `${CLAUDE_PLUGIN_ROOT}/rules/frontend-rules.md` and
read `.fe/design-system.md` for the project's tokens and reuse catalog. This command is
**read-only** — report findings, do not modify code.

## Steps

1. **Ground yourself.** Read `CLAUDE.md` and `.fe/design-system.md` for conventions and tokens.
2. **Get the diff.** Use `git diff` (and `git diff --staged`) to see uncommitted changes. If
   the repo is clean, review the most recent commit instead and say so.
3. **Review** for:
   - **Design-system fidelity** — colors/spacing/typography come from tokens, not hardcoded
     values; matches the existing visual language; dark mode handled.
   - **Reuse / duplication** — does this reuse existing components, or duplicate one that
     already exists in the catalog?
   - **Accessibility** — semantic HTML, labels, keyboard operability, visible focus, contrast,
     reduced-motion; no color-only signaling.
   - **Responsiveness** — works across breakpoints; no fixed widths breaking small screens.
   - **UI correctness & scope** — state/render correctness, loading/empty/error states, and
     any unrelated changes that don't belong in this diff.
4. **Report** findings grouped by severity (blocking / should-fix / nit). For each, give the
   `file:line`, what's wrong, and a concrete fix (name the token/component to use). If it
   looks good, say so plainly.
