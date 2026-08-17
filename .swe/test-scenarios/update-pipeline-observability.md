# Test scenario: an update attempt records what it did

_Task: `POST /api/updates/apply` spawned a detached `control-center update` with
`stdio: "ignore"`, so the download, the checksum, `pnpm install`, `next build` and every `die`
message went nowhere — a failure halfway through left no trace and the dashboard could only
poll for a version number that never changed, then time out ·
`.pm/tasks/20260817-191237-fix-update-button/01-backend-update-pipeline-observability.md` ·
2026-08-17_

## What changed

Every attempt now leaves two records under `~/.control-center`:

- `logs/update.log` — the whole run, truncated per attempt. Also tailed by `control-center logs`
  once it exists.
- `run/update.status` — one `key=value` per line: `state` (`running` / `succeeded` / `failed` /
  `up-to-date`), `pid`, `from`, `target`, `startedAt`, `endedAt`, `message`.

`GET /api/updates` reports it as `run`, with `state: "crashed"` derived when a record claims
`running` but its process is gone, `stale` when the attempt targeted a version already
installed, and `logTail` on failures only. `POST /api/updates/apply` points the child's
stdout/stderr at that log, sets `CC_UPDATE_LOG` (so the script doesn't tee a second copy), and
refuses to start a second attempt while one is live. `components/UpdateBanner.tsx` is
**unchanged** — consuming this is frontend task `02`.

## Setup / preconditions

The interesting paths are in the *installed* app, not the dev checkout (a checkout answers
`packaged: false` and `POST /api/updates/apply` refuses it by design). Nothing below needs a
real release to exist, and nothing below updates your install — the stub in "Happy path"
replaces `apply_update` so no files are swapped.

```sh
cd /Users/moh/Dev/agent/platform
SCRIPT=infra/release/control-center.sh
```

## Happy path

1. **A failure is recorded, and says which step failed.** Point the script at a scratch home
   with no install:

   ```sh
   H=$(mktemp -d); CC_HOME=$H HOME=$H sh "$SCRIPT" update; echo "exit=$?"
   cat "$H/run/update.status"; echo; cat "$H/logs/update.log"
   ```

   - **Expected:** `exit=1`. The status file says `state=failed` with
     `message=no install found at …`, a `startedAt`/`endedAt` pair, and the same error is in
     `logs/update.log` — while still being printed to your terminal (a manual run tees).

2. **A run that finishes records success, with the version it installed.** Stub out the parts
   that need the network and a real install:

   ```sh
   H=$(mktemp -d); mkdir -p "$H/app"; printf '{"version":"0.6.0"}' > "$H/app/package.json"
   sed -e "s|^latest_release() {|latest_release() { printf 'v99.0.0'; return 0; }\nunused() {|" \
       -e "s|^running() {.*|running() { return 1; }|" \
       -e "s|^apply_update() {|apply_update() { info 'pretend we swapped app/'; }\nunused2() {|" \
       "$SCRIPT" > "$H/cli.sh"
   CC_HOME=$H HOME=$H sh "$H/cli.sh" update; echo "exit=$?"; cat "$H/run/update.status"
   ```

   - **Expected:** `exit=0`, `state=succeeded`, `from=0.6.0`, `target=99.0.0`, `endedAt` filled
     in. Replace the `apply_update` stub body with `false` (a failure that dies without
     recording anything, the way a `set -e` death does) and re-run: `exit=1` and the record is
     left at `state=running` — which is exactly the case the reader turns into `crashed`.

3. **Nothing to do is its own state.** Same stub, but claim to be ahead of the real release —
   drop the `latest_release` override and set the fake version to `99.0.0`:

   ```sh
   H=$(mktemp -d); mkdir -p "$H/app"; printf '{"version":"99.0.0"}' > "$H/app/package.json"
   CC_HOME=$H HOME=$H sh "$SCRIPT" update; echo "exit=$?"; cat "$H/run/update.status"
   ```

   - **Expected:** "Already on the latest release (99.0.0).", `exit=0`, `state=up-to-date`,
     and `target` is the real latest release. (This one does reach GitHub.)

4. **The API reports it.** With the dev container up (`pnpm dev`), the checkout deliberately
   reports nothing:

   ```sh
   curl -s localhost:3001/api/updates | python3 -m json.tool | grep -A2 '"run"'
   ```

   - **Expected:** `"run": null` — a checkout has no install to update. Against a real install
     (`http://localhost:7373/api/updates`) the same field carries the record from step 1/2 of
     whatever that install last attempted, or `null` if it never has.

5. **End to end in the real app** (only if you actually want to update): open the app, click
   **Update now** in the banner, and while it runs:

   ```sh
   tail -f ~/.control-center/logs/update.log
   watch -n1 cat ~/.control-center/run/update.status
   curl -s localhost:7373/api/updates | python3 -m json.tool | grep -A9 '"run"'
   ```

   - **Expected:** the log fills with download → checksum → dependency install → build output,
     each line **once** (the route captures it; the script doesn't tee a second copy). The
     status goes `running` → `succeeded`, and the API's `run.state` follows it. The banner
     behaves exactly as it does today — it doesn't read `run` yet.

## Edge / failure cases

1. **A second click doesn't start a second update.** While an attempt is live:

   ```sh
   curl -s -X POST localhost:7373/api/updates/apply -H 'content-type: application/json' -d '{}'
   ```

   - **Expected:** `200` with `"started": false, "alreadyRunning": true` and a message naming
     the target version. Deliberately not a 409: the caller asked for the pending release to be
     applied and it is being applied, and the current banner's "not ok" branch would otherwise
     show an error for something that is working. Two concurrent `apply_update`s race each
     other's `mv` on `app/` and can leave no app directory at all, so this refusal is not
     overridable by `force`.

2. **A dead attempt doesn't block the next one.** Kill an update mid-run
   (`pkill -f 'control-center.sh'`), then read the API.

   - **Expected:** `run.state` is `"crashed"` (not `running`) with `logTail` carrying the last
     lines it printed, and a fresh `POST …/apply` starts normally. Same outcome if the pid is
     merely *stale* — a record that claims `running` is only believed for an hour, because pid
     numbers get recycled and a reboot can leave one naming a pid something else now owns.
     Check the ceiling without waiting an hour:

     ```sh
     printf 'state=running\npid=1\nfrom=0.5.0\ntarget=0.6.0\nstartedAt=1000\nendedAt=\nmessage=\n' \
       > ~/.control-center/run/update.status
     curl -s localhost:7373/api/updates | python3 -m json.tool | grep '"state"'
     ```

     `"state": "crashed"` — pid 1 is alive and owns nothing of ours, and the record is from
     1970. Before the ceiling existed this read as `running` and refused every retry forever.

3. **A stale failure goes quiet on its own.** Take a `state=failed` record whose
   `target` is a version you now run (e.g. because `control-center start` applied it later):

   ```sh
   printf 'state=failed\npid=1\nfrom=0.5.0\ntarget=0.6.0\nstartedAt=1\nendedAt=2\nmessage=x\n' \
     > ~/.control-center/run/update.status
   curl -s localhost:7373/api/updates | python3 -m json.tool | grep -E '"state"|"stale"'
   ```

   - **Expected:** `"state": "crashed"` (pid 1 isn't the updater) and `"stale": true` — the
     record targets a version that is already installed, so a UI can ignore it instead of
     reporting a failure forever.

4. **A planted file can't turn the reader into a file-read primitive.** Three plants, three
   different checks — all three were live holes in the first version of this and were found by
   the security audit. Note what is inside the root being defended: `~/.control-center/.env`
   holds `SECRETS_MASTER_KEY`, and `logTail` is served by an unauthenticated route.

   Two things to get right or every line below lies to you: the scratch dirs must be somewhere
   the container actually mounts (`$HOME` is under `/Users`; a host `mktemp -d` lands in
   `/var/folders`, which is **not** mounted, so everything reads as `null` for the wrong
   reason), and `CC_HOME` must arrive through `docker exec -e` — `npx tsx -e '…' arg` does not
   pass `arg` as `process.argv[2]`.

   ```sh
   read_it() { docker exec -e CC_HOME="$1" platform npx tsx -e '
     import { readUpdateRun } from "./lib/update-run";
     const r = readUpdateRun();
     console.log(r === null ? "null" : `${r.state} logTail=${JSON.stringify(r.logTail)}`);'; }
   REC='state=failed\npid=1\nstartedAt=1\nmessage=x\n'
   mk() { mktemp -d "$HOME/cc-probe.XXXXXX"; }

   # e) the control FIRST, or a broken harness looks like a passing test
   E=$(mk); mkdir -p "$E/run" "$E/logs"; printf "$REC" > "$E/run/update.status"
   printf 'ordinary log line\n' > "$E/logs/update.log"; read_it "$E"

   # a) a symlink in place of the record — refused whether it points inside the root or out
   A=$(mk); mkdir -p "$A/run" "$A/logs"; printf "$REC" > "$A/planted"
   ln -s "$A/planted" "$A/run/update.status"; read_it "$A"

   # b) a symlinked directory *above* the file — O_NOFOLLOW alone walks straight through it
   B=$(mk); OUT=$(mk); mkdir -p "$B/run"; printf "$REC" > "$B/run/update.status"
   echo "SECRET the log never held" > "$OUT/update.log"; ln -s "$OUT" "$B/logs"; read_it "$B"

   # c) a hard link — no target to resolve, so only the link count sees it
   C=$(mk); mkdir -p "$C/run" "$C/logs"; printf "$REC" > "$C/run/update.status"
   echo "SECRETS_MASTER_KEY=hunter2" > "$OUT/secret"; ln "$OUT/secret" "$C/logs/update.log"
   read_it "$C"

   # d) a FIFO — the read must return, not wait for a writer
   D=$(mk); mkdir -p "$D/run" "$D/logs"; printf "$REC" > "$D/run/update.status"
   mkfifo "$D/logs/update.log"; read_it "$D"

   rm -rf "$A" "$B" "$C" "$D" "$E" "$OUT"
   ```

   - **Expected:** (e) `failed logTail="ordinary log line"` — the legitimate read still works,
     which is what makes the rest meaningful. (a) `null` — a symlink never stands in for the
     record, contained or not
     (deliberately stricter than `lib/safe-read.ts`'s `readBytesInside`, which allows an
     internal link: there, the root is a project tree; here it holds the token vault).
     (b), (c) and (d) all `failed logTail=null` — the record itself still reads, and **none** of
     the planted content comes out. (d) returns in well under a second rather than hanging.
     All five are covered by specs in `lib/update-run.test.ts`; (b) and (c) were live holes
     until the audit found them, and each needs a different check — containment against the
     *resolved* path for (b), the link count for (c), since realpath cannot see a hard link.

5. **A corrupt record is no record.** `printf 'state=exploded\npid=1\n' >
   ~/.control-center/run/update.status`, then read the API.

   - **Expected:** `"run": null` — only the four states the shell writes are accepted, and an
     unrecognised one discards the whole record rather than being reported as something
     invented. Same for a file over 8 KB, or one that isn't `key=value` at all.

6. **`control-center logs` includes the update log** once one exists, and still works when it
   doesn't: `control-center logs | tail -5`.

## What success looks like

A failed update names the step that failed, in an HTTP response and in a log file, within
seconds of failing — instead of six minutes of polling ending in "quit and open it again". A
successful one says so. A run that died leaves a record that says *that*, and doesn't block the
retry. And `control-center update` typed into a terminal behaves exactly as it did before, with
progress on screen and a non-zero exit when it fails.
