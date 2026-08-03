# Test scenario: usage date-range filter + per-project spend breakdown

_Task: `spendForUser()` / `GET /api/usage` now accept a `range` (`7d` | `30d` | `all`) and
return project identity on each top task plus a per-project spend breakdown · 2026-08-03_

## Setup / preconditions

- Dev container running: `pnpm dev` (app on http://localhost:3001).
- You are signed in, and your account owns at least one task with recorded spend
  (Usage page shows a non-zero total). If everything is unattributed, dispatch any small
  task first so one belongs to you.
- Grab your session cookie for `curl`: in the browser dev tools → Application → Cookies →
  copy the `session` cookie value, then use it below as `COOKIE="session=<value>"`.

## Happy path

1. `curl -s -H "Cookie: $COOKIE" "http://localhost:3001/api/usage" | python3 -m json.tool`
   - **Expected:** `spend.range` is `"all"`; totals match what the Usage page shows today.
     Each entry in `spend.topTasks` now carries `projectId` and `projectName`.
2. Look at `spend.byProject` in the same response.
   - **Expected:** one entry per project you've spent in, each with `projectName`, `costUsd`,
     the four token counters, `taskCount`, and `billedTaskCount` — sorted by `costUsd`
     descending. The sum of `byProject[*].costUsd` equals `spend.totalCostUsd`.
3. `curl -s -H "Cookie: $COOKIE" "http://localhost:3001/api/usage?range=30d" | python3 -m json.tool`
   - **Expected:** `spend.range` is `"30d"`; `totalCostUsd` ≤ the all-time figure and equals
     `last30DaysCostUsd` from step 1. Tasks older than 30 days are gone from `topTasks`
     and from the `byProject` totals.
4. `curl -s -H "Cookie: $COOKIE" "http://localhost:3001/api/usage?range=7d" | python3 -m json.tool`
   - **Expected:** `spend.range` is `"7d"`; figures shrink again (or hit 0 if you've been
     idle a week). `unattributed` is identical across all three calls — it is all-time by
     design.

## Edge / failure cases

1. `curl -s -o /dev/null -w "%{http_code}\n" -H "Cookie: $COOKIE" "http://localhost:3001/api/usage?range=90d"`
   - **Expected:** `400` — the body says the valid values are `7d`, `30d`, `all`. Same for
     `range=7D` (the allowlist is exact).
2. `curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:3001/api/usage?range=bogus"`
   (no cookie)
   - **Expected:** `401` — auth is checked before range validation, so an unauthenticated
     caller learns nothing about the parameter.
3. If a teammate has spend in a project you also use: compare your `byProject` entry for
   that project with theirs (each signed in as themselves).
   - **Expected:** the figures differ — each of you sees only your own spend in the shared
     project; unowned (pre-auth) tasks appear in nobody's breakdown, only in `unattributed`.

## What success looks like

`/api/usage` answers "what did I spend in the last week/month, and on which projects" —
the numbers tighten as the range narrows, every task and breakdown row names its project,
and nobody's figures ever include another user's tasks. The Usage page itself still renders
unchanged (the UI for the new data is the paired frontend task).
