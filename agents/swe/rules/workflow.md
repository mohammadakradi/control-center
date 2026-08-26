# The Request Workflow

How the SWE agent handles any incoming request (a feature, a change, a fix). This is the
agent's main loop. It has **two gates where you must stop and wait for the user** — never
skip them. Always follow the engineering rules (`engineering-rules.md`) throughout.

Before starting, make sure the project is onboarded (a `CLAUDE.md` exists). If not, run the
`onboard` skill first.

**Multi-repo workspaces:** if a `.swe/workspace.json` exists, this is a workspace spanning
several repos — read it and the workspace `CLAUDE.md`, and apply the multi-repo adjustments
in `${CLAUDE_PLUGIN_ROOT}/rules/workspace.md` at each phase (investigate across all members,
list affected members in the plan, keep shared contracts in sync, commit per repo).

**Epics:** if a `.swe/epics/` plan exists that this request belongs to, read it first
(authoritative context) and pick up the next task per `${CLAUDE_PLUGIN_ROOT}/rules/epics.md`;
after committing, check off the task and update the epic's log. Large goals are decomposed
into an epic up front via `/swe:plan`.

---

## Phase 1 — Investigate
Understand the request before planning anything.

- **Read the `.swe/notes.md` index first** — the project's decision & gotcha journal. It
  tells you about settled decisions, environment quirks, and traps so you don't re-learn
  them. It is an **index** (rule 10): read it, then open only the `.swe/notes/<topic>.md`
  files this request actually touches, or `grep -ril '<term>' .swe/notes/` to find a note by
  keyword. Don't read the whole journal — it is the largest avoidable cost in a run. (If it
  doesn't exist yet, onboarding should have created it; create it if missing.)
- **Query the code graph first** (rule 17): if `graphify-out/graph.json` exists, use
  `graphify query/explain/path/affected` to locate the code and understand its relationships
  before reading or grepping broadly — it's much cheaper. Use `graphify affected "<thing>"`
  to scope the blast radius of the change.
- **In the codebase:** find the code the request touches — relevant files, existing
  patterns, where similar things are already done. For a large/unfamiliar repo (or when the
  graph is missing/insufficient), use the read-only `explorer` subagent to map it instead of
  reading everything inline.
- **On the internet (only if needed):** if the request depends on a library, API,
  standard, or tool you're not sure about, search the web to confirm current, correct
  usage. Don't guess at unfamiliar APIs — verify.
- Identify the affected area, constraints, edge cases, and any open questions.

## Phase 2 — Plan & decompose  🚦 GATE 1 (proposal)
**Every request gets a plan — no matter how small.** Break the work into a **checklist of
small, ordered steps**, each independently verifiable. Then present a short proposal:

- **Goal** in one line (behavior terms).
- **Checklist** — the decomposed steps, each a single logical change (incl. the test for
  each step, and a final review step).
- **Security-sensitive areas** this touches — auth, input handling, secrets, file/DB/network
  access, permissions, deserialization — or "none identified" with a word on why.
- **Approach / trade-offs / assumptions**, and any question you need answered.

Present this, then **STOP and wait for the user.**
- If the user confirms → **record the decision** in `.swe/notes.md`, then go to Phase 3.
- If the user wants changes → revise and present again. Do not start building until they
  confirm.

## Phase 3 — Build (execute the checklist task-by-task)
Work the checklist **one item at a time**, not all at once. For each item:

1. **Implement** that step — small, focused diff; match project conventions.
2. **Test (required):** add or update a test for the behavior this step changes, and run it.
   **No behavior change ships without a test.** If a step genuinely can't be tested, say so
   explicitly and why (this is the rare exception, not the default).
3. **Security self-check:** for any security-sensitive step, apply
   `${CLAUDE_PLUGIN_ROOT}/rules/security.md` — reason about the attack surface AND run the
   quick available tools (secret scan of the diff; dependency audit if you touched
   dependencies). Fix what you find. (The deeper, tooled audit happens in Phase 4.)
4. **Mark the item done** and move on. Keep a visible running checklist as you go.

After the last item, run the **CI-parity gate** (rule 16): the project's full checks —
typecheck, lint, build, and the **entire** test suite — the same gates CI would run, not
just the tests you touched. For performance-sensitive changes, run available benchmarks or
reason about complexity and flag any regression risk. If anything fails, fix and re-run.
Then **update `.swe/notes.md`** with new gotchas and the rationale for choices made here;
correct any note this change made stale.

## Phase 4 — Independent review (blocking, scaled to the diff)
Before reporting, get independent lenses that are not you. There are two:

- **`reviewer` subagent** — adversarial **correctness + test-coverage** review. A changed
  behavior with no real test is blocking.
- **`security-auditor` subagent** — adversarial **security** review that **runs the actual
  scanners** (dependency audit, secret scan, semgrep if present) per `rules/security.md`.
  Pinned to a different model so it doesn't share the author's blind spots.

**Scale the review to the change, and decide from the actual diff** (`git diff --stat`), not
from how the request was worded. A subagent is a fresh context that re-loads the project's
docs from scratch, so an unconditional pair on a two-line change costs more than the change:

- **Both** — the default for any real behavior change. Mandatory, whatever the size, when the
  diff touches auth, sessions, input handling, secrets/tokens, file/DB/network access,
  permissions, deserialization, crypto, or process spawning; adds or bumps a dependency; or
  changes a migration. Also both once the diff exceeds ~150 changed lines or ~6 files.
- **`reviewer` alone** — a small, self-contained behavior change (under ~150 lines, no file
  from the mandatory list above). Say in your report that you skipped the security lens and
  why.
- **Neither** — only when the diff changes no behavior at all: comments, docs, copy strings,
  formatting, a renamed local. Run the test and lint suites and say you skipped review.

When in doubt, dispatch both — the cost of a missed security finding dwarfs the cost of a
subagent. Never skip a lens to save time on a change you are unsure about.

**Resolve every blocking finding** from whichever lenses ran (re-enter Phase 3 as needed),
then re-review until they return no blocking findings. Address or consciously note
non-blocking ones. You may not advance to the report gate while any blocking finding is open.
**Re-review the fix, not the whole diff again** — dispatch the follow-up scoped to what you
changed in response.

## Phase 5 — Report & test scenario  🚦 GATE 2 (report)
Two deliverables, then stop for approval:

1. **Result in a nutshell** — 2–4 plain-language sentences on what changed from the user's
   point of view (the flows affected, not the code). Mention which files/repos were touched
   and the test/review outcome (e.g. "8 tests pass, reviewer clean").
2. **Test scenario for the user.** Write a step-by-step manual test scenario to
   `.swe/test-scenarios/<short-slug>.md` using
   `${CLAUDE_PLUGIN_ROOT}/rules/test-scenario-template.md`, so the user can follow it to
   exercise and get familiar with the new behavior. Include preconditions/setup, numbered
   steps with the expected result at each key step, and at least one edge/failure case.
   **Link the file in your report** (e.g. `Test scenario: .swe/test-scenarios/<slug>.md`).

3. **Anything you found and are not fixing.** Out-of-scope work goes into the project backlog
   via `add_backlog_item` (one item per piece of work) rather than living in this report,
   which is read once. If you found a problem you *couldn't scope* — a symptom, something
   spanning more of the system than you looked at, or a product decision — file it with
   `assignee: "pm"` and say you've recommended pm investigate and break it down. List what
   you filed in the report; see rule 9 of the engineering rules.

Present the nutshell + the link, then **STOP and wait for the user.** If they want changes,
return to the relevant phase.

## Phase 6 — Commit
Only **after the user approves**, commit:

- If on the default branch (`main`/`master`), create a feature branch first — never commit
  directly to the default branch. (A safety hook also blocks this mechanically.)
- Use the project's existing commit-message style. Include the test-scenario file in the
  commit.
- If this task belongs to an epic, **update `.swe/epics/<slug>.md`**: check off the task,
  append to the Log (branch + test-scenario link), and mark the epic `done` if complete.

Pushing and opening a PR are **not** part of this workflow — those happen only via the
explicit `/swe:ship` command.
