---
title: Runner lockdown + task ownership
stack: fullstack
assignee: swe
priority: P1
depends_on: [01-fullstack-auth-foundation.md]
---

# Runner lockdown + task ownership

## Issue
The browser talks to the runner daemon directly — `app/tasks/[id]/page.tsx:113` hands
`PUBLIC_RUNNER_URL` to the live view, and `runner/server.ts` has wide-open `cors()` and
zero auth on start/stream/respond/reply/stop/continue. Once the web app requires sign-in,
this side door would still let anyone stream task events and approve/reject gates.
Separately, tasks don't record who dispatched them, which task 02 needs to pick the right
token.

## Goal
Every runner interaction goes through an authenticated path; tasks record their owning
user; the runner is unreachable except via the Next.js app.

## Suggested solution
- Add `tasks.userId` (references `users`) set at creation in `app/api/tasks/route.ts`
  (POST) and surfaced in task reads; migrate existing rows as unowned (nullable).
  Projects/agents stay shared — this is a team control center; ownership scopes billing
  and attribution, not visibility.
- Proxy the runner behind session-checked Next.js route handlers: new
  `app/api/tasks/[id]/{stream,respond,reply,stop}` routes that forward to
  `RUNNER_URL` server-side (the SSE stream route pipes the runner's stream through —
  check Next 16 docs in `node_modules/next/dist/docs/` for streaming route handlers).
  Extend `lib/daemon-client.ts` where useful.
- Point the live task view at the new same-origin routes; drop `PUBLIC_RUNNER_URL` /
  `NEXT_PUBLIC_RUNNER_URL` from `lib/config.ts`. Keep the runner port unpublished /
  loopback-only in `infra/docker/docker-compose.yml`, and tighten or remove `cors()` in
  `runner/server.ts`.

## Affected areas
- `lib/db/schema.ts` — `tasks.userId` column
- `app/api/tasks/route.ts` — stamp owner on create
- `app/api/tasks/[id]/stream|respond|reply|stop` (new routes) — authenticated proxy to the runner
- `lib/daemon-client.ts`, `lib/config.ts` — proxy helpers; remove `PUBLIC_RUNNER_URL`
- `app/tasks/[id]/page.tsx` + its live-view client component — use same-origin endpoints
- `runner/server.ts`, `infra/docker/docker-compose.yml` — CORS/exposure tightening
- Feature: task live view (SSE), gate approve/reject, reply, stop — all now auth-gated
