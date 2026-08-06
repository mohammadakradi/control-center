---
description: Prepare the pm agent to plan in this project — ensure the graphify code graph exists, learn the stack/structure, and initialize the .pm/ planning journal.
model: claude-sonnet-5
---

Onboard yourself to this project for planning. You **do not write product code or touch git** —
this just sets up what you need to plan well.

Steps:

1. **Read context.** Read `CLAUDE.md` (stack, conventions, architecture) if it exists. Note
   the stacks present (backend/frontend/services/devops/data) and how they're laid out.
2. **Ensure the code graph.** Run
   `bash ${CLAUDE_PLUGIN_ROOT}/scripts/ensure-graphify.sh .` to install graphify (if missing)
   and build/refresh `graphify-out/graph.json`. It is fail-soft. Skim
   `graphify-out/GRAPH_REPORT.md` for the high-level map.
3. **Initialize the planning journal.** If `.pm/notes.md` doesn't exist, create it:

   ```markdown
   # Project Planning Notes

   Durable planning context kept by the pm-agent: product decisions and rationale,
   constraints, and recurring stack conventions. Read before planning; update after each
   planning decision. Keep entries short and accurate.

   ## Decisions
   <!-- YYYY-MM-DD — what was decided — why -->

   ## Constraints & conventions
   <!-- stacks present, who owns what, non-obvious rules to respect when planning -->
   ```

   Seed it with the stacks you found and anything notable.
4. **Report** the detected stacks, whether the code graph is available, and confirm the
   project is ready for `/pm:plan`.
