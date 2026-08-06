# swe-agent

A portable **software-engineer agent** for Claude Code, packaged as a plugin. Install it
into any project; it onboards itself (writing a `CLAUDE.md`), then implements, fixes,
reviews, and ships changes under a fixed set of engineering rules.

## Commands

| Command        | Purpose |
|----------------|---------|
| `/swe:onboard` | Explore the repo, learn conventions, run a build/test baseline, write/refresh `CLAUDE.md`. Safe to re-run. |
| `/swe:workspace` | Define + onboard a **multi-repo workspace** (backend, frontend, services) so the agent works across all of them. |
| `/swe:plan`    | Decompose a large goal into a persistent **epic** (`.swe/epics/`) spanning many tasks/sessions. Plans only. |
| `/swe:task`    | Handle a feature/change request via the full workflow below. Auto-onboards if needed. |
| `/swe:fix`     | Handle a bug via the same workflow (investigate → plan → fix → review → report → commit). |
| `/swe:review`  | Read-only review of the current diff (correctness + conventions). |
| `/swe:security`| Run a tooled security audit (scanners + adversarial review) on the diff or whole project. |
| `/swe:ship`    | Push the committed branch and open a PR, guard-railed (never direct-to-default; opt-in only). |

> Plugin commands are namespaced by the plugin name (`swe`), so they're `/swe:<cmd>`.

## Request workflow

`/swe:task` and `/swe:fix` both run the agent's core loop, with **two gates where it stops
for you** (defined in `rules/workflow.md`):

```text
1. Investigate    codebase + notes + active epic + (if needed) the web
2. Plan       🚦  decompose into a checklist (+ flag security areas) → you approve
3. Build          execute task-by-task; a test + a security check per step; full suite
4. Review         TWO independent lenses, both blocking:
                    • reviewer        — correctness + test coverage
                    • security-auditor — runs real scanners (audit/secret/semgrep), diff model
5. Report     🚦  nutshell + a manual test scenario (.swe/test-scenarios/<slug>.md) → you approve
6. Commit         only after you approve → commit on a branch; update the epic (push/PR is /swe:ship)
```

A `PreToolUse` hook mechanically blocks any `git commit` on the default branch, so the
"feature-branch-only" rule is enforced, not just requested.

**Long-horizon work:** `/swe:plan <goal>` decomposes a large goal into a persistent epic
(`.swe/epics/<slug>.md`) that survives across tasks and sessions; `/swe:task` and `/swe:fix`
pick up the next epic task and check it off. **On-demand security:** `/swe:security` runs the
tooled audit by itself.

### Autonomous mode (no permission prompts)

The agent should ask **questions**, not for **permission**. So onboarding writes
`.claude/settings.local.json` into the project with:

```json
{ "permissions": { "defaultMode": "bypassPermissions" } }
```

After that, the agent runs all tools (edits, bash, etc.) in that project without
permission prompts — only the workflow's two gates (proposal / commit) stop it. The file
is personal and git-ignored, so it isn't imposed on teammates. Permission mode is read at
session start, so it takes effect from the **next** session in the project.

### Project memory (`.swe/notes.md`)

The model isn't fine-tuned by your usage, but the agent *does* accumulate project knowledge
by writing it down. Onboarding creates `.swe/notes.md` — a decision & gotcha journal the
agent **reads before every task** and **updates after every decision or change** (records
new gotchas, the rationale for choices, and corrects stale notes). So lessons like *"tests
need Postgres running"* or *"this API returns snake_case"* are learned once, not every time.
`CLAUDE.md` holds the stable project facts; `.swe/notes.md` holds the evolving lessons.

## Install (local)

From Claude Code, add this directory as a local marketplace, then install:

```text
/plugin marketplace add /Users/moh/Dev/agent/swe-agent
/plugin install swe
```

Then, in any project:

```text
/swe:onboard
/swe:task add pagination to the results endpoint
```

## Layout

```text
swe-agent/
  .claude-plugin/plugin.json        # manifest
  .claude-plugin/marketplace.json   # local install source
  rules/engineering-rules.md        # the agent's operating constitution (15 rules)
  rules/workflow.md                 # investigate→plan→build→review→report→commit
  rules/workspace.md                # multi-repo workspace spec
  rules/epics.md                    # persistent multi-task plans (long-horizon work)
  rules/security.md                 # tooled security procedure (scanners + triage)
  rules/claude-md-template.md       # structure onboarding writes into CLAUDE.md
  rules/test-scenario-template.md   # structure for the user-facing test scenarios
  skills/onboard/SKILL.md           # onboarding procedure (single repo or workspace)
  commands/                         # onboard, workspace, plan, task, fix, review, security, ship
  agents/explorer.md                # read-only codebase mapper (onboarding/large tasks)
  agents/reviewer.md                # independent lens 1: correctness + test coverage (Sonnet)
  agents/security-auditor.md        # independent lens 2: tooled security (Sonnet)
  hooks/hooks.json + guard-commit.mjs  # blocks git commit on the default branch
  scripts/ensure-tool.sh            # generic user-space CLI installer (bootstraps uv if needed)
  scripts/ensure-security-tools.sh  # idempotently installs gitleaks + semgrep
  scripts/ensure-graphify.sh        # installs graphify + builds the project code graph
  eval/security-corpus + RESULTS.md # planted-vuln benchmark (measured catch rate)
```

> Subagents run on **Sonnet 5** to keep token cost down. The `security-auditor` always
> runs the real scanners (auto-installed) — see `eval/RESULTS.md` for a measured catch rate
> (6/6 on the sample, incl. 3/3 subtle). "Done" also means **CI-parity green** (typecheck,
> lint, build, full suite) and no perf regression (rule 16).

## Multi-repo workspaces

A "project" can span several repos — backend, frontend, background services. Define which
folders are members and the agent onboards all of them and works across them as one system
(while different *workspaces* stay isolated from each other).

```text
# from a workspace root (a parent folder, or anywhere with the members /add-dir'd)
/swe:workspace ./backend ./frontend ./worker
```

This writes `.swe/workspace.json` (the member list), onboards each repo (its own
`CLAUDE.md`), and writes a workspace-level `CLAUDE.md` mapping how the repos connect (API
contracts, shared types, data flow, how to run them together). After that, `/swe:task` and
`/swe:fix` trace requests across all members, keep shared contracts in sync, and commit
**per repo** on matching branches. See `rules/workspace.md`.

> The session must be able to see every member folder. Launch from a common parent, or add
> scattered folders with `/add-dir <path>`.

## Isolation & running across projects

The plugin is installed **once, globally** (user scope) and is a stateless capability
layer — it holds no project data. Everything the agent *knows and changes* is confined to
the repo of the session it runs in, so projects never bleed into each other:

| Per-project, isolated     | Where it lives                                        |
|---------------------------|-------------------------------------------------------|
| Onboarded knowledge       | that repo's `CLAUDE.md`                                |
| Code changes              | that repo's working tree                              |
| Commits / branches / PRs  | that repo's git (`/swe:ship` always branches)         |
| Claude Code memory        | `~/.claude/projects/<project-hash>/` (per-project)    |

### Working on several projects in parallel

Open **one Claude Code session per project**, each launched from that project's directory.
Each session is scoped to its own folder, git repo, `CLAUDE.md`, and memory namespace —
they run fully independently.

```text
# terminal tab / IDE window 1
cd ~/Dev/project-a && claude
> /swe:onboard
> /swe:task add rate limiting to login

# terminal tab / IDE window 2 (simultaneously)
cd ~/Dev/project-b && claude
> /swe:onboard
> /swe:fix null pointer on empty cart
```

There is no shared mutable state between these sessions, so concurrent work on different
projects is safe by construction. (Running *two tasks inside the same repo* at once is the
only case that needs extra care — use a separate git worktree per task so they don't share
one working tree.)

## Design notes

- **Rules travel with the repo.** Claude Code can't auto-inject plugin rules into every
  session, so onboarding bakes a condensed copy of the engineering rules into each
  project's `CLAUDE.md` (which *is* auto-loaded).
- **Git is opt-in.** Only `/swe:ship` writes to git, and it never commits directly
  to the default branch.
- **Onboarding is idempotent.** Re-running updates the managed block in `CLAUDE.md`
  without discarding human-authored content.
