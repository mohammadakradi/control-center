# Security benchmark

A small corpus of planted vulnerabilities across difficulty tiers, used to measure the
`security-auditor`'s catch rate — including **subtle** classes the scanners miss.

## Corpus (`security-corpus/`)

| Case | Tier | Planted vuln (CWE) |
|------|------|--------------------|
| `easy-sqli`     | easy   | SQL injection (89) |
| `medium-ssrf`   | medium | SSRF (918) |
| `medium-xss`    | medium | Reflected XSS (79) |
| `subtle-idor`   | subtle | Broken object-level authz / IDOR (639) |
| `subtle-jwt`    | subtle | Missing signature verification (347) |
| `subtle-redos`  | subtle | ReDoS (1333) |
| `subtle-proto`  | subtle | Prototype pollution (1321) |
| `subtle-timing` | subtle | Non-constant-time secret compare (208) |

Each case has an `EXPECTED.md` answer key (auditors are instructed **not** to read it).

## How to run

Per case, dispatch the auditor and treat the whole case dir as the scope (no diff):

```text
/swe:security  (in the platform, pointed at a case dir)
```

or directly via the agent runtime:

```text
Agent(subagent_type: "swe:security-auditor",
      prompt: "Audit ALL source under <case dir>; ignore EXPECTED.md; run tools; return the verdict.")
```

Score each: did the verdict's BLOCKING findings name the planted class? See `RESULTS.md`.
