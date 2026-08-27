# log search

Dated log of global search as it was built.

<!-- Split out of a single 232 KB `.swe/notes.md` on 2026-08-24, which was read in full at the start of every request (engineering rule 10). Entries are verbatim and in date order; only this header is new. -->

## 2026-08-20 — global search (`lib/search.ts`, `GET /api/search`)
pm task `04-backend-global-search-api` (`.pm/tasks/20260819-222248-beat-t3-ui-ux/`). One endpoint
answering a short query with matching tasks, projects, agents and backlog items, sized to drive the
command palette that task 05 will build. Route/lib split as `lib/backlog.ts` does it: the route is
auth + two parsers + one call, everything else is in the lib with 22 specs.
- **The whole security story is one asymmetry: tasks are owner-scoped, the other three are not.**
  A task and its transcript are private, so an unscoped search would be a *text box that probes
  other people's work* — type "invoice" and learn someone here is working on invoices. Projects,
  agents and backlogs are documented install-wide shared (CLAUDE.md), and each is already returned
  by its own unauthenticated route, so searching them discloses nothing new.
  - **Verified end to end against the real dev database, not just by unit test.** 17 tasks matching
    "update" exist and all 106 belong to one signed-in account; an unauthenticated (`user_local`)
    search returns **0** tasks while still returning 8 backlog hits. Both halves matter — zero
    everywhere would only have proved that nothing matched.
- **Search deliberately shows exactly the tasks the task lists show.** `ownedBy` is
  `eq(tasks.userId, userId)`, so the legacy null-owner rows are excluded. On an install where those
  dominate, search therefore looks sparse — which is right: every other task read (`/api/tasks`, the
  dashboard, the tasks/project/agent pages) excludes them too, and widening it *only* for search
  would make one endpoint a window on tasks the lists hide. If these two ever disagree, search is
  the side that's wrong.
- **A one-character query is a 200 with empty lists and `tooShort: true`, not a 400.** This endpoint
  is typed into: a 400 on the first keystroke of every search is an error flash the palette would
  have to learn to suppress. Malformed input (`q` over 200 chars, `limit` off 1…25) *is* a 400, and
  refused rather than clamped — results must never quietly answer a different question than the one
  asked, the same stance `parseRange` takes. `searchAll` additionally returns nothing for an
  over-long query and clamps a bad limit, so a non-HTTP caller that skipped the parsers gets
  nothing rather than an unbounded scan.
- **`q` is echoed back on every path, and getting this wrong would have been a trap for task 05.**
  I first blanked it when the query was too short to run ("the query *as searched*"), which is
  self-consistent and wrong: a debounced client's cheapest staleness guard is
  `if (res.q !== input) discard`, and that guard would have thrown away the very response carrying
  `tooShort` — so the palette could never render "keep typing", and the flag would look broken from
  the outside. Now `q` means "what was asked" (trimmed) and `tooShort` means "it didn't run", one
  meaning each. Found by asking what the consumer does with the field, not by a test failing.
- **`ESCAPE '\'` written inline is a trap, and the specs caught it on their first run.** In a JS
  template literal `'\'` is an *escaped quote*, so SQLite received `ESCAPE ''` and answered "ESCAPE
  expression must be a single character" — every query threw. The escape character is now a bound
  parameter, so the character reaching SQLite is the one written in the source. Loud rather than
  silent, luckily: the failure mode of a *working* `ESCAPE ''` would have been unescaped wildcards.
  - Escaping is **correctness, not injection defence** (the pattern is always parameterised): an
    unescaped `%` means "match everything" and `_` means "any character". Verified against real
    data — `__` matches 4 of 76 backlog items via literal `__tests__`/`__KEY__` in their bodies;
    with the wildcard live, all 76 would have matched.
  - `escapeLike` escapes `\ % _` in one pass over a character class, so the escape character it
    inserts is never rescanned. The audit confirmed trailing/doubled/lone backslashes can't
    desynchronise it, and that `prefixFirst`'s `ORDER BY` reuses the same `matches()` binding path
    rather than opening a second escaping surface.
- **`String.length` is the wrong unit for a snippet cap, and I shipped that bug before catching it
  myself.** SQLite's `substr` counts **code points**; JS `.length` counts UTF-16 units. So 150 emoji
  (300 units, 150 characters) came back from SQL whole and `trimSnippet` then declared it over-long
  and cut a perfectly short request in half — and `slice` at a UTF-16 offset can land *inside* a
  surrogate pair and render as a replacement character (the fixture `"wide request " + 250 emoji`
  puts a pair astride offset 200, verified). Now counted and cut with `[...value]`, the same
  reasoning as `cleanTitle` in `lib/dispatch.ts`, which already carried this lesson.
- **Bodies are matched but not returned, and the distinction between the two types is principled.**
  A backlog description runs to 20 000 characters and its item always has a non-empty title (schema
  + `lib/backlog` validation), so there is no fallback text to supply — it is matched and dropped. A
  *task* may have no title at all, so `taskDisplayTitle` needs its `requestText`, which is therefore
  returned but `substr`-capped in SQL so the untruncated value never enters the process.
- `hasMore` comes from over-fetching `limit + 1` rows rather than four `COUNT(*)`s over the same
  predicates — it would have doubled the work to report a boolean.
- **Plain `LIKE`, no FTS5**, and no index added. Measured: 10–25 ms end to end on the real database
  (106 tasks, 76 backlog items), including the worst case of a two-letter query at `limit=25`.
  FTS5 would mean a schema change plus triggers on three tables to keep shadow tables in step.
- Known limitation, documented rather than fixed: SQLite folds case for **ASCII only**, so `Ü`
  doesn't match `ü`. `lower()` has the identical limitation, so the workaround is an ICU build.
- **Both review subagents came back clean, with no blocking findings** — the first task in a while
  where that happened, so it's worth recording *why* the usual failure modes didn't apply: this
  feature spawns no subprocess, reads no file, and takes no path from the caller, which is where
  almost every finding in the last six entries came from. The security audit ran gitleaks, semgrep
  (0 findings on the three files) and `pnpm audit` (28 pre-existing transitive, no manifest touched),
  and independently reproduced the ownership boundary, injection immunity, NUL/unicode handling and
  the escape-desync cases.
  - Its one substantive non-blocking note: `tasks` and `backlog_items` have no index beyond their
    primary key, so every search is a full-table scan, `better-sqlite3` is synchronous, and this is
    the process that also serves the SSE task streams. Fine at 106 rows; the file header says
    "measure first" for a reason, and `tasks` is the one table that grows without bound. Not
    actioned here — an index or FTS5 chosen without a measurement would be a guess.
  - Also confirmed pre-existing and out of scope: no rate limiting and no auth on this route, like
    every other route in this app.
- **The correctness review found no bug, but it broke four of my tests — and that was the most
  useful thing either review did.** It independently reproduced both bugs above (it had started
  against the pre-fix file), and then went after the *specs* instead of the code: it proved my
  ranking test still passed with the tie-breaker flipped to `asc(createdAt)`, i.e. the "newest
  first" half of that test's own name was enforcing nothing. Same gap for projects/agents/backlog,
  whose secondary sorts had no test with two matching rows at all, and `hasMore: true` was only
  ever exercised on the tasks group. All closed: the ranking assertion is now the whole sequence
  (`deepEqual`), and there is one ordering spec per group with fixtures built so the *wrong* sort
  gives a *different* answer — the agents fixture exists purely because its name sorts first while
  its id sorts last, which two ordinary fixtures could not distinguish. Verified by flipping all
  four tie-breakers at once: exactly those four specs go red, and the file restores byte-identical.
  - **Lesson worth keeping: "the guard is right" and "the test would notice if it weren't" are
    different claims, and I had only checked the first for ordering.** I did check it for the three
    guards I thought were load-bearing (ownership, escaping, truncation) and skipped it for the
    ones that felt cosmetic. Ordering *is* cosmetic — right up until a palette lists results in an
    order nobody can reproduce.
  - Its other gap was real too: the LEFT join's null-`projectName` branch had no test, and building
    one taught me something the notes had wrong-by-omission. A **freshly migrated database does
    enforce that foreign key** (`SQLITE_CONSTRAINT_FOREIGNKEY`, found by trying) — so an orphaned
    task is only reachable where enforcement lapsed, which is exactly the state this repo's real
    database is recorded to be in, and exactly why the join isn't an inner one. The spec builds it
    with `pragma("foreign_keys = OFF")` rather than pretending it happens by accident.
  - One factual error in my own comment, also caught: "four `LIKE`s across eight columns" — it is
    nine (tasks 2, projects 2, agents 3, backlog 2). Fixed. Worth noting the reviewer counted; I
    had estimated.
  - **Process note, recorded because it cost real time.** Both reviews were dispatched in the
    background and the first one's report never reached me — I asked it to resend, it reasonably
    read that request as a prompt-injection attempt and said so in its final report, and meanwhile
    I had already dispatched a *second* correctness reviewer and kept editing the files it was
    reviewing. It caught the churn ("the files under review changed on disk while I was testing
    them") and also disclosed that it had briefly edited the tracked `lib/search.ts` itself before
    restoring it. Nothing was lost — I verified the guards, the absence of scratch markers, and a
    byte-identical restore — but the sequencing was my fault twice over: **don't edit files while a
    review of them is in flight, and don't re-dispatch a reviewer whose result may simply be late.**
- **Verified the specs can fail before trusting them** (the 2026-08-16 lesson, applied up front and
  then extended under review): deleting `ownedBy` turns the scoping spec red, stubbing `escapeLike`
  to the identity turns both wildcard specs red, restoring the UTF-16 `trimSnippet` turns the
  code-point spec red, and flipping all four `orderBy` tie-breakers turns exactly the four ordering
  specs red. Checked by actually reverting each one, not assumed.
- Manual steps: `.swe/test-scenarios/global-search-api.md`. Note `app/api/search/` is a **new route
  directory**, so it 404s until the dev server restarts — the documented bind-mount watch gap, and
  it cost a few minutes of "why is my route missing" before I remembered.
