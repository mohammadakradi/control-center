# Run report format

Written to `.qa/runs/<slug>-<YYYYMMDD-HHMM>.md` at the end of every `/qa:test`. The headline
verdict goes **first** — someone reading this wants the answer, not the transcript.

````markdown
# QA run: <feature> — <PASS | FAIL | BLOCKED>

_<scenario path> · <base url> · <browser> <viewport> · <date time> · <duration>_

**<N> passed · <N> failed · <N> flaky · <N> blocked · <N> skipped**

<One sentence: does the feature work or not. If the run was blocked, say what blocked it and
stop — do not pad with per-step noise.>

## Steps

| # | Step | Verdict | Observed |
|---|------|---------|----------|
| 1 | Open /checkout | PASS | heading "Checkout" rendered, 3 line items |
| 2 | Click "Pay now" | FAIL | button present but `disabled`; no validation message |
| 3 | Confirmation shows order id | BLOCKED | unreachable after step 2 |

## Failures

### Step 2 — "Pay now" is disabled with no explanation
- **Expected:** clicking Pay now submits the order and navigates to /confirmation
- **Observed:** the button renders `disabled`; no field is marked invalid and no error text appears
- **Confirmed:** re-ran the step once — same result (not flaky)
- **Console:** `TypeError: Cannot read properties of undefined (reading 'total')` at cart.tsx:88
- **Network:** `GET /api/cart/totals` → 500
- **Screenshot:** `.qa/artifacts/<file>.png`
- **Filed:** `.qa/bugs/<NN>-checkout-pay-disabled.md`

## Observations
<Anything real but outside the scenario. Not a verdict — a note for whoever reads this.>

## Coverage
- **Spec written:** `.qa/specs/checkout.spec.ts` (steps 1) — re-run with `/qa:regress`
- **Not covered:** <what the scenario didn't exercise and a human should still look at>
````

Rules for the report:

- **Verdict in the title.** FAIL if any step failed. BLOCKED if the run couldn't complete.
- **The table is the whole run** — one row per scenario step, in order, no omissions.
- **Only failures get a section.** Passing steps are the table row and nothing more.
- **Every failure carries its evidence inline** — console, network, screenshot path, and
  whether a retry confirmed it. A failure without evidence is an opinion.
- **Say what you didn't test.** The Coverage section is what stops a green report being read as
  "the feature is fine" when the scenario only touched a third of it.
