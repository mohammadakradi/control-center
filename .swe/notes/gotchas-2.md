# gotchas

Dated gotcha log: non-obvious traps, environment quirks, and things that cost time.

Part 2 of 2.

<!-- Split out of a single 232 KB `.swe/notes.md` on 2026-08-24, which was read in full at the start of every request (engineering rule 10). Entries are verbatim and in date order; only this header is new. -->

- **2026-08-17 — an update attempt now leaves a record** (pm task
  `01-backend-update-pipeline-observability`, `.pm/tasks/20260817-191237-fix-update-button/`).
  `POST /api/updates/apply` spawned the detached `control-center update` with `stdio: "ignore"`,
  so the download, the checksum, `pnpm install`, `next build` and every `die` message went
  nowhere. The dashboard could only watch for a version number that never changed and time out
  after six minutes. Now each attempt writes `logs/update.log` (whole run) and
  `run/update.status` (`key=value`: state, pid, from, target, startedAt, endedAt, message), and
  `GET /api/updates` reports it as `run`. `components/UpdateBanner.tsx` is untouched — the fe
  task `02` consumes it.
  - **`die` is the single funnel for every failure in that script**, which is what makes the
    record cheap: no per-step bookkeeping, and `record_update failed "$*"` there catches
    "couldn't reach GitHub Releases", "checksum mismatch", "dependency install failed", "build
    failed" and "no install found" with the message a human would have read on a terminal. It is
    a no-op unless `UPDATE_ATTEMPT` is set, so `check_and_update` on the `start` path
    deliberately records nothing.
  - **Only the shell can know the outcome, and only the reader can know it's a lie.** A death
    `set -e` handles — a bare `tar`/`mv` failing — never reaches `die`, so it records nothing and
    the file keeps saying `running`. `readUpdateRun` therefore *derives* `crashed` from a
    `running` record whose pid is gone. That derivation, not a timeout, is what tells the UI an
    update stopped.
  - **A pipeline exits with `tee`'s status.** A manual `control-center update` tees so the
    terminal still shows progress, which silently turned every failure into `exit 0` until
    `cmd_update` took its exit code from the record instead (`succeeded|up-to-date` → 0, anything
    else → 1). The route path doesn't tee — it passes `CC_UPDATE_LOG` to say "your stdout is
    already this file", or every line lands twice.
  - **The tee branch depends on being able to write both files**, so it's skipped when `$LOG_DIR`
    or `$RUN_DIR` isn't writable (`mkdir -p` is happy with a directory that already exists — a
    root-owned `logs/` from a stray sudo). Otherwise `tee` fails to open its file and kills the
    update with a silent SIGPIPE, and an unwritable `run/` fails an update that *worked*, since
    the exit code is read back from the record. Found by re-reading my own diff, not by a test.
  - **Measured rather than assumed: the restart doesn't hold the log open.** `spawn()` redirects
    each child to its own log, and Node hands a child only fds 0–2, so `tee` sees EOF (a manual
    update returns instead of hanging) and `update.log` stops growing once the swap is done. The
    correctness reviewer reproduced the same thing independently, and also verified that
    `sh -c "…"` execs without forking, so `child.pid` really is the `$$` the script records —
    which the whole `crashed` derivation rests on.
  - **The security audit found three holes, all in the file reader, and every one needed a
    different check.** The first version had `O_NOFOLLOW` and nothing else:
    - `O_NOFOLLOW` guards only the **final** component, so pointing `logs` itself at another
      directory redirected the read — a planted file came back in `logTail`, over a route with no
      auth. Answered by resolving *after* opening and requiring containment **by inode**
      (`isSameSoleFile`), since re-checking the path alone loses the swap-it-back race.
    - a **hard link** at `logs/update.log` has no target to resolve, so realpath swears it lives
      where it appears — and `~/.control-center/.env`, which holds `SECRETS_MASTER_KEY`, is on
      the same filesystem. Answered by `nlink === 1`.
    - a forged `state=running` naming a **live** pid (the PoC used `pid=1`) wedged
      `POST …/apply`'s "one at a time" refusal permanently — and pid recycling after a reboot
      gets there without an attacker. Answered by an age ceiling: a `running` record older than
      an hour reads as `crashed`. An hour, not minutes, because being wrong the *other* way
      starts a second update beside a live one, racing its `mv` on `app/`.
    This reader is deliberately **stricter than `readBytesInside`**: it refuses a symlink
    standing in for either file even when the link stays inside the root, because inside *this*
    root are `.env` and the token vault. `isInside` is now exported from `lib/safe-read.ts`
    rather than reimplemented — one definition of "below".
  - **The age ceiling needed a floor, and the re-audit found that too.** `now - startedAt <
    RUNNING_MAX_AGE_MS` is satisfied by any *negative* age, so a record dated a century ahead
    wedged the apply route exactly as before — one file write, no race. Now the age has to fall
    inside a window. The floor is **not** a flat `age >= 0`, which is what was suggested: both
    stamps come from the same clock, but that clock can step backwards mid-update, and
    disbelieving a live run is the direction that starts a second `apply_update`. Five minutes
    of tolerance costs nothing an attacker doesn't already have — a forgery can claim
    `startedAt = now` and hold for the full hour regardless, so the worst case moves from 1h to
    1h05m rather than becoming unbounded.
  - **Accepted residual — and the variant that survives is a `rename`, not a link.** The
    re-audit defeated the post-open containment check by opening through a symlinked `run`, then
    *renaming* that same inode into the contained path and restoring the real directory before
    the recheck. `rename` moves the sole name rather than adding a second one, so `nlink` stays
    1 and both `isInside` and `isSameSoleFile` pass. Worth stating that way round: a hard-link
    test does **not** cover this residual, so don't let one look like it does. Demonstrated with
    an injected pause; an unassisted timing reproduction was inconclusive. Not fixed, for the
    reasons this journal already gives twice — a sound version needs the parent held as a
    descriptor (`openat`/`O_PATH`), which Node does not expose — and the precondition is local
    write access to `~/.control-center`, where the same writer, as the same OS user, can read
    the target directly. Defence in depth, not a perimeter.
  - **The status file is parsed as untrusted input** (another process writes it, in shell, and
    the API serves it): size-capped, first-occurrence-wins on keys, an unrecognised `state`
    discards the whole record, and the log that gets tailed is always the canonical path, never
    one read *out of* the file — that would have been an arbitrary-file-read primitive. `logTail`
    rides along only for `failed`/`crashed`.
  - **Watch the harness before trusting a probe** — twice, in one task. My first run of the
    test-scenario commands reported "refused" for all four plants, because host `mktemp -d` lands
    in `/var/folders`, which the container doesn't mount, and because `npx tsx -e '…' arg` does
    **not** pass `arg` as `process.argv[2]` (`CC_HOME` has to arrive via `docker exec -e`). Both
    the plants *and* a legitimate control read `null`. Later, a shell probe using brace expansion
    (`mkdir -p /tmp/x/{a,b}`) silently created nothing under dash and still printed its own
    "planted" line. A probe that can't distinguish "refused" from "never ran" is not evidence:
    run the control first, and make the harness fail loudly.
  - Left knowingly (filed, not fixed): `control-center start`'s `check_and_update` shares no lock
    with this path, so opening the app while an in-app update runs can still put two
    `apply_update`s on the same `app/`. The 409-equivalent only covers the button.
    **Done 2026-08-18** — see the update-lock entry below.
