# search

Global search (`lib/search.ts`): the owner-scoping asymmetry, the `LIKE` escaping, and every bound.

<!-- Moved out of CLAUDE.md on 2026-08-24 to bring it inside its 20 KB budget (engineering rule 7). Content is verbatim; only the heading level and this header are new. -->

## Global search (`GET /api/search`)
One query, four types — tasks, projects, agents, backlog items — sized to drive an as-you-type
command palette. `lib/search.ts` owns the queries, the types and every bound; the route is auth
plus two parsers plus one call, the same split as `lib/backlog.ts`.
- **Tasks are scoped to the caller (`ownedBy`); projects, agents and backlogs are not.** That
  asymmetry is the whole security story: a task and its transcript are private, so an unscoped
  search would be a text box for probing other people's work — type "invoice" and learn someone
  on this install is working on invoices. The other three are documented shared install-wide and
  each is already returned by its own unauthenticated route, so searching them discloses nothing
  new.
- **Search deliberately shows exactly the tasks the task lists show.** `ownedBy` excludes the
  legacy null-owner rows, so on an install where those dominate search looks sparse — which is
  correct, because `/api/tasks`, the dashboard and the project/agent pages all exclude them too.
  **If search and the task lists ever disagree about what you can see, search is the wrong side.**
- **`q` is echoed back (trimmed) on every path, `tooShort` says whether it ran.** One meaning
  each. Blanking `q` when nothing ran broke the cheapest client staleness guard there is —
  `if (res.q !== input) discard` — by discarding the very response that carries `tooShort`, so
  the palette could never render its "keep typing" state.
- **A too-short query (< 2 chars) is a 200 with empty lists and `tooShort: true`, not a 400** —
  this endpoint is typed into, and an error on the first keystroke is a flash the palette would
  have to suppress. Genuinely malformed input (`q` over 200 chars, `limit` outside 1…25) *is* a
  400, and **refused rather than clamped**: results must never quietly answer a different question
  than the one asked. `searchAll` independently refuses an over-long query and clamps a bad limit,
  so a caller that skipped the parsers gets nothing rather than an unbounded scan.
- **The `ESCAPE` character is a bound parameter, never written into the SQL text.** Spelled inline
  it is a trap the specs caught immediately: in a JS template literal `ESCAPE '\'` is an escaped
  *quote*, so SQLite got `ESCAPE ''` and every query threw. Escaping itself is **correctness, not
  injection defence** (the pattern is always parameterised) — an unescaped `%` means "match
  everything" and `_` means "any character". `escapeLike` covers `\ % _` in one pass over a
  character class, so the escape character it inserts is never rescanned, and `prefixFirst`'s
  `ORDER BY` reuses the same binding rather than opening a second escaping surface.
- **A snippet cap must count code points, not `String.length`.** SQLite's `substr` counts
  characters while JS counts UTF-16 units, so 150 emoji came back from SQL whole and were then
  declared over-long and cut in half — and slicing at a UTF-16 offset can split a surrogate pair
  into a replacement character. Cut with `[...value]`, like `cleanTitle` in `lib/dispatch.ts`.
- **Bodies are matched but not returned, and the two types differ for a reason.** A backlog
  description runs to 20 000 chars and its item always has a non-empty title, so there's no
  fallback text to supply — matched, then dropped. A *task* may have no title at all, so
  `taskDisplayTitle` needs its `requestText`, which is returned but `substr`-capped **in SQL** so
  the untruncated value never enters the process.
- `hasMore` comes from over-fetching `limit + 1`, not from four `COUNT(*)`s over the same
  predicates — that would double the work to report a boolean.
- **Plain `LIKE`, no FTS5 and no new index**, measured at 10–25 ms end to end on the real database
  (106 tasks, 76 backlog items) including a two-letter query at `limit=25`. Nothing here touches
  `task_events`, which is why a long history doesn't slow it down. Known scaling limit: those
  tables have no index beyond their primary key, `better-sqlite3` is synchronous, and this process
  also serves the SSE streams — so revisit if `tasks` reaches the tens of thousands, and **measure
  before choosing an index or FTS5**.
- Known limitation, not a bug: SQLite folds case for **ASCII only**, so `Ü` doesn't match `ü`.
  `lower()` has the same limitation; the fix is an ICU build.
