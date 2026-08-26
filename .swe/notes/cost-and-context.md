# cost and context

Why `CLAUDE.md`, this journal, and `.fe/design-system.md` have hard size budgets, and why the
runner has per-task ceilings. Measured on this install's own database on 2026-08-24, not
assumed.

<!-- Written 2026-08-24 from a forensic pass over ~/.control-center/data/platform.db (207 task
rows, 216,323 transcript events). Read this before "tidying up" a budget away. -->

## The finding

207 agent runs across five projects cost **$2,813**. Only **17.5%** of that bought generated
output. The rest paid to re-send context:

| Component | Tokens | Share of spend |
|---|---|---|
| Cache read (re-sending context) | 3,456M | **60.4%** |
| Cache write | 104M | 21.5% |
| Output (thinking + code) | 21.4M | 17.5% |
| Uncached input | 7.5M | 0.7% |

The agents re-sent **141k tokens of context on every one of 32,688 API calls** — a ratio of
~160 context tokens read per token written.

**It is not the pricing, and it is not a caching failure.** 99.3% of input was served from
cache at a 33:1 read-to-write ratio; without caching the same workload would have cost roughly
ten times more. Prompt caching was working close to optimally. The bill was the *volume* of
context being carried.

## Where the volume came from

Two rules told the agent to grow a file and neither said how big was too big — engineering
rule 7 (*keep CLAUDE.md current*) and rule 10 (*read the journal at the start of every
request*). Over two months:

| Date | CLAUDE.md | .swe/notes.md |
|---|---|---|
| 2026-06-24 | 0 KB | 0 KB |
| 2026-08-02 | 11 KB | 25 KB |
| 2026-08-20 | 97 KB | 157 KB |
| 2026-08-24 | **147 KB** | **233 KB** |

`CLAUDE.md` is auto-injected into every session, so at 147 KB it was ~38k tokens in the prompt
of every call — **25% of this project's entire context spend** (~$255 of its $1,247), before
counting the journal that Phase 1 read in full on top of it.

The cost per task tracked that growth: **$1.90 (June) → $6.90 (July) → $21.50 (August)**. The
model-independent measure moved the same way — context tokens re-read per output token went
**84:1 → 124:1 → 194:1**. Models changed over that window; this ratio doesn't care.

Two more contributors, both since changed:
- **Mandatory double review was 23% of spend.** Both workflows dispatched two adversarial
  reviewers on *every* task — 356 subagent spawns, each a fresh context re-loading the project
  docs from scratch, pinned to `claude-sonnet-5`. That is why Sonnet 5 nearly matched Opus 5 on
  total cost at 40% of the price. Review is now scaled to the diff (workflow Phase 4).
- **`CLAUDE.md` was read explicitly 112 times** (37 of them full-file) despite already being in
  the prompt — a second 38k-token copy in the transcript, bought nothing.

## What was ruled out

Recorded so nobody "fixes" these:

- **Thinking depth / effort.** No `effort` is configured, so Claude Code's `xhigh` default
  applies — but thinking totalled 0.9M tokens, **4% of output, ~$22**. Lowering it would save
  almost nothing and cost quality. Leave it alone.
- **Tool batching.** 1.25 tools per API response, 22.5% batching two or more. Unremarkable.
  Beware the measurement trap here: the SDK splits one API response across several transcript
  `assistant` events, so counting events makes it look like there is no batching at all and
  inflates the call count (66,925 apparent vs 32,688 real). De-duplicate by `message.id`.

## Measuring this again

- Authoritative spend is the delta-accumulated `tasks.usage*` columns. **Do not sum
  `modelUsage` across result messages** — those counters are cumulative per subprocess, so a
  naive sum double-counts (it gave $4,735 against the true $2,813). Take the peak per
  `(task_id, session_id, model)`.
- Per-model attribution only exists in `modelUsage` inside `type: "result"` messages in
  `task_events`. Subagent usage lands there too, under the subagent's pinned model — comparing
  it against the task's routed `model` column is how you separate main-session from subagent
  spend.
- Work on a **copy** of the database. It is ~500 MB and live; `.swe/notes/gotchas-*.md` has the
  corruption history.

## What was changed on 2026-08-24

- Hard budgets, with the number in the rule: `CLAUDE.md` 20 KB, `.fe/design-system.md` 25 KB,
  journal index 8 KB, each `.swe/notes/<topic>.md` 30 KB. Over budget means consolidate or
  split, never append.
- This project's own docs were migrated to match: `CLAUDE.md` 147 KB → ~12 KB and the 233 KB
  journal → an index plus topic files, **relocated verbatim** rather than rewritten.
- The agents are told never to Read `CLAUDE.md`, and to read the journal by index + grep.
- Review scaled to the diff instead of two reviewers on everything.
- Per-task run ceilings in the runner (`lib/config.ts`): `CC_TASK_MAX_TURNS` (250) and
  `CC_TASK_MAX_BUDGET_USD` (40, cumulative across continues). There were none, and one
  `swe:task` ran 1,201 turns over 161 hours for **$300** — 11% of the two-month bill in one row.
- Fable 5 is no longer auto-selected (it is 2× Opus 5's price for a tier chosen by a triage
  guess); it stays available in the model picker. `CC_ENABLE_FABLE_TIER=1` restores it.

## Re-splitting these docs later (how it was done)

The migration was a **verbatim relocation, not a rewrite** — every moved section kept its bytes,
and preservation was verified by sampling 120 long lines from each original and grepping the new
corpus for all of them (0 missing; the single "miss" was the old file's own description line,
deliberately replaced by the index header). Repeat that check if you re-split.

Three traps hit while doing it, worth knowing:
- **Pack the budget with the header counted.** Splitting a file to exactly 30 KB of *entries*
  then adding a title, blurb and provenance header puts the result over budget. Reserve the
  front matter first, and split evenly across parts rather than greedily filling each one.
- **Index links are relative to the index's own directory.** `.swe/notes.md` linking
  `.swe/notes/x.md` resolves to `.swe/.swe/notes/x.md`. Write `notes/x.md`. All 34 links were
  wrong on the first pass; a link checker catches it in seconds.
- **`ONBOARD_MARKERS` (`lib/discovery/projects.ts`) depends on three of these paths existing** —
  `CLAUDE.md`, `.fe/design-system.md`, `.pm/notes.md`. Splitting a journal must leave the index
  file at the original path, or that agent silently reads as "never onboarded" and its `onboard`
  skill is offered forever. All three still exist as index/reference files.

Code comments that pointed at a journal were repointed at the specific topic file the content
landed in, so no pointer resolves to "somewhere in 370 KB".

## Round 2 (same day): what was left after the doc split

With the two big docs fixed, the remaining spend is **accumulated transcript**, not static
context — every project measured ~150k context per call, including ones whose `CLAUDE.md` was
always small. Measured from the same database:

| Lever | Measured | Done |
|---|---|---|
| Compaction effectively never fires | **1** `compact_boundary` in 207 tasks | `autoCompactWindow` 200k |
| `Read` is two thirds of all tool output | 16.6M tok; **67% of reads are full-file** | reading-discipline rule |
| Identical content re-read inside one task | 1,040 re-reads, 2.1M tok (8%) | same rule |
| Agents re-reading their own rules | 285k tok (`workflow.md` 79k) | read-once in the commands |
| Read-only explorers on Sonnet | 3× overpriced for extraction | moved to Haiku 4.5 |

Tool-result volume, for calibration: 37,864 results, 99.5M chars ≈ **25M tokens**. `Read` is
66.5M chars of that at a mean of 9,651 chars per call; `Bash` is 29M at 1,182. The heaviest
single files read into context were `notes.md` (941k tokens across all tasks) and
`design-system.md` (445k) — both now split — then `page.tsx` (228k), `git.ts` (219k).

**On compaction, and why 200k rather than lower.** Compaction is the only mechanism that
shrinks a *live* transcript: the Agent SDK exposes no context-editing option (no
`clear_tool_uses`), only `autoCompactWindow`/`autoCompactEnabled` on the `Settings` interface.
It is set through the query's `settings` option (the "flag settings" layer, highest priority
among user-controlled settings) rather than a project `.claude/settings.json`, so it applies to
every task whatever project it runs against. It is set low enough to be reachable and high
enough that an ordinary task never trips it, because **compaction summarizes and discards
detail** — firing it early on a long build risks losing a decision made an hour ago. That is a
quality risk, not a free saving. `CC_AUTO_COMPACT_WINDOW=0` disables the override.

*Assumption worth re-checking:* passing one key in `settings` is expected to **merge** into the
settings layers rather than replace them, so the user's own settings keep working. That follows
from it being a layer (equivalent to `--settings`), but it was not verified end-to-end — if
user settings ever appear to be ignored inside a task, look here first.

**Screenshots were left alone deliberately.** PNG reads cost ~600k tokens (top three: 347k,
119k, 99k), but that is the fe agent's visual verification doing its job. Spend, not waste.

Screenshot and image reads aside, do not "optimize" the two review subagents onto a cheaper
model: adversarial judgment is what they are for, and it is the wrong place to save $20.

## Round 3: document volume, and what repo weight actually is

Two things people assume about the generated docs, both measured and both wrong in the same
direction — they are cheaper than they look, and they are not what makes the repo big.

**Writing documents costs ~$6.50 of $2,813 — 0.2% of spend.** Document generation is not a
token problem and optimizing it saves nothing measurable. What matters is whether a document
is ever *read*, since that is the recurring cost:

| Document | Writes | Reads | Ratio |
|---|---|---|---|
| `.pm/tasks/` specs | 214 | 272 | 1.27 — load-bearing, the backlog dispatches from them |
| `.swe/epics/` | 7 | 7 | 1.00 — working as designed |
| test-scenarios | 211 | 75 | **0.36** — two thirds never opened again |

Test scenarios are written for a *person*, so a low agent read-back ratio is expected rather
than damning — but the user confirmed they rarely read them, so Phase 5 / rule 14 now writes
one **only when the change gives someone something to go and do**, with a one-line "skipped,
nothing to walk through" otherwise. The existing 50 files were left in place.

**Do not gitignore the journal.** It was proposed as a way to keep the repo small. It saves no
tokens at all — cost is incurred when a file is read into context, not when it is in git, and
an auto-injected `CLAUDE.md` costs exactly the same gitignored. It also *raises* token usage on
any fresh clone or second machine, because the agent re-learns every gotcha and re-investigates
settled decisions. And `file-reads-and-git.md` records two knowingly-open CRITICAL holes; that
knowledge has to travel with the repo.

**The repo weight was three images, not the docs.** Of 11.7 MB tracked, agent docs were 1.0 MB
(8.6%) while `public/{swe,fe,pm}-agent.png` were **5.25 MB (45%)** — 1254×1254 photos rendered
at a maximum of 80px (`components/AgentAvatar.tsx`). Resized to 240px (3× the largest render):
**11.7 MB → 6.7 MB tracked (−43%)** and the release tarball **7.97 MB → 2.94 MB (−63%)**, which
is ~5× what deleting every generated document would have reclaimed. Originals remain in git
history if a larger source is ever needed.

Note the limit of that fix: it shrinks the working tree, future clones and the tarball, but the
old 5 MB blobs stay in `.git` history forever. Rewriting history to reclaim them was **not**
done and is not worth it — `.git` is only 24 MB.
