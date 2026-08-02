---
title: Per-user Anthropic token vault + runner injection
stack: fullstack
assignee: swe
priority: P1
depends_on: [01-fullstack-auth-foundation.md, 03-fullstack-runner-lockdown.md]
---

# Per-user Anthropic token vault + runner injection

## Issue
All Claude sessions run on one shared credential: `CLAUDE_CODE_OAUTH_TOKEN` /
`ANTHROPIC_API_KEY` from the repo-root `.env` is inherited by every SDK `query()` in
`runner/session-manager.ts` and by the title/triage calls in `runner/model-router.ts`.
Users must instead each store their own token once and have their tasks bill their own
subscription — without the token ever being exposed, written to the DB, or shared.

## Goal
Each signed-in user saves their Anthropic token (OAuth token from `claude setup-token`, or
an API key) exactly once; every session the runner spawns for that user's task runs under
that token; no API response, DB row, log, or task event ever contains it.

## Suggested solution
- Encrypted secret store **outside the DB**: per-user file under `data/secrets/`
  (AES-256-GCM, file mode 0600), master key from a server-only env var (document in
  `.env.example`; refuse to accept tokens if the master key is unset). A `lib/secrets.ts`
  module owns encrypt/decrypt; the decrypted value never leaves the server process.
- Write-only settings API + a small settings page: set / replace / clear only. Reads
  return just `{ configured: true, kind: "oauth" | "api-key", last4 }` — never the token.
- Runner injection: when starting a task, resolve the owner's token (task owner comes from
  task 03's `tasks.userId`) and pass it via the SDK's `Options.env` at the `query()` call
  in `runner/session-manager.ts` (~L407). **Caveat verified in `sdk.d.ts:1364`:** `env`
  replaces `process.env` rather than merging — spread `process.env` but strip the global
  `CLAUDE_CODE_OAUTH_TOKEN`/`ANTHROPIC_API_KEY` first so the user token strictly wins.
  Apply the same env to `runner/model-router.ts` calls (`generateTitle`, triage).
- Fail the task with a clear error if the owner has no token configured; demote the global
  `.env` token to dev-only fallback (or remove), so users can never silently share one
  identity. Note: the bind-mounted `~/.claude` may carry ambient credentials — injected
  env must take precedence.

## Affected areas
- `lib/secrets.ts` (new) — encrypted per-user token store under `data/secrets/`
- `app/api/settings/token/` (new) — write-only set/replace/clear + configured-status route
- `app/settings/` (new page) — token entry (masked), status, replace/clear
- `runner/session-manager.ts` — per-task `Options.env` injection at the `query()` call
- `runner/model-router.ts` — same token for title/triage side calls
- `.env.example`, `infra/docker/docker-compose.yml` — master-key env var; global token demoted
- Feature: task dispatch/continue flow — now runs on the dispatching user's subscription
