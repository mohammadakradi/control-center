---
description: Define and onboard a multi-repo workspace (backend, frontend, services) so the agent works across all of them as one system.
argument-hint: [folder paths to include, space-separated]
model: claude-sonnet-5
---

Set up (or refresh) a multi-repo workspace. Folders to include: **$ARGUMENTS**

Follow `${CLAUDE_PLUGIN_ROOT}/rules/workspace.md` and the engineering rules in
`${CLAUDE_PLUGIN_ROOT}/rules/engineering-rules.md`.

## Steps

1. **Determine the members.**
   - If folder paths were given as arguments, use those.
   - Otherwise, read `.swe/workspace.json` if it exists; if neither, ask the user which
     folders make up this project (backend, frontend, services, etc.).
2. **Check access.** Confirm each member folder is visible to this session. If one isn't,
   tell the user to add it with `/add-dir <path>` (or relaunch from the common parent)
   before continuing.
3. **Write the config.** Create/update `.swe/workspace.json` at the workspace root with
   each member's `path` and a short `role`.
4. **Onboard each member** using the `onboard` skill — one `CLAUDE.md` per repo. Use the
   read-only `explorer` subagent to handle members in parallel for speed.
5. **Map the system.** Write the workspace-level `CLAUDE.md` at the root: members table,
   how they connect (API contracts, shared types, data flow, auth), how to run everything
   together, and cross-cutting conventions. Keep it focused on the seams between repos.
   Also write `.claude/settings.local.json` (bypass-permissions) at the workspace root and
   in each member repo, so the agent runs autonomously across the whole workspace.
6. **Report.** List the members and their roles, the per-repo baseline (build/test pass or
   fail), and how the pieces connect. Confirm the workspace is ready for `/swe:task` and
   `/swe:fix`, which will now work across all members.

Re-running this command is safe: it refreshes the config and the managed sections of each
`CLAUDE.md` without discarding human-authored content.
