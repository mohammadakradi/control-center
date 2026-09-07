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

## Round 4: effort as a user control, and the per-agent model policy

Two user-facing controls, both aimed at the same thing.

**Effort** (`tasks.effort`, the SDK's `Options.effort`) is now selectable next to Model:
`auto` or `low|medium|high|xhigh`. Nothing was setting it before, so every run inherited Claude
Code's `xhigh` default — `/swe:ship` reasoned as hard as an architecture change.

Two decisions inside `resolveEffort` worth not undoing:
- **It does not run its own triage call.** A second classifier round-trip to choose effort
  would cost more than the setting saves, so `auto` reuses the tier the *model* triage already
  paid for (it parses `chosen.reason`). One classification, two decisions. If the model reason
  format changes, `resolveEffort`'s tier detection changes with it — they are coupled on
  purpose, and `runner/model-router.test.ts` pins the strings.
- **The command outranks the request.** A wordy `/swe:ship` must not talk itself into deep
  reasoning, so `MECHANICAL` commands are `low` before the tier is even consulted.
- **`max` is not offered.** It is a real SDK level; this control exists to reduce spend, and
  `max` is the one direction that raises it.

Be honest about where the saving comes from: thinking is only 4% of output tokens here, so
lower effort does not save money by thinking less. It saves it because the agent makes fewer,
more consolidated tool calls — a shorter transcript — and transcript re-transmission is 60% of
the bill.

**The per-agent model policy** (`agent_model_policies`, Settings → Agent models) replaces the
`CC_ENABLE_FABLE_TIER` env flag from round 2. One decision should have one mechanism, and an
env var could not express "Fable for pm but not swe".

Design points that are load-bearing:
- **Keyed by namespace, not `agents.id`.** An agent re-discovered from a different marketplace
  or path gets a new `agents` row; a policy keyed on that id would silently reset to defaults
  on a re-install, quietly re-enabling a model someone had switched off.
- **A missing row means the defaults, not "all allowed"** — otherwise a fresh install
  auto-routes onto the most expensive model before anyone opens Settings.
- **Enforced twice, deliberately.** `lib/dispatch.ts` refuses an explicit denied pick *before
  the row exists* (a filtered dropdown alone is decoration any API caller can bypass), and the
  router clamps its own selection **down** the ladder. Clamping rather than refusing is what
  lets a task created before a policy change still be continued.
- **A broken policy fails cheap.** The column is plain JSON, so an import or hand-edit can
  produce `[]` or garbage; `allowedModelsFor` then falls back to the *cheapest* model, never
  the dearest, and the API refuses to save an empty list in the first place.

Two traps hit while building this, both already documented elsewhere and both still caught me:
- **A new route directory 404s until the dev server restarts** — `/api/settings/agent-models`
  returned the HTML shell until a container restart (`.swe/notes/build-and-environment.md`).
- **`setState` in a `useEffect` is a hard lint error here.** Keeping the model picker valid when
  the agent changes had to be *derived* at render, not synced in an effect
  (`.fe/notes/environment.md`). Deriving is the better shape anyway — no second source of truth.

## Are we cheaper than driving Claude Code by hand? (asked 2026-08-27)

**Not measurable yet, and the comparison is not the right target.** Recording both halves so
the question doesn't get re-answered from intuition.

**Why not measurable:** all 207 rows in the database predate the changes. No task has run
under the new budgets, caps, effort routing or review scaling, so there is no after-figure.
The only honest number today is a projection; the real one arrives after ~20 tasks, by
re-running the queries at the top of this note and comparing `avg(usage_cost_usd)` and the
context-per-output-token ratio against the August baseline ($21.50/task, 194:1).

**Projected effect on the historical workload**, mechanism by mechanism:

| Lever | Modelled effect | Confidence |
|---|---|---|
| `CLAUDE.md` 147→13 KB | 464M of 4,598M cache-read tokens avoided (**10%** of all context) | high — measured sizes × real call counts |
| Journal/doc reads | 1.5M tokens were read in as tool results, then rode every later prefix | high on volume, low on how much recurs |
| Fable denied by default | those 17 runs: $389 → ~$195 | high — same tokens, half the rate |
| Review scaled to the diff | subagents were 23% of spend ($500); small-diff tasks skip one or both lenses | medium — depends on diff mix |
| Effort routing | mechanical commands xhigh → low | low — no measurement exists yet |
| `$40`/task cap | 12 tasks exceeded it by $582 total (**21%** of the bill) | high on the bound, but it *stops* runs rather than reclaiming spend |

A defensible expectation is **30–50% off a comparable workload**, most of it from the context
shrink and the cap, and it will not be uniform: Control Center benefits most (its docs were the
bloated ones), while a project with a small `CLAUDE.md` was already near the floor.

**Why "cheaper than CLI chat" is the wrong goal.** These are not the same unit of work. A CLI
chat turn is one exchange you steer; a `swe:task` is an autonomous multi-hour run with a median
of **59 turns in a single subprocess** (max 302) that plans, builds, tests, dispatches
adversarial review, reports and commits without a human in the loop. Measured here, **23% of
all spend is subagent review** that a hand-driven session simply would not do.

So per *task* the platform will lose to a human-steered chat, and should — it is buying
autonomy, parallelism and a persistent audit trail with those tokens. The meaningful questions
are the two below, and both are now answerable:
1. Is the **overhead** (context re-transmission, duplicated docs, unbounded runs) small relative
   to the work? That was the real problem — 82% of spend was re-transmission and only 17.5%
   bought output — and it is what these rounds attacked.
2. Does a task cost roughly what the work is worth? That is what the per-task cap makes explicit
   rather than discovering it at $300.

If the goal really is *lowest tokens per outcome*, the remaining lever is not technical: run
fewer, larger tasks (each task pays the workflow's fixed cost once), keep `effort` low on
routine work, and let Auto pick the model rather than reaching for the expensive tier.

## The after-figure (measured 2026-09-04)

The note above said the real number arrives after ~20 tasks. Twenty-eight ran between
2026-08-28 and 2026-09-04 across Award Maven and Control Center. Measured, not projected:

| | Aug 21–27 | Aug 28–Sep 4 |
|---|---|---|
| completed `/task` runs | 17 | 20 |
| tokens | 1,198M | **493M** |
| cost | $626 | **$287** |
| per task | 70.4M / $36.81 | **24.7M / $14.36** |

**−65% tokens and −61% cost per task**, comfortably past the projected 30–50%. The weekly
per-task series is monotonic: 98M (W31) → 43M → 48M → 27M → **24.8M** (W35).

Decomposing tokens into *turns × context-per-turn* says which lever did it:

| | turns/task | Ktok/turn | Mtok |
|---|---|---|---|
| W33 (pre-effort — everything ran at the SDK's xhigh default) | 564 | 85 | 48.1 |
| W35 at `effort=high` (19 runs) | 452 | ~45 | **20.2** |
| W35 at `effort=xhigh` (3 runs) | 834 | ~51 | 42.6 |

**Effort routing is the whole win** — it cut turns ~20% *and* context-per-turn ~46%, and the
"low confidence" row in the projection table above was the one that paid. It also says where
the rest is: an `xhigh` run still costs what a run cost in August. Three of twenty-two runs at
xhigh consumed 26% of the week's tokens.

95.3% of tokens are now cache reads — already the 10×-discounted path, so there is no pricing
lever left at all. The bill is `turns × context` and nothing else.

## The graph nobody built (found 2026-09-04, fixed same day)

The other half of the thesis — *query the code graph instead of grepping* — was not happening.
Across the week's 28 tasks:

| Tool | Calls |
|---|---|
| Bash | 4,079 — of which **1,951 grep/find** and **2,576 cat/sed/head** |
| Read | 1,516 |
| Edit | 1,098 |
| **graphify** | **44 (1.1% of Bash)** |
| Grep/Glob tools | 0 (everything routes through Bash) |

Flat at ~1% for four straight weeks. The cause was not that agents ignored the rule — it was
that **two of five registered projects had no graph to query**: Lumii was onboarded before the
step existed, and noticine was onboarded *after* it and skipped it anyway. `ensure-graphify.sh`
is fail-soft by design (exit 0 on every failure), so neither miss left a trace.

Two fixes, both about removing the chance to skip:

1. **The platform builds the graph, not the prose.** `runner/code-graph.ts` runs
   `ensure-graphify.sh` before an `onboard` session starts — every member repo for a workspace,
   fail-soft, ceiling at `CC_CODE_GRAPH_TIMEOUT_MS` (15 min default). A skill step a model may
   skip became a launch step it cannot. The skills' own step stays for CLI-driven onboarding
   and now checks `graphify-out/graph.json` first so it doesn't refresh a large repo twice.
2. **The version pin was never enforced.** `ensure-tool.sh`'s fast no-op treats "the binary is
   on PATH" as "done", so this machine sat on graphify **0.8.36 under a 0.9.29 pin for a
   month** and every pin bump was silently a no-op. `--force` skips the no-op;
   `ensure-graphify.sh` compares versions and uses it.

**Still open:** a project onboarded *before* this lands has no graph until someone re-runs
onboard — the platform never touches an already-onboarded project's files. And a graph that
exists is still only advisory at query time; the 1% figure is what to re-measure to find out
whether building it was enough.

## Effort: capped, then uncapped again (2026-09-05, reverted 2026-09-06)

Recorded because the reasoning was wrong in an instructive way, and the table above is what
misled it.

`MAX_EFFORT` briefly capped every run at `high`, clamping explicit picks as well as `auto`.
The evidence looked strong: three `xhigh` runs took 26% of a week's tokens, at 834 turns and
42.6M each against 452 and 20.2M for `high`.

**The inference was backwards.** The user runs the Claude Code CLI at `xhigh` and it costs a
*fraction* of a platform task on the same codebase. If xhigh were the problem, that could not
be true. What the table actually shows is selection bias: `auto` routes the hardest requests to
`xhigh` (and users pick it for the ones they already know are hard), so xhigh runs are long
because the work is long — not long because they reason harder. Capping effort would have made
those runs dumber at roughly the same turn count.

Reverted in full. The tier table stands as it was: very-complex → `xhigh`, complex → `high`,
simple → `medium`, mechanical commands → `low`.

**The lesson for the next measurement:** effort correlates with cost, and does not cause it.
The causal variable is **turns**, and the CLI comparison is the control that proves it — same
model, same effort, same repo, ~10× fewer turns, because a human prunes the path that the
workflow otherwise walks in full. Every remaining saving has to come out of turn count.

### Why updating didn't help anyone but us

`control-center update` swaps `~/.control-center/app/` and runs migrations. `agents/` ships
inside that tarball, so **agent rules do propagate** — the conditional test scenarios and the
"stop re-reading CLAUDE.md" fix reached every 0.11.1 install. What does not propagate is
anything in a *project* folder, because the updater has no business writing there:

- their `CLAUDE.md`, still whatever size the old rules grew it to
- their `.swe/notes/`, `.fe/design-system.md`, `.pm/notes.md`, and existing test-scenario files
- a code graph on any already-onboarded project

That is not a rounding error. The single largest saving measured here was `CLAUDE.md`
147 KB → 13 KB, worth ~25% of this project's spend — and an updating user got exactly none of
it. Better agent behaviour, same documents, same bill.

There is also a silent path where even the rules don't arrive: `discoverAgents()` prefers a
CLI-installed plugin over the bundled copy, so anyone who installed swe/fe/pm through the
Claude Code CLI can update the app forever and keep running last month's workflow.

### What was done about it

The split is between what is mechanical and what is a judgment call, and it is not arbitrary:

| | Mechanical | Judgment |
|---|---|---|
| Missing code graph | AST extraction, no model, idempotent, gitignored output | — |
| Oversize `CLAUDE.md` | — | deciding what survives is the onboard skill's job |

So `runner/post-update.ts` builds the graphs automatically on the first boot after a version
change (stamped in `data/last-version`, scheduled *after* the server is listening, fail-soft,
`onlyMissing` so it never spends minutes refreshing a graph that already exists), and
`lib/project-health.ts` + `components/ProjectHealthNudge.tsx` measure the documents against the
budgets the rules already state and put the number in front of the user with a Re-onboard link.
A script that truncated a `CLAUDE.md` would destroy the thing the file exists to carry.

Plugin versions were bumped (swe 0.9.0, fe 0.5.0, pm 0.6.0) — the rules changed twice in
August without one, and `tasks.agent_version` exists precisely so history can tell which
version did the work. Bump it when the rules change, not only when the commands do.

**Known limit:** the graph backfill is a courtesy, not a guarantee. The stamp is written
*before* the pass runs, so a crash mid-build doesn't make every future boot retry it — the user
re-onboards instead.

## Going after turns instead (2026-09-06)

Given that turns are the causal variable, two changes that remove turns rather than shrink them.

### The plan gate is now sized to the change

Phase 2 said *"Every request gets a plan — no matter how small"* and Phase 3 verifies every
checklist item separately. Together those turn a ten-line fix into six gated build-verify
cycles. Phase 4 had already learned this lesson — it scales the review lenses to the actual
diff — so Phase 2 now uses the same shape: a change touching ≤2 files and ~50 lines, in none
of the sensitive areas, with one obvious approach, gets a one-line goal, a single checklist
item and **no gate 1**. Everything else gates as before, and **gate 2 (report) is never
skipped** — nothing reaches a commit unreviewed.

Ambiguity resolves toward gating: a needless gate costs one round trip, a needless rewrite
costs the run. For fe there is an extra always-gate condition — a new component or token is a
design decision whatever its line count.

No platform change was needed. The proposal gate was always optional in the runner's state
machine (`awaiting_proposal` is one status among several); only the report gate is load-bearing.

### Grep sweeps are held until the graph has been asked

`agents/*/hooks/guard-search.mjs`, a `PreToolUse(Bash)` hook next to the existing
`guard-commit.mjs`. Rule 17 had told agents to query the graph since the graph existed, and the
measured result was 44 graphify calls against 1,951 grep/find calls — 1.1%, flat for four
weeks. Prose lost.

The design constraint that shaped it: **it must be impossible to trap the agent.** A hard block
gives blocked → graphify → no answer → same grep → blocked → forever. So it holds each
*distinct* search once per session (keyed on session id + a hash of the command, in a temp
file); re-run the same command and it passes. Worst case is one wasted turn per question, and
the agent always has a way forward.

Scope is deliberately narrow, since a false positive makes the agent fight its own tools:
recursive `grep`, bare `rg`, `find -name` only, only as the *leading* stage of a pipeline (so
`git log | grep fix` is a filter, not a sweep), and only in a repo that has
`graphify-out/graph.json`. Fail-open on everything else. 21 cases in
`hooks/test-guard-search.mjs`.

Verified plugin hooks actually reach a platform run before building on the assumption: the SDK
types say a local plugin contributes "commands, agents, skills, and hooks"
(`SdkPluginConfig`), and the runner loads each agent that way. Worth checking, because the
recorded hook events in the database are all `SessionStart` — those come from the user's own
`~/.claude` settings, and their presence says nothing about plugin hooks either way.

**What to measure next.** Re-run the tool histogram after ~20 tasks. The number that matters is
graphify's share of Bash calls (1.1% today) and, downstream of it, turns per task (452 at
`high`). If turns don't fall, the sweeps were not what was driving them and the next candidate
is Phase 4's subagent review, still 23% of spend.
