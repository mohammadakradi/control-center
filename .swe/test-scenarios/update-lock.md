# Test scenario: one update at a time (the update lock)

_Task: `control-center update` and `control-center start` now share a lock around
`apply_update()`, so opening the app mid-update can no longer put two swaps on the same
`app/` · 2026-08-18_

## Setup / preconditions

- No real install or network is needed: everything below runs the repo's script against a
  **throwaway** fake install. Build one:

  ```sh
  ROOT=$(mktemp -d) && mkdir -p "$ROOT/cc-home/app" "$ROOT/bin"
  printf '{"version":"9.9.9"}\n' > "$ROOT/cc-home/app/package.json"
  printf '#!/bin/sh\nprintf %%s %s\n' "'{\"tag_name\":\"v0.0.1\"}'" > "$ROOT/bin/curl"
  chmod +x "$ROOT/bin/curl"
  alias cc='CC_HOME="$ROOT/cc-home" CC_NO_OPEN=1 PATH="$ROOT/bin:$PATH" sh infra/release/control-center.sh'
  ```

  The stubbed `curl` answers every release check with `v0.0.1` (older than the fake install's
  `9.9.9`), so `update` exercises the whole lock path and never downloads anything.

## Happy path

1. Simulate an update in flight — a lock held by a live process (your shell):

   ```sh
   mkdir -p "$ROOT/cc-home/run/update.lock"
   printf '%s %s\n' "$$" "$(date +%s)" > "$ROOT/cc-home/run/update.lock/owner"
   ```

2. Try to update on top of it: `cc update; echo "exit=$?"`
   - **Expected:** `exit=1` and `error: another update is already in progress (pid <your shell's pid>). Watch it with: tail -f …/logs/update.log`. The run is also recorded:
     `grep state "$ROOT/cc-home/run/update.status"` shows `state=failed` — this is what the
     app's banner shows when the button loses the race.

3. Try to start on top of it: `cc start --no-update; echo "exit=$?"`
   - **Expected:** `exit=1` and `error: an update is in progress (pid …) — it restarts the app
     itself when it finishes.` Nothing was spawned (`ls "$ROOT/cc-home/run"` has no
     `web.pid`/`runner.pid`), and the in-flight update's lock is untouched.

4. Simulate that update dying uncleanly (`kill -9`, reboot) — point the lock at a dead pid:

   ```sh
   printf '%s %s\n' 99999999 "$(date +%s)" > "$ROOT/cc-home/run/update.lock/owner"
   cc update; echo "exit=$?"
   ```

   - **Expected:** `exit=0`, "Already on the latest release (9.9.9)", and the stale lock was
     reclaimed and released: `ls "$ROOT/cc-home/run"` no longer shows `update.lock`. A crashed
     update can never wedge future ones.

## Edge / failure cases

1. A lock whose process is alive but ancient (recycled pid after a reboot):

   ```sh
   mkdir -p "$ROOT/cc-home/run/update.lock"
   printf '%s %s\n' "$$" "$(( $(date +%s) - 7200 ))" > "$ROOT/cc-home/run/update.lock/owner"
   cc update; echo "exit=$?"
   ```

   - **Expected:** `exit=0` — a live pid does not hold the lock past the one-hour ceiling.
     (`kill -0` can't prove the pid is still *an update*, so age is what bounds a recycled one.)

2. A garbage owner file must read as stale, not crash the shell:

   ```sh
   mkdir -p "$ROOT/cc-home/run/update.lock"
   printf 'not-a-pid whenever\n' > "$ROOT/cc-home/run/update.lock/owner"
   cc update; echo "exit=$?"
   ```

   - **Expected:** `exit=0`, lock reclaimed. (Unvalidated arithmetic on that field would kill a
     POSIX shell outright — one stray write turning into "updates never run again".)

3. A failed update releases the lock on its way out — make the release check unreachable:

   ```sh
   printf '#!/bin/sh\nexit 1\n' > "$ROOT/bin/curl"
   cc update; echo "exit=$?"
   ```

   - **Expected:** `exit=1`, `couldn't reach GitHub Releases`, `state=failed` in
     `run/update.status`, and **no** `update.lock` left behind.

4. Clean up: `rm -rf "$ROOT"` and drop the alias (`unalias cc`).

The same assertions run automatically: `docker exec platform env -u RUNNER_HOST npx tsx --test
infra/release/control-center.test.ts` (14 specs, part of `pnpm test` — including two genuinely
concurrent updates racing the same lock, and the updater's own restart being let through).

## What success looks like

While an update is genuinely running, a second `update` and any `start` refuse loudly, naming
the holder's pid and the log to watch — and the moment an update finishes, dies, or its record
goes stale, the next attempt goes straight through. On a real install the visible behavior is:
click **Update now**, quit the Mac app, reopen it immediately — the window waits and reconnects
to the updated server instead of racing the swap (worst case before this: no `app/` directory
left at all).
