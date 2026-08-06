---
description: Run a tooled security audit — dependency/vuln scanners, secret scan, and an adversarial review — on the working diff or the whole project. Read-only; reports findings.
argument-hint: [optional focus, e.g. "auth flow" or "whole project"]
model: claude-sonnet-5
---

Run a security audit. Focus: **$ARGUMENTS**

Follow `${CLAUDE_PLUGIN_ROOT}/rules/security.md`. This command is **read-only** — it reports
findings and does not change code (fixes go through `/swe:task` or `/swe:fix`).

## Steps

1. **Scope.** Default to the uncommitted working diff. If the user asked for the whole
   project (or there's no diff), audit the project's attack surface broadly.
2. **Dispatch the `security-auditor` subagent** on that scope. It runs the installed
   scanners (dependency audit, secret scan, `semgrep` if present), attacks the logic, and
   returns a triaged verdict.
3. **Report** the findings grouped by severity (critical/high/medium/low) with `file:line`
   or package, why each is exploitable, and the fix. Call out explicitly what could **not**
   be checked (missing tools) — never imply "secure" for something unverified.
4. If the user wants the issues fixed, hand off to `/swe:task` / `/swe:fix` (one finding or
   group at a time) rather than fixing inline here.
