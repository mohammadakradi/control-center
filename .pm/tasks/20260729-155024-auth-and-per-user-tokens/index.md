# Authentication & per-user Anthropic tokens

**Request (2026-07-29):** Add authentication (signup/signin) to the control center. Each
user stores their own Anthropic access token once and their tasks run on their own Claude
subscription — the token must never be exposed, written to the DB, or shared between users.
Show per-task token usage, and (if possible) each user's subscription usage / remaining
Claude limits.

**Assessment verdict: PARTIAL/BUILD.** No auth or per-user credential exists today — one
global `CLAUDE_CODE_OAUTH_TOKEN`/`ANTHROPIC_API_KEY` from `.env` is inherited by every SDK
session (`runner/session-manager.ts`, `runner/model-router.ts`). Per-task usage data
(`total_cost_usd`, `usage`, `modelUsage` on SDK `result` messages) is already persisted raw
in `taskEvents` but never extracted or displayed. Subscription limits are feasible via the
SDK's experimental `get_usage` control API (claude.ai plan 5h/7d rate-limit windows;
unavailable for API keys → degrade gracefully). Critical hole to close alongside auth: the
browser talks to the runner (:4319) directly with open CORS and no auth.

**Key security decisions (approved):** per-user token in an encrypted secret store outside
the DB (AES-256-GCM file under `data/secrets/`, 0600, master key from server env),
write-only API (never read back, masked UI), injected per task via SDK `Options.env`
(replaces — not merges — `process.env`, so spread carefully); global env token demoted so
users can't silently share one identity; runner endpoints proxied behind session-checked
Next.js routes.

## Tasks

| # | Task | Assignee | Depends on |
|---|------|----------|------------|
| 01 | [Auth foundation — users, signup/signin, session middleware](01-fullstack-auth-foundation.md) | swe | — |
| 02 | [Per-user Anthropic token vault + runner injection](02-fullstack-user-token-vault.md) | swe | 01, 03 |
| 03 | [Runner lockdown + task ownership](03-fullstack-runner-lockdown.md) | swe | 01 |
| 04 | [Per-task token usage capture](04-backend-task-usage-capture.md) | swe | — |
| 05 | [Subscription usage & limits endpoint](05-backend-subscription-usage.md) | swe | 02 |
| 06 | [Usage display in the UI](06-frontend-usage-display.md) | fe | 04, 05 |
