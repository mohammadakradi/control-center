---
name: onboard
description: Onboard the SWE agent to a project — detect the stack, map the codebase, learn conventions, establish a build/test baseline, and write or update CLAUDE.md. Use at the start of working in any repo, or when CLAUDE.md is missing or stale.
---

# Onboarding a project

Goal: produce (or refresh) a `CLAUDE.md` that lets any future task be done correctly, and
confirm the project builds/tests so later work has a known-good baseline.

First, read the engineering rules at `${CLAUDE_PLUGIN_ROOT}/rules/engineering-rules.md`
and the template at `${CLAUDE_PLUGIN_ROOT}/rules/claude-md-template.md`. Follow the rules;
write `CLAUDE.md` using the template.

## Single repo vs. workspace
Check for a `.swe/workspace.json` at the root first:
- **If it exists** (a multi-repo workspace), follow `${CLAUDE_PLUGIN_ROOT}/rules/workspace.md`:
  onboard **each member** with the procedure below (its own `CLAUDE.md`), then write the
  workspace-level `CLAUDE.md` mapping how the repos connect. Onboard members in parallel via
  the `explorer` subagent.
- **If it doesn't exist**, onboard this single repo with the procedure below. (To set up a
  multi-repo workspace instead, the user runs `/swe:workspace`.)

## Procedure (per repo)

### 1. Detect the stack
Look for manifest/config files to identify language, package manager, and frameworks:
`package.json`, `pnpm-lock.yaml`/`yarn.lock`/`package-lock.json`, `pyproject.toml`,
`requirements.txt`, `go.mod`, `Cargo.toml`, `pom.xml`, `build.gradle`, `Gemfile`, etc.
Note the framework(s) from dependencies.

### 2. Map the codebase
Identify top-level directories and their purpose, entry points, and where tests live.
For a large or unfamiliar repo, dispatch the read-only `explorer` subagent (in this
plugin) to fan out and return a structured map — don't read everything in the main
thread. For a small repo, just read the key files directly.

### 3. Learn the conventions
Inspect lint/format config (`.eslintrc`, `prettier`, `ruff`, `.editorconfig`,
`tsconfig.json`), CI config (`.github/workflows`, etc.), and recent commit messages
(`git log --oneline -20` if it's a git repo) to infer commit style and contribution norms.

### 4. Establish a baseline
Run the documented install/build/test/lint commands **once** to confirm they work and
record pass/fail. This is the reference point for "did my change break something?" later.
If a command is slow or needs credentials you don't have, note that instead of forcing it.

### 4b. Build the code graph (graphify)
Set up the project's **code knowledge graph** so future tasks can understand structure and
relationships by querying a graph instead of brute-force reading/grepping (far fewer tokens).
Run the idempotent installer/builder:

```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/ensure-graphify.sh" .
```

This installs the `graphify` CLI if missing — via `ensure-tool.sh`, which bootstraps `uv` when
the machine has no `pip`/`pipx`/`uv` at all — then builds `graphify-out/graph.json` (code-only
AST extraction, no API key needed), refreshes it on re-runs (no LLM), and adds `graphify-out/`
to `.gitignore`. It is **fail-soft**: if it can't install or build, it prints the reason and you
simply fall back to normal search. Note in your report whether the graph is available.

Afterwards, **query it with a PATH prefix** (`$HOME/.local/bin` isn't on PATH and an `export`
doesn't survive between Bash calls — see rule 18):

```bash
PATH="$PATH:$HOME/.local/bin" graphify query "…"
```

(Optional: setting a backend key like `GEMINI_API_KEY` and running `graphify extract .` once —
without `--code-only --no-cluster` — yields richer cross-file semantic edges plus doc/image
nodes; AST mode still captures files, symbols, methods, and imports.)

### 5. Write or update CLAUDE.md
- If none exists: create `CLAUDE.md` at the repo root from the template.
- If one exists: merge — update the `swe:begin/end` managed block, preserve
  everything the team wrote outside it. Don't clobber, don't duplicate.
Keep it concise and command-first.

### 6. Enable autonomous mode
So the agent runs without permission prompts in this project (only the workflow's
proposal/commit *questions* should stop it), write `.claude/settings.local.json` at the
repo root with bypass-permissions. Merge into the file if it already exists; don't discard
other keys:

```json
{
  "permissions": { "defaultMode": "bypassPermissions" }
}
```

This file is personal and git-ignored by Claude Code, so it isn't forced on teammates.
Note for the user: the permission mode is read at session start, so it takes effect in the
**next** session in this project (the current onboarding session may still prompt). In a
multi-repo workspace, write this into each member repo **and** the workspace root.

### 7. Initialize the decision & gotcha journal
If `.swe/notes.md` doesn't exist, create it as an empty journal the agent will read before
each task and update after each decision/change (see engineering rule 10):

```markdown
# Project Notes & Decisions

A running journal kept by the swe-agent: reusable lessons not obvious from the code —
environment gotchas, surprising behaviors, and the rationale behind decisions. Read before
acting; updated after each decision or change. Keep entries short and accurate.

## Decisions
<!-- YYYY-MM-DD — what was decided — why -->

## Gotchas
<!-- non-obvious facts: env setup, surprising behavior, traps to avoid -->
```

Seed it with anything notable you already learned during onboarding (e.g. "tests need a
running Postgres", "build only works on Node 24"). In a workspace, put `.swe/notes.md` at
the workspace root for system-level notes and one in each member repo for repo-specific
ones.

### 8. Report
Summarize for the user: detected stack, the build/test/run commands, baseline status
(pass/fail per command), and anything surprising. Mention that autonomous mode is enabled
for next session. End by confirming the project is ready for `/swe:task` and `/swe:fix`.

## Idempotency
Re-running onboarding must be safe: it refreshes the managed sections to match the current
state of the repo and never discards human-authored content.
