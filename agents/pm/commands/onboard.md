---
description: Prepare the pm agent to plan in this project — ensure the graphify code graph exists, learn the stack/structure, and initialize the .pm/ planning journal.
model: claude-sonnet-5
---

Onboard yourself to this project for planning. You **do not write product code or touch git** —
this just sets up what you need to plan well.

Steps:

1. **Read context.** `CLAUDE.md` (stack, conventions, architecture) is already in your context
   if it exists — don't read it back. Note
   the stacks present (backend/frontend/services/devops/data) and how they're laid out.
2. **Ensure the code graph.** Dispatched from the Control Center app, the platform already
   built it before your session started (`🕸️ Building the code graph…` at the top of the run),
   so check before spending minutes refreshing a large repo:
   `ls graphify-out/graph.json 2>/dev/null || bash ${CLAUDE_PLUGIN_ROOT}/scripts/ensure-graphify.sh .`
   — that installs graphify (if missing) and builds `graphify-out/graph.json`. Fail-soft either
   way. Skim `graphify-out/GRAPH_REPORT.md` for the high-level map.
3. **Initialize the planning journal.** If `.pm/notes.md` doesn't exist, create it as an
   **index** (pm rule 9) — the notes themselves live in `.pm/notes/<topic>.md`, and the index
   stays under 8 KB:

   ```markdown
   # Project Planning Notes — index

   Durable planning context kept by the pm-agent: product decisions and rationale,
   constraints, and recurring stack conventions.

   Notes live in `.pm/notes/<topic>.md`. Read this index, then open only the topics your
   request touches — or `grep -ril '<term>' .pm/notes/`. Never read the whole journal.

   | Topic | Covers |
   |---|---|
   | [decisions](notes/decisions.md) | product decisions and why, newest first |
   | [constraints](notes/constraints.md) | stacks present, ownership, rules to respect |
   ```

   Create `.pm/notes/decisions.md` and `.pm/notes/constraints.md` alongside it and seed them
   with the stacks you found and anything notable. Each topic file's budget is 30 KB.
4. **Report** the detected stacks, whether the code graph is available, and confirm the
   project is ready for `/pm:plan`.
