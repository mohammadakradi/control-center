---
description: Onboard the fe agent to this project — scan the framework, styling system, design tokens/colors/components, write CLAUDE.md + .fe/design-system.md, and establish a build/run baseline.
model: claude-sonnet-5
---

Onboard yourself to this frontend project by following the `onboard` skill in this plugin.

Read `${CLAUDE_PLUGIN_ROOT}/rules/frontend-rules.md`,
`${CLAUDE_PLUGIN_ROOT}/rules/claude-md-template.md`, and
`${CLAUDE_PLUGIN_ROOT}/rules/design-system-template.md`, then execute the onboarding
procedure: detect the framework + styling system + component library, inventory the design
tokens (colors, typography, spacing, radii) and reusable components into
`.fe/design-system.md`, map the UI, learn conventions, run a build/run/test baseline, and
write or update `CLAUDE.md`.

This command is safe to re-run; it refreshes the managed sections of `CLAUDE.md` and the
inventory in `.fe/design-system.md` without discarding anything the team wrote.

Finish with a short summary: framework, styling system, where tokens live, build/run/test
commands, and baseline status.
