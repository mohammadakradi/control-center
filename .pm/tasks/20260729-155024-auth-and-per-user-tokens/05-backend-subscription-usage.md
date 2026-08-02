---
title: Subscription usage & limits endpoint
stack: backend
assignee: swe
priority: P3
depends_on: [02-fullstack-user-token-vault.md]
---

# Subscription usage & limits endpoint

## Issue
Users on a Claude subscription can't see how much of their plan a task run consumed or how
close they are to their rate limits. The installed Agent SDK exposes this — an
experimental control API (`usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET()`,
`sdk.d.ts:2322`) returns session cost/token totals plus claude.ai plan rate-limit
utilization windows (5-hour, 7-day, per-model) — but nothing in the platform calls it.

## Goal
A signed-in user can fetch their current subscription usage and remaining limits; when the
data isn't available (API-key auth, missing scope, SDK shape change), the endpoint says so
cleanly instead of erroring.

## Suggested solution
- Best-effort by design: the SDK API is explicitly experimental and returns
  `rate_limits_available: false` / `rate_limits: null` for API keys, Bedrock/Vertex, or a
  missing profile scope — treat "unavailable" as a first-class response, and isolate the
  call so an SDK shape change degrades to "unavailable" rather than breaking anything.
- Runner-side collection, since the SDK session lives there: either query it on the live
  session during/after a task run and cache per user, or spin a minimal short-lived
  session under the user's token (from task 02's vault) on demand. Weigh cost/latency —
  piggybacking on real task sessions is likely cheaper than on-demand probes.
- Expose as an authenticated Next.js route (e.g. `app/api/usage/`) returning the current
  user's rate-limit windows + availability flag, for task 06 to render.

## Affected areas
- `runner/` (session-manager or a small new module) — call the SDK `get_usage` control API
  under the user's token; cache latest per user
- `runner/server.ts` — internal endpoint for the web app to fetch a user's usage snapshot
- `app/api/usage/` (new route) — authenticated per-user usage/limits, with `available` flag
- Feature: per-user subscription usage & remaining limits (consumed by task 06)
