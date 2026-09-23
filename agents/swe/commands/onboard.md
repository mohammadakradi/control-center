---
description: Onboard the SWE agent to this project — write/refresh CLAUDE.md and establish a build/test baseline.
model: claude-sonnet-5
---

Onboard yourself to this project by following the `onboard` skill in this plugin.

Read `${CLAUDE_PLUGIN_ROOT}/rules/engineering-rules.md` and
`${CLAUDE_PLUGIN_ROOT}/rules/claude-md-template.md`, then execute the onboarding
procedure: detect the stack, map the codebase, learn conventions, run a build/test
baseline, write or update `CLAUDE.md`, and bring `CLAUDE.md` and `.swe/notes/` within
budget (step 5b).

This command is safe to re-run. It updates the managed sections of `CLAUDE.md` without
discarding anything the team wrote. Over-budget content gets moved into `.swe/notes/`, not
deleted.

Finish with a short summary: stack, build/test/run commands, baseline status, and document
sizes before → after.
