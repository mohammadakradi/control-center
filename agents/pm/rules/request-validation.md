# Request Validation — master the request before solutioning

A senior PM's most valuable move is catching that **the request itself is wrong** before any
engineer touches code. The `pm` agent must do the same: before proposing a solution, **verify
the request against the actual codebase** and reach a verdict. Don't trust the request — test
it. Only after the request is validated do you (if warranted) design the best solution.

This runs in Phase 1, using graphify + reading code (and the `analyst` subagent for depth).
It is **evidence-based**: every claim cites real files/components/behavior from the graph or
the code — never an assumption.

## The four questions to answer

1. **Is the premise true?** Trace the *current* behavior the request describes. Does the code
   actually behave the way the request claims? Reproduce the reported problem in the code path
   (`graphify query/explain/path`, then read the implicated files). A bug report or "it does
   X" can simply be wrong.
2. **Does it already exist?** Search for the requested behavior — fully built, or built but
   **not enabled/applied/exposed** (behind a flag, a config, an unmounted route, an unused
   component, a feature shipped but not wired into this screen). Grep + graph for the
   capability, not just the words.
3. **Would it cause harm?** Use `graphify affected "<touch point>"` (blast radius) to see what
   depends on what the change touches. Would the request break an existing workflow, violate
   an invariant, regress another feature, or open a security/data-integrity hole?
4. **What's the real need?** Distinguish the literal ask from the underlying job-to-be-done.
   Often the best solution addresses the need, not the wording (and is smaller/safer).

## Verdicts

Reach exactly one (or `PARTIAL`, a labeled mix). Each carries evidence and a recommendation.

- **`BUILD`** — valid, not implemented, no blocking conflict → proceed to design a solution
  and break it into tasks (the normal path).
- **`ENABLE`** — the capability **already exists but isn't applied** → don't rebuild it; the
  real work is to wire/configure/expose it. Cite where it lives; the resulting task(s) are
  usually small (often a single `ENABLE` task).
- **`ALREADY-DONE`** — the requested behavior **already exists and works** → no tasks. Show
  exactly where (file:symbol) and how to confirm it; recommend the user verify and close. The
  report was likely mistaken.
- **`PREMISE-WRONG`** — the reported problem is **not reproducible** in the code / rests on a
  false assumption → no tasks. Show what you checked and what the code actually does; ask for
  a concrete repro or corrected premise.
- **`RISKY`** — implementing the request as asked would **break a workflow, regress a feature,
  or create a security/data risk** → surface the specific risk (what breaks, who depends on
  it), then either propose a **safer alternative** that meets the real need (which, if
  approved, becomes the tasks) or recommend against proceeding.
- **`PARTIAL`** — a mix (e.g. half already exists, one part is risky) → scope to the valid,
  safe part and flag the rest explicitly.

## Always record the assessment

Write the assessment into the request folder's `index.md` **even when there are no tasks**
(`ALREADY-DONE` / `PREMISE-WRONG` / recommend-against). It's the durable record of *why* —
the most valuable PM output is sometimes "don't build this, here's why."

```markdown
## Request assessment
- **Verdict:** <BUILD | ENABLE | ALREADY-DONE | PREMISE-WRONG | RISKY | PARTIAL>
- **What was asked:** <one line>
- **What the code actually does:** <evidence — file:symbol, current behavior>
- **Already implemented?** <no | fully at <path> | exists-but-not-applied at <path>>
- **Risks / conflicts:** <blast radius, invariants, security — or "none found">
- **Real need:** <the job-to-be-done behind the ask>
- **Recommendation:** <proceed / enable existing / already works — verify & close / fix premise / safer alternative / don't build>
```

## How it changes the gate

The proposal you present (Phase 2) **leads with this assessment**. Then:
- `BUILD`/`ENABLE`/`PARTIAL`/approved-`RISKY`-alternative → also present the solution + task
  breakdown, and proceed to write tasks after approval.
- `ALREADY-DONE`/`PREMISE-WRONG`/recommend-against → present the finding and the evidence, and
  **propose no tasks**. Stop for the user — they may accept (close it), correct you, or insist
  (then you build, having flagged the risk).

Be direct and non-deferential about a bad request — surfacing it early is the job. But base it
on evidence, and stay humble: if you couldn't fully verify, say so and ask rather than
asserting.
