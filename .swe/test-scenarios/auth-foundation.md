# Test scenario: Email/password authentication

_Task: rebuilt the auth feature (signup/signin/signout, session-gated routes) after the
uncommitted work was lost to a discard, recovered the corrupted `platform.db`, and hardened
signin against a timing side-channel + added rate limiting · 2026-07-30_

## Setup / preconditions
- Docker running; the app's dev container up: `pnpm dev` → open <http://localhost:3001>
- No cookies/local storage cleanup needed — just use a private/incognito window so you start
  signed out.
- You'll need one email you haven't signed up with yet.

## Happy path

1. Open <http://localhost:3001/> while signed out.
   - **Expected:** redirected to `/signin` — you never see the dashboard/sidebar unauthenticated.
2. Click "Sign up", enter a new email + an 8+ character password, submit.
   - **Expected:** redirected to `/` and the full app (sidebar, dashboard) loads. Your email
     appears in the sidebar footer (and behind the account icon on mobile widths).
3. Click "Sign out" (sidebar footer, or the icon in the mobile top bar).
   - **Expected:** redirected to `/signin`; visiting `/` again also redirects to `/signin`.
4. Go to `/signin`, enter the same email + correct password, submit.
   - **Expected:** signed in again, back at `/`.
5. While signed in, navigate to `/signin` or `/signup` directly.
   - **Expected:** redirected straight to `/` — you can't land on the auth pages while
     already signed in.

## Edge / failure cases

1. On `/signin`, submit the right email with a wrong password.
   - **Expected:** "Invalid email or password" — no hint about which field was wrong.
2. On `/signin`, submit an email that was never signed up.
   - **Expected:** the identical "Invalid email or password" message, and it should take
     roughly the same time to respond as case 1 above (no noticeable delay difference) — this
     is what closes the account-enumeration timing gap found in review.
3. On `/signup`, try to sign up twice with the same email.
   - **Expected:** second attempt gets "An account with this email already exists" (409).
4. Submit `/api/auth/signin` more than 10 times in under a minute (e.g. a quick shell loop),
   with any credentials.
   - **Expected:** the first 10 get normal 401s (wrong creds), the 11th+ get `429 Too many
     attempts, try again later`. This is the new rate limiter — it resets after ~60s.
5. Directly hit a protected page/API while signed out, e.g. `curl -i http://localhost:3001/api/projects`.
   - **Expected:** `401 {"error":"Unauthorized"}` for API paths, and a redirect to `/signin`
     for page paths.

## What success looks like
Signed-out visitors can only reach `/signin`/`/signup`; every other route (page or API)
requires a session; signup/signin/signout all round-trip correctly; wrong-password and
no-such-account fail identically and at the same speed; and repeated signin/signup attempts
get throttled instead of hitting the database unbounded.
