# Test scenario — Per-task token & cost accounting

Covers pm task 04 (`.pm/tasks/20260729-155024-auth-and-per-user-tokens/04-backend-task-usage-capture.md`).

## Setup
- `pnpm dev` (container). The five `tasks.usage*` columns are already applied to
  `data/platform.db`; a fresh DB gets them from `lib/db/schema.ts`.
- Back up before anything that writes history: `data/backup/` already holds
  `platform.pre-usage-columns.db`.

## 1 — Automated suite (the primary gate)
- [ ] `docker exec platform pnpm test` → **29 passing**. This is the real coverage: delta
      accounting, subprocess-restart detection, the `usage`-block fallback, NaN/negative/
      garbage guards, launch-boundary detection, and a replay of a real recorded task
      asserting a hand-checkable total.
- [ ] `docker exec platform pnpm lint` and `docker exec platform npx tsc --noEmit` → clean.
- [ ] `docker exec platform pnpm build` → **expected to FAIL** on Next's internal
      `/_global-error` page (`Cannot read properties of null (reading 'useContext')`). This
      is pre-existing and unrelated — verified to reproduce on a clean tree with nothing
      uncommitted. Do not treat it as a regression.

## 2 — Live capture on a real run
- [ ] Dispatch any task and let it finish. Then check the row:
      `SELECT usage_input_tokens, usage_output_tokens, usage_cost_usd FROM tasks WHERE id='<id>'`
      → non-zero, and `usage_cost_usd` in the same ballpark as the cost shown in the
      transcript's final result.
- [ ] **Resume accumulates, doesn't reset.** Note the totals, then hit **Continue** (or send
      a change request) on that finished task and let it complete again. The totals must be
      **strictly higher** than before — a resume spawns a fresh SDK subprocess whose own
      counters restart from zero, and the fix for that is the whole point of the delta logic.
      A total that *dropped* or *stayed equal* means the restart detection regressed.
- [ ] **A failed run still bills.** Dispatch a task that fails (e.g. a nonsense request the
      agent aborts on, or stop it after it has taken at least one turn) → usage is still
      recorded, because spend happens whether or not the task succeeds.
- [ ] Nothing in the transcript mentions usage accounting. If a `usage accounting skipped: …`
      log line appears, the DB write threw — investigate; the run itself is unaffected by
      design.

## 3 — Backfill from history
- [ ] `docker exec platform pnpm db:backfill-usage --dry-run` → reports what it *would*
      write and writes nothing.
- [ ] `docker exec platform pnpm db:backfill-usage` → fills only tasks whose usage is still
      all-zero.
- [ ] **Idempotent:** run `--all --dry-run` twice and compare the grand totals — identical
      both times, and identical to `SELECT ROUND(SUM(usage_cost_usd),4) FROM tasks`. Current
      known-good figure: **$459.6148** across 80 tasks (11 tasks have no recoverable usage).
- [ ] Re-running `--all` for real does **not** double any row (totals are written absolutely,
      not added).

## 4 — API exposure (no code change needed)
- [ ] `GET /api/tasks` and `GET /api/tasks/<id>` both include `usageInputTokens`,
      `usageOutputTokens`, `usageCacheReadTokens`, `usageCacheCreationTokens`,
      `usageCostUsd`. Every task read is a full-row `db.select()`, so the fields appear
      automatically — verify rather than assume.

## 5 — Known limitation (expected, not a bug)
- [ ] A task whose subprocess is **killed mid-turn** records **$0**, because usage is banked
      only when a `result` message arrives. `task_566f891c` is the worked example: 1 371
      persisted events, zero `result` messages, zero recoverable usage — backfilling can't
      recover it either, since it replays the same events. If you need this closed, it means
      accruing per-turn from assistant messages, which overlaps `modelUsage` and needs its
      own de-duplication.
