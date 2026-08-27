# log releases

Dated log of the release/update path — the lock, and getting a published release to a running window.

Part 1 of 2.

<!-- Split out of a single 232 KB `.swe/notes.md` on 2026-08-24, which was read in full at the start of every request (engineering rule 10). Entries are verbatim and in date order; only this header is new. -->

## 2026-08-18 — the update path is serialized by a real lock (`run/update.lock`)
Picked up the backlog item the 2026-08-17 task filed. Both entry points that reach
`apply_update()` — `update_run` (the `update` command / the app's button) and
`check_and_update` (the `start` path) — now take a `mkdir`-based lock; `cmd_start` refuses at
entry while another process holds it live. Decisions worth keeping:
- **`mkdir` is the primitive, not `flock`**: atomic on POSIX filesystems, exists everywhere the
  script's own constraints allow (pure POSIX sh, bash 3.2, no jq/flock assumption). The owner
  file inside holds `pid startedAt`.
- **Staleness deliberately mirrors `readUpdateRun`'s rules** (dead pid, or age outside
  −5 min … 1 h): the two mechanisms answer the same question ("is an update actually in
  flight?") and diverging answers would reintroduce the confusion this exists to remove. Same
  known trade, too: `kill -0` can't verify pid *identity*, so a recycled pid reads as alive —
  bounded to the hour by the ceiling, exactly like the status file. The future-dated floor is
  there for the same reason it's on the reader: `age < ceiling` alone is satisfied by any
  negative age, so a file dated next century would hold the lock forever.
- **Numeric validation before `$(( ))` is load-bearing in sh.** An arithmetic expansion over a
  garbage owner field is a *fatal* error in a non-interactive POSIX shell — one stray write to
  `run/update.lock/owner` would have turned every future `update` and `start` into an instant
  death. `case "$lock_pid$lock_started" in '' | *[!0-9]*)` guards it; there's a spec.
- **Stale reclaim is rename-then-recreate with a read-back**, because two processes can meet
  the same stale lock: only one `mv` wins (atomic), but the loser's `mv` can still steal a
  directory the winner just recreated — so "holding the lock" is defined as *the owner file
  reads back your pid*, checked as the last step of `acquire_update_lock`. Callers treat a
  false return as "someone else has it", never retry-loop.
- **The lock is held through the update's own restart, and `cmd_start` lets its own `$$`
  through.** That's what closes the double-spawn the filed item called out (`stop_all` runs
  mid-update, so the update's restart and a user's reopen could each spawn a web+runner pair —
  the "partially running" guard reads pid files and can't see it). Works through the manual
  path's `tee` pipeline too: `$$` is the main shell's pid in a subshell, unchanged.
- **`start` refuses rather than waits** during someone else's update: if the server was running
  when the update began, the update restarts it itself (`was_running`), so the Mac app window
  reconnects on its own — including the quit-and-reopen sequence, since quitting runs `stop`
  but `was_running` was captured earlier. Waiting would mean a start that blocks for minutes on
  `next build` with no output.
- **A lock refusal on the button path is *visible*, not silent**: `update_run` sets
  `UPDATE_ATTEMPT` before acquiring, so losing the lock funnels through `die` →
  `record_update failed` and the banner shows "another update is already in progress (pid N)"
  with the log path. `die` also releases the lock owner-checked, so it's a no-op for every
  death that never took it.
- **Both independent reviews came back CHANGES_REQUIRED on the first cut, and both were right —
  the naive `mkdir`+owner-write lock had two blocking bugs.** Fixed; each has a spec that fails
  when reverted:
  - **Double-acquire (both reviewers; correctness reviewer measured ~46% on the bare
    functions).** `mkdir` winning and writing the `owner` file are two steps, and a racer that
    hit the gap saw an ownerless directory, judged it *stale*, and reclaimed it out from under
    the winner — then both wrote their own pid and both read it back. Fix: **the O_EXCL create
    of `owner` (`set -C`) is the token**, not the `mkdir`. A process whose directory was
    reclaimed under it fails that create and yields (never clobbers, never double-owns), and an
    ownerless/malformed lock is deliberately **not** stale — `acquire_update_lock` waits one
    beat and re-checks, so a racer mid-claim is left alone while a genuine corrupt leftover
    still self-heals.
  - **Arbitrary-file clobber via a symlink at `owner` (security auditor, reproduced against a
    stand-in `.env`).** The plain `>` redirect followed a planted symlink and truncated the
    target — `~/.control-center/.env` (the master key) being the prize. The same O_EXCL create
    refuses an existing path, symlink included, so it can't be redirected. `dd`-based,
    regular-file-only owner read (below) covers the read side.
  - **Oversized-numeric owner field crashes dash (correctness reviewer).** The digit-only guard
    didn't bound *magnitude*, so an all-digit value too big for a 64-bit int made `kill -0` and
    `$(( ))` **fatal** under dash — bypassing `die`, leaving the lock, and crashing every future
    `start`/`update`. (Invisible on macOS bash 3.2, which wraps instead of dying — so the
    original macOS smoke test couldn't have caught it; the container/dash side is where it
    bites.) Fix: reject fields longer than 18 digits in `update_lock_fields` before either is
    evaluated.
  - **Unbounded owner read (security auditor).** `cat` of the owner file into a shell variable
    was a CPU/memory DoS on every `start`/`update` (measured 4.4s for a 50 MB file). Now a
    regular-file-only, byte-capped `dd` (a symlink or FIFO at `owner` is refused outright, so it
    can't leak another file or block on a pipe).
- **A second security round found a *reclaim* TOCTOU distinct from the create-side gap, and it
  needed no attacker.** The staleness check and the reclaim `mv` are not one atomic step. If
  process B reclaims a dead lock and re-acquires it (fresh `mkdir` + O_EXCL owner) while process
  C — which read the same dead state a moment earlier — is delayed before *its* `mv`, C's
  unconditional `mv "$UPDATE_LOCK_DIR" …` moves B's brand-new **live** lock aside and `rm -rf`s
  it, then C re-creates its own — two holders, both entering `apply_update`. O_EXCL doesn't help
  here: C destroys the directory rather than writing into it. Realistic trigger: a crashed
  update leaves a dead-pid lock, then two ordinary commands race it (retry `update` while
  `start`'s `check_and_update` also fires). Fixed by making the reclaim **verify the snapshot it
  took**: after the atomic `mv` aside, re-judge that copy with `update_lock_alive "$aside"` — if
  it's live, a racer re-acquired in the gap, so `mv` it back and yield rather than dropping a
  legitimate holder; only a still-not-live copy is dropped. `update_lock_owner`/`_fields`/`_alive`
  gained an optional directory argument so the aside copy can be judged the same way as the live
  lock. Verified with the auditor's own method (byte-verbatim functions + an injected pre-`mv`
  delay): fixed → 5/5 one-winner; the same delay with the post-`mv` verify removed → 3/3 a live
  lock stolen. Like the create-side gap, this exact race isn't deterministically reachable
  against the unmodified script offline, so it rests on that bracketed reproduction plus the
  soundness argument.
- **Residual the fix does *not* close, and why it's acceptable:** a same-uid attacker who can
  `SIGSTOP` our process inside the microsecond `mkdir`→owner-write gap can still force a reclaim
  or a wedge — and the reclaim's own restore step (`mv "$aside"` back) has a tertiary window
  where a *third* process could re-`mkdir` the path first. The restore `mv` then **nests** the
  aside copy inside the new lock rather than failing (verified on both GNU and BSD `mv` by the
  final audit — `mv dir existing-dir` nests, exit 0, it never clobbers): the third process's
  fresh lock is untouched, the nested copy is harmless cruft removed with the lock, but the
  earlier re-acquirer still wrongly believes it holds. Both windows are far narrower than the
  two-process reclaim race above (needing a precise multi-way coincidence or a deliberate
  `SIGSTOP`), and — if an attacker plants a **FIFO** at `owner` in the create gap — the O_EXCL
  owner write
  (`set -C; > owner`) *blocks* rather than failing fast, hanging the acquiring process until a
  reader appears (open-for-write on a FIFO blocks; the read side is already safe — `dd` never
  runs on a non-regular file). This is the codebase's standing local-write threat trade (`run/`
  is the user's own directory; the same attacker can `rm -rf app/` directly), and the O_EXCL
  token means even a won reclaim ends with exactly one owner, not two. Recovery from a wedge or
  a hang is `rm -rf ~/.control-center/run/update.lock` (and killing the hung process).
- **`infra/release/control-center.test.ts` is the script's first automated coverage** (the
  2026-08-12 note "no automated test harness covers this script" is now stale). 13 specs run
  the real script under `/bin/sh` against a throwaway `CC_HOME` with **`curl` stubbed on
  `PATH`** — `up-to-date` (v0.0.1 vs the fake install's 9.9.9) exercises every lock transition
  with no download; `unreachable` (exit 1) makes `die`/release observable; `newer` (v99.0.0 +
  failing download) drives the `start`/`check_and_update` acquire+release; `slow` (a paused
  answer) forces genuine two-process overlap. The glob was added to the `test` script (exact).
  **Which races the harness can and can't reach, stated honestly:** the oversized-field crash,
  the reclaim-path symlink safety, and exclusion-under-a-held-lock are deterministic and each
  falsifiable (verified by reverting the fix). The sub-millisecond `mkdir`→owner-write gap — the
  46% double-acquire and the fresh-gap clobber — **can't** be hit deterministically without
  instrumenting the production script, so those rest on the O_EXCL-token construction plus the
  reviews, not on a timing test. Also smoke-tested on macOS `/bin/sh` (bash 3.2).
- **Residual, documented not fixed:** an `update` *initiated* mid-way through an already-running
  `start`'s migrate/build phase isn't serialized — `check_and_update` only takes the lock when
  it has an update to apply, and `cmd_start` doesn't hold one for its whole body. Far narrower
  than anything in the filed item (needs a human running `update` during a start's build), and
  locking all of `start` would make the update button answer "another update is in progress"
  during every slow first boot.
