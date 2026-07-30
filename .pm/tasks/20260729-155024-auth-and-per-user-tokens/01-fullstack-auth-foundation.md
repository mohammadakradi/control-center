---
title: Auth foundation — users, signup/signin, session middleware
stack: fullstack
assignee: swe
priority: P1
depends_on: []
---

# Auth foundation — users, signup/signin, session middleware

## Issue
The control center has no concept of a user: `lib/db/schema.ts` defines only
agents/projects/tasks/events, and every page and API route under `app/` is open to anyone
who can reach the server. Multi-user features (per-user Claude tokens, per-user usage)
have nothing to hang off.

## Goal
Users sign up and sign in with email + password; every page and API route requires a valid
session; unauthenticated visitors land on the sign-in page.

## Suggested solution
Self-contained credentials auth — no external auth service (app is self-hosted SQLite):
- `users` table (Drizzle) with salted password hashes (argon2/scrypt — not plain bcrypt-lite),
  plus a `sessions` table (or signed HttpOnly session cookie) with expiry.
- `/signin` and `/signup` pages using the existing bespoke components and semantic tokens
  (`components/ui/`, `components/ui-cards.tsx`); sign-out control in the sidebar/user menu.
- Auth check enforced app-wide via Next.js middleware (read
  `node_modules/next/dist/docs/` first — Next 16.2.9 conventions may differ), protecting
  all pages and `app/api/*` routes; a small `lib/auth.ts` helper exposes the current user
  to server components and route handlers.
- Migration via `pnpm db:push`. First registered user simply becomes a normal user — no
  role/admin system in this pass.

## Affected areas
- `lib/db/schema.ts` — new `users` (+ `sessions`) tables
- `lib/auth.ts` (new) — session create/verify helpers, current-user accessor
- Next.js middleware (new, repo root or per Next 16 docs) — route protection
- `app/signin/`, `app/signup/` (new) — auth pages using existing UI primitives
- `components/Sidebar.tsx`, `components/MobileNav.tsx` — signed-in user + sign-out entry
- All existing `app/api/*` route handlers — gain session enforcement (via middleware)
