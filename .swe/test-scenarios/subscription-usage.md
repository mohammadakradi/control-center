# Test scenario — Usage endpoint (`/api/usage`)

Covers pm task 05 (`.pm/tasks/20260729-155024-auth-and-per-user-tokens/05-backend-subscription-usage.md`),
built as the **combined** endpoint: real per-user spend, plus a best-effort plan-limits block.

## Read this first
Claude **plan rate limits are expected to be unavailable** on this app. The SDK reports them
only for a logged-in *profile*, and we inject each user's token via `Options.env`, which it
classifies as "missing profile scope". Measured with a real subscription token:
`accountInfo()` → `tokenSource: CLAUDE_CODE_OAUTH_TOKEN`, yet `subscription_type: null` and
`rate_limits_available: false`. So `rateLimits.available: false` is a **pass**, not a bug.
The useful half is `spend`.

## 1 — Automated suite
- [ ] `docker exec platform pnpm test` → all passing. Covers window normalization (unknown
      keys pass through, utilization clamped 0–100, junk → null, non-window entries like
      `extra_usage` excluded) and spend aggregation (per-user scoping, the 30-day window,
      top-task ordering, zeros for a user with no tasks, unattributed reported separately).
- [ ] `pnpm lint` and `npx tsc --noEmit` clean. (`pnpm build` still fails on the
      pre-existing Next `/_global-error` issue — not related.)

## 2 — Authenticated access
- [ ] Signed out: `curl -i localhost:3001/api/usage` → **401**.
- [ ] Signed in: returns `{ spend, rateLimits }`.
- [ ] **Scoping:** sign in as a second user who owns no tasks → their `spend.totalCostUsd`
      is 0 and `topTasks` empty, even though the first user has spend. Spend must never
      cross users (unlike task transcripts, which are shared on purpose).

## 3 — Plan limits degrade cleanly
- [ ] Normal case: `rateLimits.available: false` with a plain-language `reason`, HTTP 200.
- [ ] A user with **no token saved** → `available: false` and a reason pointing at Settings
      (not the dispatch-flavoured wording).
- [ ] **Runner down** (`docker compose stop`, then hit the route via a fresh `pnpm dev:web`,
      or just confirm the code path): `spend` is still returned in full and `rateLimits`
      reports the runner as unreachable — the endpoint must not 500 when the runner is gone.
- [ ] **Caching:** call the runner endpoint twice
      (`docker exec platform node -e "fetch('http://localhost:4319/usage/<userId>')…"`).
      The first takes ~2s (it spawns a probe subprocess), the second returns in tens of
      milliseconds. Three TTLs: 60s when limits are available, ~10 min for a *structural*
      unavailability (env token can't read limits), and 15s for anything transient — a
      missing token or a timeout — so **adding a token in Settings takes effect within
      seconds**, rather than showing a stale "unavailable" for ten minutes.
- [ ] **No leaked subprocesses:** after several probes (including one you interrupt),
      `ps -eo args | grep -c "[c]laude-code\|[c]li.js"` inside the container is 0. Teardown
      goes through `session.return()`, which the SDK implements as SIGTERM→SIGKILL bounded
      at ~2s.
- [ ] **No billing:** the probe makes no model call. Confirm a probe doesn't change
      `SELECT SUM(usage_cost_usd) FROM tasks`, and that `session.total_cost_usd` on the raw
      SDK response is 0.

## 4 — Spend numbers are real
- [ ] Compare `spend` against the DB for the same user:
      `SELECT ROUND(SUM(usage_cost_usd),4), COUNT(*) FROM tasks WHERE user_id='<id>'`.
- [ ] `unattributed` matches `… WHERE user_id IS NULL`. On this instance that's **90 tasks /
      $459.61**, because almost all history predates the ownership column — see the note in
      `.swe/notes.md` about optionally claiming it.

## 5 — If plan limits ever do become available
- [ ] `rateLimits.windows` should populate on its own with no code change (five_hour,
      seven_day, per-model, …). Sanity-check that utilization reads 0–100 and `resetsAt`
      parses as a date before wiring it into any UI.
