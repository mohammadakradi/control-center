# The Request Workflow

How the `fe` agent handles any incoming frontend request (a new component, a page redesign,
a restyle, a UI bug). This is the agent's main loop. It has **two gates where you must stop
and wait for the user** — never skip them. Always follow the frontend engineering rules
(`frontend-rules.md`) throughout.

Before starting, make sure the project is onboarded (a `CLAUDE.md` and `.fe/design-system.md`
exist). If not, run the `onboard` skill first.

**Epics:** if a `.fe/epics/` plan exists that this request belongs to, read it first
(authoritative context) and pick up the next task per `${CLAUDE_PLUGIN_ROOT}/rules/epics.md`;
after committing, check off the task and update the epic's log. Large goals (full redesigns,
design-system migrations) are decomposed into an epic up front via `/fe:plan`.

---

## Phase 1 — Investigate
Understand the request before planning anything.

- **Read `.fe/design-system.md` and the `.fe/notes.md` index first** — the canonical
  token/component inventory and the decision journal. They tell you which colors, spacing,
  typography, and reusable components already exist so you don't reinvent or drift. The
  journal is an **index** (rule 10): read it, then open only the `.fe/notes/<topic>.md` files
  this request touches, or `grep -ril '<term>' .fe/notes/` to find one by keyword. Don't read
  the whole journal — it is the largest avoidable cost in a run. `CLAUDE.md` is already in
  your context; never read it.
- **Query the code graph first** (rule 17): if `graphify-out/graph.json` exists, use
  `graphify query/explain/path/affected` to locate components and understand relationships
  (who imports what, where a token/style is used) before reading or grepping broadly — it's
  much cheaper. `graphify affected "<component>"` scopes the blast radius before a restyle.
- **In the codebase:** find the components, styles, and routes the request touches; identify
  the existing patterns and the nearest similar component to model after. For a large/
  unfamiliar UI (or when the graph is missing/insufficient), use the read-only `ui-explorer`
  subagent to map the component tree, styling approach, and design tokens instead of reading
  everything inline.
- **Reuse survey (required for UI work):** explicitly list which existing components/tokens
  you can reuse or extend. Only plan new ones when nothing fits — and note why. Watch for
  **repeated raw patterns** (the same bare `<select>`/`<input>`/markup in several places) that
  signal a missing shared base component worth proposing (rule 3).
- **On the internet (only if needed):** if the request depends on a library/API/standard
  (a charting lib, an ARIA pattern, a CSS feature) you're unsure about, verify current usage.
- Identify the affected views, the breakpoints involved, dark-mode implications, and any open
  design questions.

## Phase 2 — Plan & decompose  🚦 GATE 1 (proposal)
**Every request gets a plan — no matter how small.** Break the work into a **checklist of
small, ordered steps**, each independently verifiable. Then present a short proposal:

- **Goal** in one line (what the user will see change).
- **Checklist** — the decomposed steps, each a single logical change (incl. the test/visual
  check for each, and a final review step).
- **Reuse & tokens** — which existing components/tokens you'll reuse or extend, and any **new**
  component/token you must introduce (with justification). Call out anything that would add a
  color or value outside the current palette. If a repeated raw pattern warrants it, propose
  **extracting a shared base component** (where it lives, its props/variants, the call sites it
  replaces). New styling defaults to **Tailwind + Lucide** when the choice is open, but matches
  the project's existing system if it has one (rules 3 & 4b).
- **Design/UX & accessibility notes** — the standard/pattern you'll follow, responsive
  behavior, and a11y considerations.
- **Approach / trade-offs / assumptions**, and any question you need answered.

Present this, then **STOP and wait for the user.**
- If the user confirms → **record the decision** in `.fe/notes.md`, then go to Phase 3.
- If the user wants changes → revise and present again. Do not start building until they
  confirm.

## Phase 3 — Build (execute the checklist task-by-task)
Work the checklist **one item at a time**, not all at once. For each item:

1. **Implement** that step — small, focused diff; match the project's component and styling
   conventions; **reuse existing components and tokens** (rules 3 & 4). No hardcoded colors/
   spacing/type that a token already expresses.
2. **Verify the step:** add or update a test where the project supports it (component/
   interaction/snapshot), and **check it renders** — exercise the changed view at the
   relevant breakpoints (and dark mode if present). Where you can't see pixels, state what
   you verified structurally instead.
3. **Consistency self-check:** confirm the step didn't introduce drift — colors/spacing/type
   come from tokens, no duplicate component was created, semantics/labels/focus are intact.
4. **Mark the item done** and move on. Keep a visible running checklist as you go.

After the last item, run the **CI-parity gate**: the project's full checks — typecheck, lint
(including any a11y lint plugin), build, and the **entire** test suite — the same gates CI
would run. For performance-relevant changes, check bundle-size/render impact or reason about
it and flag risk. If anything fails, fix and re-run. Then **update `.fe/notes.md`** with new
gotchas/decisions and **update `.fe/design-system.md`** if you added or changed any token or
shared component.

## Phase 4 — Independent review (blocking, scaled to the diff)
Before reporting, get independent lenses that are not you. There are two:

- **`design-reviewer` subagent** — adversarial review of **design-system fidelity, reuse/
  duplication, accessibility, responsiveness, and UI correctness**. Hardcoded values bypassing
  the theme, a duplicated component, or an a11y regression are blocking.
- **`frontend-auditor` subagent** — adversarial review of **frontend security** (XSS, unsafe
  `dangerouslySetInnerHTML`/`v-html`, secrets shipped to the client), **correctness** of
  logic/state, and **performance** (bundle, render), running the actual tooling where present.

**Scale the review to the change, and decide from the actual diff** (`git diff --stat`), not
from how the request was worded. A subagent is a fresh context that re-loads the project's
docs from scratch, so an unconditional pair on a two-line change costs more than the change:

- **Both** — the default for any real UI change. Mandatory, whatever the size, when the diff
  renders user- or network-supplied content, touches `dangerouslySetInnerHTML`/`v-html`,
  auth/session or client-side secrets, file upload, or URL/redirect handling; introduces a new
  token, color, or shared component; adds or bumps a dependency. Also both once the diff
  exceeds ~150 changed lines or ~6 files.
- **`design-reviewer` alone** — a small, self-contained visual change (under ~150 lines) that
  renders no untrusted content and touches nothing on the list above. Say in your report that
  you skipped the audit lens and why.
- **Neither** — only when the diff changes no rendered behavior at all: comments, docs,
  formatting, a renamed local. Run the build and lint suites and say you skipped review.

When in doubt, dispatch both — a missed XSS costs far more than a subagent. Never skip a lens
on a change you are unsure about.

**Resolve every blocking finding** from whichever lenses ran (re-enter Phase 3 as needed),
then re-review until they return no blocking findings. Address or consciously note
non-blocking ones. You may not advance to the report gate while any blocking finding is open.
**Re-review the fix, not the whole diff again** — scope the follow-up to what you changed.

## Phase 5 — Report & test scenario  🚦 GATE 2 (report)
Two deliverables, then stop for approval:

1. **Result in a nutshell** — 2–4 plain-language sentences on what the user will see change
   (the views/flows affected, not the code). Mention which files were touched, which
   components/tokens were reused vs. added, and the test/review outcome (e.g. "reuses the
   existing `Button`/`Card`; no new colors; design-reviewer + auditor clean").
2. **Test scenario for the user.** Write a step-by-step manual test scenario to
   `.fe/test-scenarios/<short-slug>.md` using
   `${CLAUDE_PLUGIN_ROOT}/rules/test-scenario-template.md`. Include the views to open, the
   happy path, **responsive checks** (mobile + desktop), **dark mode** if applicable, and at
   least one **accessibility check** (keyboard nav / focus / contrast). **Link the file** in
   your report.

3. **Anything you found and are not fixing.** Out-of-scope findings (a component that should
   be extracted, a page still on raw palette shades, an a11y gap elsewhere) go into the
   project backlog via `add_backlog_item` — one item per piece of work — rather than living in
   this report, which is read once. If you found a problem you *couldn't scope* — the right
   direction is a product decision, or fixing it properly reaches past the UI — file it with
   `assignee: "pm"` and say you've recommended pm investigate and break it down. List what
   you filed; see rule 9 of the frontend rules.

Present the nutshell + the link, then **STOP and wait for the user.** If they want changes,
return to the relevant phase.

## Phase 6 — Commit
Only **after the user approves**, commit:

- If on the default branch (`main`/`master`), create a feature branch first — never commit
  directly to the default branch. (A safety hook also blocks this mechanically.)
- Use the project's existing commit-message style. Include the test-scenario file and any
  `.fe/design-system.md` update in the commit.
- If this task belongs to an epic, **update `.fe/epics/<slug>.md`**: check off the task,
  append to the Log (branch + test-scenario link), and mark the epic `done` if complete.

Pushing and opening a PR are **not** part of this workflow — those happen only via the
explicit `/fe:ship` command.
