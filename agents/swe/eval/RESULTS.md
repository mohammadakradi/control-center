# Security benchmark — results

_Run: 2026-06-25 · auditor model: Sonnet 4.6 · tools: gitleaks 8.30.1, semgrep 1.167.0_

Sample: 6 of 8 cases (1 easy, 2 medium, **3 subtle**), run independently.

## Catch rate: **6 / 6 (100%)** — including **3/3 subtle**

| Case | Tier | Caught? | Notes |
|------|------|:------:|-------|
| `easy-sqli`    | easy   | ✅ | concrete injection payloads + parameterized-query fix |
| `medium-ssrf`  | medium | ✅ | flagged IMDS/`file://`/internal access; also caught content-type reflection (unplanted) |
| `medium-xss`   | medium | ✅ | the **only** case semgrep also flagged |
| `subtle-idor`  | subtle | ✅ | missing ownership check; gave the `if (invoice.userId !== req.user.id)` fix |
| `subtle-jwt`   | subtle | ✅ | `jwt.decode` vs `verify`; named the `alg:none` forge |
| `subtle-redos` | subtle | ✅ | nested-quantifier backtracking; linear-regex + length-cap fix |

## The honest headline: tools alone were weak; reasoning carried it

- **gitleaks:** clean on all (no secrets planted in this sample) — correct.
- **`semgrep --config auto` (unauthenticated, ~200 rules):** caught **1/6** (XSS only). It
  produced false negatives on SQLi, SSRF, IDOR, JWT, and ReDoS.
- The auditor **caught 6/6 anyway via adversarial reasoning**, and — importantly — each run
  **explicitly reported semgrep's miss** rather than treating "0 findings" as "safe."

**Takeaway:** the value is the *combination* — tools confirm/catch the mechanical cases,
the model reasons about the rest, and honesty about coverage gaps prevents false assurance.
The deeper semgrep rulesets (authenticated registry / custom taint rules) would raise the
tool contribution; with `--config auto` alone the tools are a backstop, not the engine.

## Caveats
- Small sample (6), planted single-vuln files — real PRs are noisier and multi-vuln.
- `subtle-proto` and `subtle-timing` not run in this sample (corpus has them for a fuller run).
- One run per case; no variance measurement.
