# Test scenarios

The verification half of the backlog: the manual scenarios the fe/swe agents write at their
report gate (rule 14) and the qa agent authors, scanned into rows so someone goes back to them.

## Why a second table instead of reusing `backlog_items`

They are the same *shape* of problem — files on disk own content, rows own state — and
deliberately not the same entity. A backlog item is work to **do**; a scenario is work to
**check**, and it has a state nothing in the backlog has: `passed`. Folding them together would
have meant a `kind` column and a status union where half the values are invalid for half the
rows. What they share is imported rather than copied: `lib/test-scenarios.ts` uses
`readSpecFile` from `lib/backlog.ts` for the hardened single-file read (O_NOFOLLOW, one hard
link, regular files only, bounded by the size `fstat` reported) — the scan reads folders an
agent writes into, on an unauthenticated GET, which is exactly what that function exists for.

## Where scenarios come from

`.qa/scenarios/`, `.fe/test-scenarios/`, `.swe/test-scenarios/`. `.qa/archive/` is never
walked, which is what stops a closed scenario coming back on the next load.

## Grouping — three tiers, all conservative

`matchFeature` is pure and specced. In precedence:

1. **The file said so.** A `feature:` front-matter key, matched against feature names. If it
   names a feature that doesn't exist, the scenario stays ungrouped and keeps the hint —
   `regroupOrphanedScenarios` resolves it for free once that feature is created. It deliberately
   does *not* fall through to guessing: an explicit statement that didn't resolve is not an
   invitation to infer something else.
2. **Containment at a dash boundary.** `checkout` matches `checkout-empty-cart`, never
   `checkout` inside `precheckouts`.
3. **A shared leading run of whole tokens** (≥2 tokens *and* ≥10 characters). This is the tier
   real data needs and the reason tier 2 alone wasn't enough: a feature derived from a
   `.pm/tasks/` request folder is named after the request, so it reads as a sentence —
   "Feature grouping, feature branches, and parallel runs from the backlog" — while the scenario
   beside it is `feature-grouping-ui.md`. Neither contains the other.

All three score the same way: characters of shared leading tokens. That single measure is what
makes a genuine tie look like one. Scoring a containment match by the *feature's* length instead
ranked two features that both merely start with `usage-` as different, and filed the scenario
under whichever had the longer name — caught by a spec, not by review.

A tie is null. A scenario filed under the wrong feature is worse than one filed under none, and
**most scenarios written before this existed stay ungrouped**, which is honest: on this repo, 1
of 53 grouped lexically. New ones written by `/qa:scenario` carry the front-matter key and
group exactly.

## Status, and who may move it

`open → passed | closed`. `statusOverride` is the same precedence the backlog uses: once a
person sets a status by hand, an automatic change stands down. A person can change their own
mind; a run cannot change it for them.

**`passed` is written in exactly one place** — `complete_test_scenario`
(`runner/test-scenario-tool.ts`), from counts the qa agent states — and deliberately never
inferred from the task reaching `done`. A QA run that walks ten steps and fails six is a
*successful run reporting a broken feature*; conflating the two would mark that feature
verified. The rule is `failed === 0 && passed > 0`: zero failures with zero steps is a run that
crashed before step one, not a pass.

## Archiving — the one place the platform writes into a project folder

Leaving `open` moves the markdown to `.qa/archive/<original path>`; reopening moves it back.
`moveScenarioFile` proves both ends are inside the realpath'd project root (not the spelling of
the path — `sourcePath` reaches it from a scan of a directory an agent controls), and refuses
anything that isn't a plain singly-linked regular file. `renameSync`, not copy-then-delete: a
scenario must never exist in both places or neither.

It returns an outcome instead of throwing. A file someone already deleted by hand must not
block the status change — the row is what the list renders, and a scenario that can't be closed
would be stuck open forever.

## Surfaces

- `app/(app)/projects/[id]/page.tsx` — the "Test scenarios" card, grouped with the same
  `FeatureGroup` heading the backlog and task lists use (it gained an optional `action` slot for
  "Close all"), so a feature reads as one thing across the page.
- `app/api/projects/[id]/test-scenarios/` — GET list, PATCH one, POST close-group. The GET
  re-scans on every load, exactly as the backlog's does, so there is no sync button to forget.
- `runner/test-scenario-tool.ts` — `list_test_scenarios` and `complete_test_scenario`, handed
  to every session alongside `add_backlog_item`.
