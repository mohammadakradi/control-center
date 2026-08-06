# Tooled Security Procedure

Security is **verified with tools, not just reasoned about.** For every change, run the
scanners that exist for the project's ecosystem, plus a secret scan, then triage the
findings. Reasoning about bug classes still matters — but it supplements the tools, it
doesn't replace them.

## 0. Guarantee the tools are present
First run `bash ${CLAUDE_PLUGIN_ROOT}/scripts/ensure-security-tools.sh` — it idempotently
installs **gitleaks** and **semgrep** to user space (no-op if already present) and prints
which are now available. It bootstraps `uv` if the machine has no Python package manager, so
semgrep installs even on a slim container that has `python3` but no `pip`.

**Then invoke the scanners with a PATH prefix on every call:**
```bash
PATH="$PATH:$HOME/.local/bin" semgrep --config auto .
PATH="$PATH:$HOME/.local/bin" gitleaks detect --no-banner
```
The tools live in `$HOME/.local/bin`, which is **not** on the runtime PATH. Every Bash call is
a fresh shell and no shell profile is sourced, so `export PATH=…` in one call does **not**
carry over to the next — a bare `semgrep …` will fail with "command not found" even though it
is installed. Only if the script reports a tool still `false` (install genuinely failed) do you
fall back to manual review for that tool — and say so in the report.

## 1. Detect the ecosystem & available tools
Look at the repo, then check which scanners are actually installed (don't assume). Probe
with `--version` / `which` before relying on one.

| Ecosystem | Dependency / vuln scan | Notes |
|-----------|------------------------|-------|
| Node (`package.json`) | `npm audit --omit=dev` / `pnpm audit` / `yarn npm audit` | use the project's package manager |
| Python (`pyproject.toml`/`requirements.txt`) | `pip-audit` or `safety check` | |
| Go (`go.mod`) | `govulncheck ./...` | |
| Rust (`Cargo.toml`) | `cargo audit` | |
| Ruby (`Gemfile`) | `bundle audit` | |
| Any | `semgrep --config auto` | if installed — strong static analysis |
| Any | `gitleaks detect` / `trufflehog` | secret scanning |

## 2. Always run (cheap, ecosystem-agnostic)
- **Secret scan** of the diff: look for committed credentials, API keys, tokens, private
  keys, `.env` values. Use `gitleaks`/`trufflehog` if present; otherwise grep the diff for
  high-entropy strings and obvious key patterns (`AKIA`, `-----BEGIN * PRIVATE KEY-----`,
  `xox[baprs]-`, `ghp_`, `sk-`, etc.).
- **Dependency scan** for the detected ecosystem (table above), if a manifest changed or a
  dependency was added/updated.

## 3. Reason about the diff's attack surface
For code that handles input, auth, secrets, files, DB, network, or permissions, check the
classes the tools won't always catch: injection (SQL/command/XSS), broken authn/authz,
secret leakage, unsafe deserialization, path traversal, SSRF, missing/incorrect input
validation, insecure defaults, and missing rate-limiting on sensitive endpoints. Assume
hostile input.

## 4. Triage & report
For each finding, record: severity (critical/high/medium/low), where (`file:line` or the
package), why it's exploitable, and the fix.

- **Blocking:** any **critical/high** dependency vuln *introduced or reachable by this
  change*, any leaked secret, and any plausible code vulnerability in the diff.
- **Non-blocking:** pre-existing low/medium issues unrelated to this change — note them, do
  not silently fix or expand scope.

If no scanner is installed for the ecosystem, say so explicitly and fall back to manual
review — never report "secure" when you simply couldn't check.
