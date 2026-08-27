#!/bin/sh
# control-center — run, stop and update a local Control Center install.
#
# Installed to ~/.local/bin/control-center by install.sh. Pure POSIX sh + curl + tar, because
# the only thing an installed app may assume is Node 22+ (no Docker, no pnpm on PATH, no bash,
# no jq).
#
# `start` asks GitHub for the latest release first and updates before launching — that is the
# update path. The app itself only *reports* that a newer release exists (lib/updates.ts); the
# process that swaps the files can't be the process being swapped.
#
# Layout under ~/.control-center:
#   app/      the unpacked release — replaced wholesale on update
#   data/     sqlite db, encrypted token vault, uploads — never touched by an update
#   logs/     web.log, runner.log
#   run/      pid files
#   .env      SECRETS_MASTER_KEY and friends
set -eu

REPO="${CC_REPO:-mohammadakradi/control-center}"
CC_HOME="${CC_HOME:-$HOME/.control-center}"
APP_DIR="$CC_HOME/app"
DATA_DIR="$CC_HOME/data"
LOG_DIR="$CC_HOME/logs"
RUN_DIR="$CC_HOME/run"
ENV_FILE="$CC_HOME/.env"
# What an update attempt leaves behind: the whole run, and its outcome. Read back by
# lib/update-run.ts for /api/updates — see "update-attempt bookkeeping" below.
UPDATE_LOG_FILE="$LOG_DIR/update.log"
UPDATE_STATUS_FILE="$RUN_DIR/update.status"
# This script's own path, so `update` can replace the installed command with the new version.
case "$0" in
  /*) SELF="$0" ;;
  *) SELF="$(cd "$(dirname "$0")" 2>/dev/null && pwd)/$(basename "$0")" ;;
esac
# Loopback-only, on ports nothing else tends to want. 3001/4319 are the *development*
# container's ports, and a dev checkout running beside an install used to mean whichever
# bound first won — the app would silently attach to the other one's server.
PORT="${CC_PORT:-7373}"
RUNNER_PORT="${CC_RUNNER_PORT:-7374}"
URL="http://localhost:$PORT"
WAIT_TIMEOUT="${CC_WAIT_TIMEOUT:-180}"
MIN_NODE_MAJOR=22

info() { printf '%s\n' "$*"; }
warn() { printf '%s\n' "$*" >&2; }
die() {
  printf 'error: %s\n' "$*" >&2
  # Every failure in this script funnels through here, which makes it the one place an update
  # attempt can record *why* it stopped. A no-op unless one is in flight.
  record_update failed "$*"
  # Same funnel logic for the update lock: a failed update must not leave it held, and the
  # owner check makes this a no-op for every death that never took it.
  release_update_lock
  exit 1
}

# ── environment ─────────────────────────────────────────────────────────────────────────
need_node() {
  command -v node >/dev/null 2>&1 ||
    die "Node.js $MIN_NODE_MAJOR+ is required but not on PATH. Install from https://nodejs.org (or: brew install node)"
  major=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
  [ "$major" -ge "$MIN_NODE_MAJOR" ] 2>/dev/null ||
    die "Node.js $MIN_NODE_MAJOR+ is required (found $(node -v))."
}

need_install() {
  [ -f "$APP_DIR/package.json" ] ||
    die "no install found at $APP_DIR. Get the installer from https://github.com/$REPO/releases"
}

installed_version() {
  if [ -f "$APP_DIR/package.json" ]; then
    node -p "require('$APP_DIR/package.json').version" 2>/dev/null || printf 'unknown'
  else
    printf 'unknown'
  fi
}

# ── version comparison ──────────────────────────────────────────────────────────────────
# `sort -V` isn't dependable across BSD and GNU, so compare segment by segment. Returns 0 when
# $1 is strictly newer than $2. Prereleases are never published as `latest`, so numeric
# segments are enough.
version_gt() {
  left=$(printf '%s' "${1#v}" | cut -d- -f1)
  right=$(printf '%s' "${2#v}" | cut -d- -f1)
  i=1
  while [ "$i" -le 3 ]; do
    l=$(printf '%s' "$left" | cut -d. -f"$i")
    r=$(printf '%s' "$right" | cut -d. -f"$i")
    l=${l:-0}
    r=${r:-0}
    [ "$l" -gt "$r" ] 2>/dev/null && return 0
    [ "$l" -lt "$r" ] 2>/dev/null && return 1
    i=$((i + 1))
  done
  return 1
}

# The newest release, into LATEST_TAG, with LATEST_INSTALLABLE saying whether anything can be
# installed from it yet.
#
# **Sets globals and prints nothing on purpose.** `x=$(f)` runs f in a subshell, so a global it
# assigns there cannot reach the caller — the first version of this returned the tag on stdout
# and every caller read a stale LATEST_INSTALLABLE.
#
# Why installability is a separate question from the tag: a release appears on the API the moment
# it is published, but .github/workflows/release.yml triggers on `release: published` and uploads
# the assets at the very end — after typecheck, lint, test, build and pack. For those minutes
# `tag_name` names a version whose control-center-<v>.tar.gz does not exist, and apply_update
# below 404s on the download and dies. Every release had that window.
#
# The tag is still reported when its assets are missing, because "is it newer" has to be answered
# *first*: screening the release out here made an older assetless release (a fork, or a test
# fixture) read as "still publishing" instead of "you're already up to date".
LATEST_TAG=
LATEST_INSTALLABLE=no
fetch_latest_release() {
  LATEST_TAG=
  LATEST_INSTALLABLE=no
  body=$(curl -fsSL --max-time 10 -H 'Accept: application/vnd.github+json' \
    "https://api.github.com/repos/$REPO/releases/latest" 2>/dev/null) || return 0
  LATEST_TAG=$(printf '%s' "$body" |
    sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)
  [ -n "$LATEST_TAG" ] || return 0
  # Anchored on the **unescaped `"browser_download_url": "` key**, which is what confines the
  # match to a real entry in `assets[]`. There is no `jq` here, so this greps the whole payload —
  # and a payload carries a release *body*, which for our own releases is an auto-generated
  # changelog of PR titles and for a fork is arbitrary text. Two weaker versions were both
  # spoofed from that body by the security audit: the bare filename first, then the bare download
  # URL. What makes the key form different is not specificity, it is **JSON escaping**: every
  # quote inside a string field arrives as `\"`, so a body quoting this key-and-value can never
  # produce the bare quotes this pattern needs. Verified against a forged payload.
  #
  # Both spacings are tried because the anchor now depends on GitHub's formatting (it pretty-
  # prints `": "`); a compacted payload would otherwise refuse every update forever, which fails
  # safe but silently. Fixed strings, never a regex — the tag comes from whatever repo CC_REPO
  # names, and `grep -F` means a hostile fork's tag can't become a pattern. (Also never grep -P,
  # which BSD grep answers with exit 2 — a failure an `if` reads as "no match".)
  url="https://github.com/${REPO}/releases/download/${LATEST_TAG}/control-center-${LATEST_TAG#v}.tar.gz"
  for sep in '": "' '":"'; do
    if printf '%s' "$body" | grep -qF "\"browser_download_url${sep}${url}\""; then
      LATEST_INSTALLABLE=yes
      break
    fi
  done
  return 0
}

# ── process control ─────────────────────────────────────────────────────────────────────
pid_of() {
  file="$RUN_DIR/$1.pid"
  [ -f "$file" ] || return 1
  pid=$(cat "$file" 2>/dev/null || echo "")
  [ -n "$pid" ] || return 1
  kill -0 "$pid" 2>/dev/null || return 1
  printf '%s' "$pid"
}

# Either process counts as "running" — the runner holds its own connection to the production
# database, so a dead `web` next to a live `runner` is not "stopped". Callers that specifically
# care about the web process (e.g. wait_for_http, which is waiting on it to answer HTTP) check
# `pid_of web` directly instead of this.
running() { pid_of web >/dev/null 2>&1 || pid_of runner >/dev/null 2>&1; }

stop_one() {
  pid=$(pid_of "$1" 2>/dev/null) || return 0
  kill "$pid" 2>/dev/null || :
  waited=0
  while kill -0 "$pid" 2>/dev/null && [ "$waited" -lt 10 ]; do
    sleep 1
    waited=$((waited + 1))
  done
  kill -9 "$pid" 2>/dev/null || :
  rm -f "$RUN_DIR/$1.pid"
}

stop_all() {
  stop_one web
  stop_one runner
}

# spawn <name> <command…> — detached, logged, pid recorded. `set -a` exports whatever .env
# defines (SECRETS_MASTER_KEY, GH_TOKEN, PROJECT_ROOTS…) to the child.
spawn() {
  name=$1
  shift
  mkdir -p "$LOG_DIR" "$RUN_DIR"
  (
    cd "$APP_DIR" || exit 1
    if [ -f "$ENV_FILE" ]; then
      set -a
      # shellcheck disable=SC1090 # path is computed
      . "$ENV_FILE"
      set +a
    fi
    PLATFORM_DATA_DIR="$DATA_DIR" \
      CC_HOME="$CC_HOME" \
      APP_VERSION="$(installed_version)" \
      RUNNER_PORT="$RUNNER_PORT" \
      NODE_ENV=production \
      NEXT_TELEMETRY_DISABLED=1 \
      nohup "$@" >>"$LOG_DIR/$name.log" 2>&1 &
    printf '%s' "$!" >"$RUN_DIR/$name.pid"
  )
}

wait_for_http() {
  waited=0
  while [ "$waited" -lt "$WAIT_TIMEOUT" ]; do
    # Any answer counts — `/` redirects to /signin when signed out.
    curl -s -o /dev/null --max-time 2 "$URL" 2>/dev/null && return 0
    if ! pid_of web >/dev/null 2>&1; then
      warn "The web process exited. Last lines of $LOG_DIR/web.log:"
      tail -20 "$LOG_DIR/web.log" >&2 2>/dev/null || :
      return 1
    fi
    sleep 1
    waited=$((waited + 1))
    [ "$waited" = 5 ] && info "Starting up…" || :
  done
  return 1
}

# The installed web app, if Chrome has one. Installing from Chrome creates a real Mac app
# bundle carrying our own icon, so launching *that* puts Control Center in the Dock under its
# own logo — a plain `--app=` window is just another Chrome window wearing Chrome's icon.
installed_app_bundle() {
  for dir in "$HOME/Applications/Chrome Apps.localized" "$HOME/Applications/Chrome Apps" \
    "$HOME/Applications" "/Applications/Chrome Apps.localized" "/Applications"; do
    [ -d "$dir" ] || continue
    for candidate in "$dir/Agent Control Center.app" "$dir/Control Center.app"; do
      [ -d "$candidate" ] && printf '%s' "$candidate" && return 0
    done
  done
  return 1
}

open_window() {
  [ "${CC_NO_OPEN:-}" = 1 ] && return 0 # for scripted starts, CI, and smoke tests
  arg="--app=$URL"
  case "$(uname -s)" in
    Darwin)
      if bundle=$(installed_app_bundle); then
        open -a "$bundle" 2>/dev/null && {
          info "Opened $(basename "$bundle" .app) (its own Dock icon)"
          return 0
        }
      fi
      for app in "Google Chrome" Chromium "Microsoft Edge" "Brave Browser"; do
        if open -na "$app" --args "$arg" 2>/dev/null; then
          info "Opened $URL in $app"
          hint_install_app
          return 0
        fi
      done
      open "$URL" 2>/dev/null && info "Opened $URL in your default browser"
      ;;
    *)
      for bin in google-chrome chromium chromium-browser microsoft-edge; do
        if command -v "$bin" >/dev/null 2>&1; then
          "$bin" "$arg" >/dev/null 2>&1 &
          info "Opened $URL in $bin"
          return 0
        fi
      done
      command -v xdg-open >/dev/null 2>&1 && xdg-open "$URL" >/dev/null 2>&1 &
      ;;
  esac
}

# Shown once per install, after a plain browser window: how to turn this into a real app.
hint_install_app() {
  marker="$CC_HOME/.install-hint-shown"
  [ -f "$marker" ] && return 0
  cat <<EOF

  Tip: for the window itself to carry the Control Center icon, install it from Chrome —
  open ${URL} in a NORMAL tab (not this app window, which has no menu for
  it) and use the install button in the address bar. This command then launches that
  app instead. "Control Center.app" in your Applications folder already launches
  everything without a terminal.
EOF
  touch "$marker" 2>/dev/null || :
}

# ── update-attempt bookkeeping ──────────────────────────────────────────────────────────
# An update started from the app (POST /api/updates/apply) runs detached, with nobody watching
# its output — so an attempt records what it did, twice over: the whole run in
# $UPDATE_LOG_FILE, and its outcome here. Before this, a failure halfway through was invisible:
# the dashboard watched for a version number that never changed and gave up after six minutes,
# and the reason — checksum mismatch, failed dependency install, failed build — went to
# /dev/null with the rest of the output.
#
# The format is one `key=value` per line, parsed by lib/update-run.ts. Values are stripped of
# control characters and clipped: a newline would forge a field, and the message is rendered in
# the app. Bookkeeping must never be what breaks an update, so every step here fails quietly.
# One field's worth of value: no control characters, clipped. A newline would forge a field —
# the reader takes the *first* occurrence of a key, so a forged line can't replace `state`, but
# it could replace everything written after it. `target` comes from a GitHub tag name and the
# message from whatever failed, so neither is ours to trust.
#
# With `tr` or `cut` missing this yields an **empty** field rather than an unfiltered one, and
# the update carries on: the real error is still on stdout and in the log either way.
clean_field() {
  printf '%s' "${1:-}" | tr -d '[:cntrl:]' | cut -c1-400
}

record_update() {
  # Set by update_run and nothing else, so `die` can call this unconditionally.
  [ -n "${UPDATE_ATTEMPT:-}" ] || return 0
  mkdir -p "$RUN_DIR" 2>/dev/null || return 0
  # `mkdir -p` is happy with a directory that already exists, so check we can actually write in
  # it. Without this, a root-owned run/ makes the shell print a redirection error for every
  # field we try to record — three "Permission denied" lines in the middle of an update that is
  # otherwise going fine.
  [ -w "$RUN_DIR" ] || return 0
  ended=''
  [ "$1" = running ] || ended=$(date +%s)
  tmp="$UPDATE_STATUS_FILE.$$"
  # Written temp-then-mv: a reader polling this every couple of seconds must never be able to
  # read half a file.
  {
    printf 'state=%s\n' "$1"
    printf 'pid=%s\n' "$$"
    printf 'from=%s\n' "$(clean_field "${UPDATE_FROM:-}")"
    printf 'target=%s\n' "$(clean_field "${UPDATE_TARGET:-}")"
    printf 'startedAt=%s\n' "${UPDATE_STARTED:-}"
    printf 'endedAt=%s\n' "$ended"
    printf 'message=%s\n' "$(clean_field "${2:-}")"
  } >"$tmp" 2>/dev/null && mv "$tmp" "$UPDATE_STATUS_FILE" 2>/dev/null || :
}

# The state of the last recorded attempt, or nothing.
update_state() {
  [ -f "$UPDATE_STATUS_FILE" ] || return 0
  sed -n 's/^state=//p' "$UPDATE_STATUS_FILE" 2>/dev/null | head -1
}

# ── update lock ─────────────────────────────────────────────────────────────────────────
# Two entry points reach apply_update(): `update` (which the app's Update button drives via a
# detached spawn) and check_and_update() on the `start` path. With nothing between them, "click
# Update, get impatient, quit the app and reopen it" put two apply_updates on the same install,
# racing each other's rm/mv on app/ — the bad interleavings end with no app directory at all.
#
# The lock is a directory (`mkdir` is atomic on POSIX filesystems — no flock dependency) whose
# `owner` file carries "pid startedAt". But the directory alone is *not* the token: `mkdir` and
# the owner write are two steps, and the first cut let a racer reclaim the freshly-made,
# not-yet-populated directory and both callers end up believing they hold it (a reviewer
# measured this at ~46% of concurrent acquires). So **the O_EXCL creation of `owner` is the real
# token**: whoever's `set -C` (noclobber) create of it succeeds holds the lock. A process that
# finds its directory reclaimed under it fails that create rather than clobbering — which is
# also what stops a symlink planted at `owner` from redirecting the write onto, say,
# ~/.control-center/.env (O_EXCL refuses an existing path, symlink included).
#
# Staleness is decided the way lib/update-run.ts decides it for update.status, and it is the
# same trade: `kill -0` can't verify process *identity*, so a recycled pid reads as alive — the
# age ceiling is what bounds that to an hour. Too eager the other way starts a second swap
# beside a live one, hence an hour with clock tolerance rather than minutes.
UPDATE_LOCK_DIR="$RUN_DIR/update.lock"
UPDATE_LOCK_MAX_AGE=3600
UPDATE_LOCK_CLOCK_TOLERANCE=300

# The owner line ("pid startedAt"), read defensively. It is a regular file only — a same-uid
# tamperer could drop a symlink here to redirect the read at an arbitrary file, or a FIFO to
# block it forever — and the read is byte-capped: `cat` of a multi-gigabyte file planted at this
# path would otherwise be slurped into a shell variable on *every* start/update (cmd_start reads
# it before anything else runs). `dd` stops after one small block whatever the file's real size.
# The owner of a lock directory (default: the live one; a second arg lets `acquire` re-judge a
# copy it just moved aside). Read defensively — see the block above.
update_lock_owner() {
  f="${1:-$UPDATE_LOCK_DIR}/owner"
  [ -f "$f" ] && [ ! -h "$f" ] || return 0
  dd if="$f" bs=256 count=1 2>/dev/null || :
}

# "pid startedAt" if the owner file holds a well-formed one, else nothing. Central so `alive`
# and `stale` can't disagree on what "valid" means. Both fields must be plain digits **and fit a
# 64-bit integer** (≤18 digits): an all-digit value too big for the shell's arithmetic makes
# `kill -0` and `$(( ))` *fatal* under dash (the container's /bin/sh), which would crash every
# future start/update on a corrupt record — worse than the wedge the staleness rules prevent.
update_lock_fields() {
  lock_owner=$(update_lock_owner "${1:-}")
  lock_pid=${lock_owner%% *}
  lock_started=${lock_owner#* }
  [ -n "$lock_pid" ] && [ -n "$lock_started" ] || return 1
  case "$lock_pid$lock_started" in '' | *[!0-9]*) return 1 ;; esac
  [ "${#lock_pid}" -le 18 ] && [ "${#lock_started}" -le 18 ] || return 1
  printf '%s %s' "$lock_pid" "$lock_started"
}

# For messages only — digits or "unknown", because it's printed to a terminal and copied into
# update.status, and the file is one any local process can forge.
update_lock_owner_pid() {
  fields=$(update_lock_fields) || { printf 'unknown'; return 0; }
  printf '%s' "${fields%% *}"
}

# Held by a live update: well-formed owner, its process still there, started inside the window.
# An optional directory argument judges a copy other than the live lock (used by `acquire`).
update_lock_alive() {
  dir=${1:-$UPDATE_LOCK_DIR}
  [ -d "$dir" ] || return 1
  fields=$(update_lock_fields "$dir") || return 1
  lock_pid=${fields%% *}
  lock_started=${fields#* }
  kill -0 "$lock_pid" 2>/dev/null || return 1
  lock_age=$(($(date +%s) - lock_started))
  [ "$lock_age" -lt "$UPDATE_LOCK_MAX_AGE" ] || return 1
  [ "$lock_age" -gt "-$UPDATE_LOCK_CLOCK_TOLERANCE" ] || return 1
}

# Provably reclaimable: a well-formed owner whose process is gone, or whose start time is outside
# the window (a reboot's leftover on a recycled pid). A **missing or malformed** owner is
# deliberately NOT stale — it usually means a racer is between its `mkdir` and its owner write,
# and reclaiming there is what caused the double-acquire. `acquire_update_lock` waits one beat
# and re-checks before treating that case as a genuine leftover.
update_lock_stale() {
  [ -d "$UPDATE_LOCK_DIR" ] || return 1
  fields=$(update_lock_fields) || return 1
  lock_pid=${fields%% *}
  lock_started=${fields#* }
  kill -0 "$lock_pid" 2>/dev/null || return 0
  lock_age=$(($(date +%s) - lock_started))
  [ "$lock_age" -ge "$UPDATE_LOCK_MAX_AGE" ] && return 0
  [ "$lock_age" -le "-$UPDATE_LOCK_CLOCK_TOLERANCE" ] && return 0
  return 1
}

update_lock_is_mine() {
  fields=$(update_lock_fields) || return 1
  [ "${fields%% *}" = "$$" ]
}

# Take the lock, or return 1 with the holder untouched. Callers must treat a false return as
# "someone else has it", never retry-loop (the bounded loop here is only for reclaim churn).
acquire_update_lock() {
  mkdir -p "$RUN_DIR" 2>/dev/null || return 1
  attempts=0
  while :; do
    attempts=$((attempts + 1))
    [ "$attempts" -le 4 ] || return 1
    if mkdir "$UPDATE_LOCK_DIR" 2>/dev/null; then
      # Ours and empty. Claim it with an O_EXCL create of `owner` (the real token — see the
      # header). A racer that reclaimed this directory under us, or a symlink planted at `owner`
      # in the gap, makes this fail; we yield without destroying what may now be theirs.
      if (
        set -C
        printf '%s %s\n' "$$" "$(date +%s)" >"$UPDATE_LOCK_DIR/owner"
      ) 2>/dev/null; then
        return 0
      fi
      return 1
    fi
    # The directory exists. A live holder is refused outright; nothing here reclaims a live lock.
    update_lock_alive && return 1
    # Not live: a clearly-dead/aged owner, or an ownerless/malformed one. The latter is the
    # ambiguous case — a racer mid-claim, or a corrupt leftover — so wait a beat for a racer to
    # publish its owner, then decide again: now-live means back off, anything else is a leftover.
    if ! update_lock_stale; then
      sleep 1
      update_lock_alive && return 1
    fi
    # Reclaim. The staleness check above and this move are not one atomic step, so between them
    # another process could have reclaimed and *re-acquired* this same path with a fresh, live
    # lock. The `mv` is atomic, so it takes a consistent snapshot — and we then re-judge *that
    # snapshot*: if the copy we took is itself live, a racer beat us to it, so put it back and
    # yield rather than dropping a legitimate holder (which is what would leave two updates
    # running — the exact bug this lock exists to prevent). Only a still-not-live copy is ours to
    # drop; a planted `owner` symlink inside it is unlinked, never followed.
    aside="$UPDATE_LOCK_DIR.stale.$$"
    rm -rf "$aside" 2>/dev/null || :
    mv "$UPDATE_LOCK_DIR" "$aside" 2>/dev/null || continue
    if update_lock_alive "$aside"; then
      mv "$aside" "$UPDATE_LOCK_DIR" 2>/dev/null || rm -rf "$aside" 2>/dev/null || :
      return 1
    fi
    rm -rf "$aside" 2>/dev/null || :
  done
}

# Owner-checked, so `die` can call it unconditionally: a process that never took the lock
# (or lost it) removes nothing.
release_update_lock() {
  update_lock_is_mine || return 0
  rm -rf "$UPDATE_LOCK_DIR" 2>/dev/null || :
}

# ── update ──────────────────────────────────────────────────────────────────────────────
backup_db() {
  db="$DATA_DIR/platform.db"
  [ -f "$db" ] || return 0
  mkdir -p "$DATA_DIR/backup"
  dest="$DATA_DIR/backup/platform-$(installed_version)-$(date +%Y%m%d-%H%M%S).db"
  cp "$db" "$dest" 2>/dev/null && info "Backed up the database to $dest"
}

verify_checksum() {
  file=$1
  sums=$2
  name=$(basename "$file")
  expected=$(sed -n "s/^\([0-9a-f]*\)[[:space:]]*\**$name\$/\1/p" "$sums" 2>/dev/null | head -1)
  [ -n "$expected" ] || return 0 # no entry — nothing to check against
  if command -v shasum >/dev/null 2>&1; then
    actual=$(shasum -a 256 "$file" | cut -d' ' -f1)
  elif command -v sha256sum >/dev/null 2>&1; then
    actual=$(sha256sum "$file" | cut -d' ' -f1)
  else
    warn "No shasum/sha256sum available — skipping checksum verification."
    return 0
  fi
  [ "$actual" = "$expected" ] || die "checksum mismatch for $name — refusing to install."
  info "Checksum OK."
}

# apply_update <tag> — download, install deps, then swap the app directory. Everything happens
# in a temp dir first, so a failure at any point leaves the working install untouched.
apply_update() {
  tag=$1
  version=${tag#v}
  tarball="control-center-$version.tar.gz"
  base="https://github.com/$REPO/releases/download/$tag"
  tmp="$CC_HOME/.update.$$"

  mkdir -p "$tmp"
  # shellcheck disable=SC2064 # expand $tmp now, not at trap time
  trap "rm -rf '$tmp'" EXIT INT TERM

  info "Downloading ${version}…"
  # `|| rc=$?` rather than `|| die`: the *reason* decides the advice, and assigning keeps set -e
  # out of it. `-w '%{http_code}'` still prints under `-f`, which is what separates "this release
  # isn't finished uploading" (404) from "the server said no for some other reason" (403/5xx)
  # from "there was no HTTP response at all" (DNS, timeout, TLS — no code, or 000).
  rc=0
  code=$(curl -fsSL --max-time 300 -o "$tmp/$tarball" -w '%{http_code}' "$base/$tarball") || rc=$?
  if [ "$rc" != 0 ]; then
    case "$code" in
      # fetch_latest_release screens for a missing asset, so reaching here means the release
      # landed in the gap between that check and this download.
      404)
        die "release $version is published but its assets aren't uploaded yet — try again in a few minutes."
        ;;
      # Don't tell someone to wait for an upload that already finished: a 403 (rate limit, or a
      # private asset) or a 5xx is not a half-published release.
      '' | 000)
        die "download failed: $base/$tarball"
        ;;
      *)
        die "download failed with HTTP $code: $base/$tarball"
        ;;
    esac
  fi
  if curl -fsSL --max-time 30 -o "$tmp/SHA256SUMS" "$base/SHA256SUMS" 2>/dev/null; then
    verify_checksum "$tmp/$tarball" "$tmp/SHA256SUMS"
  fi

  info "Unpacking…"
  mkdir -p "$tmp/app"
  tar -xzf "$tmp/$tarball" -C "$tmp/app" --strip-components=1

  info "Installing dependencies (a minute or two)…"
  # `npx pnpm` rather than requiring a global pnpm: the lockfile is pnpm's, and a second
  # prerequisite is exactly what this install path is trying to avoid.
  (cd "$tmp/app" && npx --yes "pnpm@${CC_PNPM_VERSION:-9.12.1}" install --frozen-lockfile) ||
    die "dependency install failed — the existing install is untouched."

  # Build before anything is swapped: `next start` needs `.next`, and a build that fails here
  # must leave the running install exactly as it was.
  info "Building the app…"
  (cd "$tmp/app" && NODE_ENV=production ./node_modules/.bin/next build) ||
    die "build failed — the existing install is untouched."

  stop_all
  # A copy of the pre-update database, distinct from the snapshot the migrator takes: this one
  # is the last good state for *this* version, before any schema change touches it.
  backup_db
  rm -rf "$CC_HOME/app.old"
  [ -d "$APP_DIR" ] && mv "$APP_DIR" "$CC_HOME/app.old" || :
  mv "$tmp/app" "$APP_DIR"
  rm -rf "$tmp"
  trap - EXIT INT TERM

  # Refresh the Mac app bundle from the version just installed — otherwise the icon and the
  # native window stay on whatever the last install produced. Rebuilding under a *running* app
  # is safe: make-app-bundle.sh swaps the bundle with mv, which leaves the running inode alone.
  if [ "$(uname -s)" = Darwin ] && [ -f "$APP_DIR/infra/release/make-app-bundle.sh" ]; then
    sh "$APP_DIR/infra/release/make-app-bundle.sh" >/dev/null 2>&1 &&
      info "Refreshed the Control Center.app bundle." ||
      warn "Couldn't refresh the app bundle — run: control-center install-app"
  fi

  # Refresh the command itself. It's copied to ~/.local/bin at install time and lives outside
  # app/, so swapping app/ leaves it on whatever version first installed it — every change to
  # this script (ports, how the server is started) would never reach anyone who updates.
  # Written via temp + mv: sh reads a script incrementally, so overwriting the running file in
  # place feeds it garbage. Rename swaps the directory entry and leaves this inode alone.
  new_cli="$APP_DIR/infra/release/control-center.sh"
  if [ -f "$new_cli" ] && [ -w "$(dirname "$SELF")" ]; then
    cp "$new_cli" "$SELF.new" && chmod +x "$SELF.new" && mv "$SELF.new" "$SELF" &&
      info "Refreshed the control-center command." ||
      warn "Couldn't refresh $SELF — re-run install.sh if the command misbehaves."
  fi

  info "Updated to $(installed_version). The previous version is kept at $CC_HOME/app.old"
  info "Schema migrations run on the next start; your database is copied to data/backup/ first."
}

# One `control-center update` attempt. Its output is already going wherever cmd_update decided,
# and from the first line on, any `die` below records why it stopped.
update_run() {
  UPDATE_ATTEMPT=1
  UPDATE_STARTED=$(date +%s)
  # Before anything else: one update at a time, install-wide. UPDATE_ATTEMPT is already set,
  # so losing here records `failed` with this message — which is what the app's banner shows
  # when the button-spawned attempt found a start-path update already mid-swap.
  acquire_update_lock ||
    die "another update is already in progress (pid $(update_lock_owner_pid)). Watch it with: tail -f $UPDATE_LOG_FILE"
  record_update running
  need_node
  need_install
  UPDATE_FROM=$(installed_version)
  info "Checking for a newer release (current: $UPDATE_FROM)…"
  fetch_latest_release
  latest=$LATEST_TAG
  [ -n "$latest" ] || die "couldn't reach GitHub Releases."
  UPDATE_TARGET=${latest#v}
  if ! version_gt "$latest" "$UPDATE_FROM"; then
    info "Already on the latest release ($UPDATE_FROM)."
    record_update up-to-date
    release_update_lock
    return 0
  fi
  # Newer, but is there anything to download? Checked here rather than in fetch_latest_release so
  # an *older* assetless release still reads as "already up to date" (see that function's note).
  # `die` records the reason, so the app's banner tells the user to wait rather than showing them
  # a failed update they can do nothing about.
  [ "$LATEST_INSTALLABLE" = yes ] ||
    die "release $UPDATE_TARGET is published but its assets aren't uploaded yet — try again in a few minutes."
  record_update running # now carrying the version being installed
  was_running=no
  running && was_running=yes
  apply_update "$latest"
  # The lock is deliberately still held through this restart: cmd_start lets its own locker
  # through, while someone else's `start` keeps refusing — otherwise the update's restart and
  # a user's reopen could each spawn a web+runner pair.
  [ "$was_running" = yes ] && CC_SKIP_UPDATE_CHECK=1 cmd_start || :
  record_update succeeded
  release_update_lock
}

# `control-center update` — decide where the attempt's output goes, then run it.
cmd_update() {
  mkdir -p "$LOG_DIR" "$RUN_DIR"
  # Two reasons to run without logging ourselves. `CC_UPDATE_LOG` means the app's detached
  # spawn (app/api/updates/apply/route.ts) already has our stdout and stderr pointed at that
  # file, and teeing as well would double every line. Directories we can't write are the other:
  # `mkdir -p` succeeds on a directory that already exists, so a root-owned logs/ left by a
  # stray sudo would let `tee` fail to open its file and kill the update with a silent SIGPIPE —
  # and an unwritable run/ would leave no record for the exit status below to read, failing an
  # update that worked. Neither is worth breaking an update over; both leave a terminal showing
  # everything anyway.
  if [ -n "${CC_UPDATE_LOG:-}" ] || [ ! -w "$LOG_DIR" ] || [ ! -w "$RUN_DIR" ]; then
    update_run
  else
    # Run by hand: still show progress on the terminal, and keep the same record.
    # Keep the previous attempt: `tee` truncates, and a failed update's log used to be
    # destroyed by the very retry someone runs to recover from it.
    [ -f "$UPDATE_LOG_FILE" ] && mv "$UPDATE_LOG_FILE" "$UPDATE_LOG_FILE.prev" 2>/dev/null || :
    update_run 2>&1 | tee "$UPDATE_LOG_FILE"
    # A pipeline exits with tee's status, so the attempt's own record is what we report —
    # anything short of a recorded success is a failure, including a death that never got to
    # record one.
    case "$(update_state)" in
      succeeded | up-to-date) ;;
      *) exit 1 ;;
    esac
  fi
}

check_and_update() {
  current=$(installed_version)
  info "Checking for updates (current: $current)…"
  fetch_latest_release
  latest=$LATEST_TAG
  if [ -z "$latest" ]; then
    warn "Couldn't reach GitHub Releases — continuing on $current."
    return 0
  fi
  if version_gt "$latest" "$current"; then
    # A release whose assets are still uploading is not an error and must not stop a launch:
    # `start` is the path the Mac app takes every time it opens. The next check picks it up once
    # the upload finishes, minutes later.
    if [ "$LATEST_INSTALLABLE" != yes ]; then
      info "Release ${latest#v} is still publishing its assets — continuing on $current."
      return 0
    fi
    # Refuse rather than start: another process is (or is about to be) mid-swap on app/, and
    # if the server was running when it began, that update restarts the server itself — the
    # Mac app window reconnects on its own.
    acquire_update_lock ||
      die "an update is already in progress (pid $(update_lock_owner_pid)) — it restarts the app itself when it finishes. Watch it with: tail -f $UPDATE_LOG_FILE"
    # **A failed update must never stop the app from starting.** `apply_update` ends in `die` on
    # any problem, and `die` exits the script — so on this path a bad download meant the server
    # simply never came up, which is a far worse outcome than being a version behind. The
    # subshell contains that exit: the attempt ends, the lock is released, and the launch carries
    # on with what is already installed. Reported by the security audit as a denial of service
    # reachable by pointing CC_REPO at a fork, but it needs no attacker at all — a flaky network
    # during `apply_update`'s download did it too.
    #
    # `update_run` (the `control-center update` path) deliberately keeps the fatal behaviour: a
    # command whose whole job is to update should exit non-zero when it couldn't.
    if ( apply_update "$latest" ); then
      release_update_lock
    else
      release_update_lock
      warn "The update to ${latest#v} didn't finish — starting $current instead."
      warn "Details: $UPDATE_LOG_FILE  ·  retry with: control-center update"
    fi
  else
    info "Already on the latest release ($current)."
  fi
}

# ── commands ────────────────────────────────────────────────────────────────────────────
cmd_start() {
  need_node
  need_install
  # A live update is about to stop the server and swap app/ under us, so spawning now races the
  # swap — and its own restart would put a second web+runner pair beside ours. Checked here, at
  # the entry, so `restart`, `--no-update` and CC_SKIP_UPDATE_CHECK are covered too; the
  # updater's own restart re-enters this function holding the lock, which is what the owner
  # check lets through.
  if update_lock_alive && ! update_lock_is_mine; then
    die "an update is in progress (pid $(update_lock_owner_pid)) — it restarts the app itself when it finishes. Watch it with: tail -f $UPDATE_LOG_FILE"
  fi
  [ "${CC_SKIP_UPDATE_CHECK:-}" = 1 ] || [ "${1:-}" = --no-update ] || check_and_update

  if running; then
    web_pid=$(pid_of web 2>/dev/null) || web_pid=
    runner_pid=$(pid_of runner 2>/dev/null) || runner_pid=
    if [ -n "$web_pid" ] && [ -n "$runner_pid" ]; then
      info "Already running on $URL"
      open_window
      return 0
    fi
    die "partially running (web pid: ${web_pid:-none}, runner pid: ${runner_pid:-none}) — not starting a second pair. Run 'control-center stop' then 'start' to recover cleanly."
  fi

  mkdir -p "$DATA_DIR" "$LOG_DIR" "$RUN_DIR"

  # A restore queued from the UI (Settings → Restore from a backup). It's applied here, with the
  # server down, because the process serving that page holds the database open — swapping it
  # underneath would leave a half-written one. The archive was already validated on upload.
  pending="$DATA_DIR/pending-import.tar.gz"
  if [ -f "$pending" ]; then
    info "Applying the queued restore…"
    if (cd "$APP_DIR" && PLATFORM_DATA_DIR="$DATA_DIR" \
      ./node_modules/.bin/tsx runner/import.ts "$pending" --force); then
      mkdir -p "$DATA_DIR/backup"
      mv "$pending" "$DATA_DIR/backup/applied-import-$(date +%Y%m%d-%H%M%S).tar.gz"
    else
      # Keep the archive: the operator may want to retry or inspect it. But don't loop on it
      # every launch — move it aside and say where it went.
      mv "$pending" "$DATA_DIR/failed-import.tar.gz"
      warn "The queued restore failed; it's been moved to $DATA_DIR/failed-import.tar.gz"
      warn "Starting with your existing data instead."
    fi
  fi

  # Migrate before anything serves a request, so an updated app can never read an older
  # schema. No-op when there's nothing pending; snapshots into data/backup/ when there is;
  # exits non-zero rather than starting against a database it doesn't understand.
  migrate_output=$(cd "$APP_DIR" && PLATFORM_DATA_DIR="$DATA_DIR" \
    ./node_modules/.bin/tsx runner/migrate.ts 2>&1) || {
    warn "$migrate_output"
    die "database migration failed — not starting. Your data is untouched."
  }
  printf '%s\n' "$migrate_output" | grep -vE 'up to date' || :

  # `next start` needs a production build. install/update make one, but an install updated by
  # an older control-center never got one — and a `.next` left behind by `next dev` has no
  # BUILD_ID, which is the only honest marker that a production build is actually there.
  if [ ! -f "$APP_DIR/.next/BUILD_ID" ]; then
    info "Building the app (one minute, once)…"
    (cd "$APP_DIR" && NODE_ENV=production ./node_modules/.bin/next build) ||
      die "build failed — see the output above."
  fi

  spawn runner "$APP_DIR/node_modules/.bin/tsx" runner/server.ts
  spawn web "$APP_DIR/node_modules/.bin/next" start -p "$PORT" -H 127.0.0.1
  if ! wait_for_http; then
    stop_all
    die "$URL never answered. Logs: $LOG_DIR/web.log and $LOG_DIR/runner.log"
  fi
  open_window
  info "Running (v$(installed_version)). Stop it with: control-center stop"
}

usage() {
  cat <<EOF
control-center — run the Control Center dashboard locally.

Usage: control-center <command>

  start [--no-update]  Check for a new release, update if there is one, start, open the window
  stop                 Stop the app (your data stays in $DATA_DIR)
  restart              Stop, then start without checking for updates
  install-app [DIR]    (Re)create "Agent Control Center.app" so you can launch it from Launchpad
                       or Applications instead of this command
  export [--include-tokens] [--out FILE]
                       Package this install's data into a portable archive
  import ARCHIVE [--claim-as-local] [--force]
                       Load an archive from another install (stops the app first)
  update               Check for and apply a new release now
  status               Whether it's running, on which version and port
  logs [-f]            Tail the web + runner logs
  version              Print the installed version
  uninstall [--purge]  Remove the app, the command and the Mac bundle. Keeps your data
                       unless you pass --purge
  help                 This text

Environment: CC_PORT (default 7373), CC_RUNNER_PORT (default 7374),
CC_HOME (default ~/.control-center),
CC_SKIP_UPDATE_CHECK=1 to never check on start, CC_NO_OPEN=1 to not open a window,
CC_REPO to track a fork.

To remove everything: control-center uninstall --purge
EOF
}

case "${1:-start}" in
  start)
    shift 2>/dev/null || :
    cmd_start "$@"
    ;;
  stop)
    stop_all
    info "Stopped."
    ;;
  restart)
    stop_all
    CC_SKIP_UPDATE_CHECK=1 cmd_start
    ;;
  uninstall)
    shift 2>/dev/null || :
    purge=no
    for a in "$@"; do [ "$a" = --purge ] && purge=yes; done

    info "Uninstalling Control Center…"
    stop_all
    # Quit the Mac app if it's open, otherwise removing its bundle leaves a zombie in the Dock.
    if [ "$(uname -s)" = Darwin ]; then
      # By bundle id, not by name: macOS ships its own "Control Center", so
      # `tell application "Control Center"` targeted Apple's and came back with
      # "User canceled (-128)" while ours kept running. Both ids: the app was renamed, and an
      # install from before the rename still has the old one.
      for id in dev.agentcontrolcenter.app dev.controlcenter.app; do
        osascript -e "tell application id \"$id\" to quit" >/dev/null 2>&1 || :
      done
      pkill -f "Contents/MacOS/AgentControlCenter" >/dev/null 2>&1 || :
      pkill -f "Contents/MacOS/ControlCenterApp" >/dev/null 2>&1 || :
      for dir in /Applications "$HOME/Applications" "$HOME/Applications/Chrome Apps.localized"; do
        for name in "Agent Control Center" "Control Center"; do
          bundle="$dir/$name.app"
          [ -d "$bundle" ] && rm -rf "$bundle" && info "Removed $bundle"
        done
      done
    fi
    rm -f "$HOME/.local/bin/control-center" && info "Removed the control-center command"

    if [ "$purge" = yes ]; then
      # Everything: database, encrypted tokens, attachments, logs, settings.
      rm -rf "$CC_HOME"
      info "Removed $CC_HOME — database, tokens and attachments are gone."
    else
      cat <<EOF

Your data is still at $CC_HOME
  data/       projects, tasks, transcripts, attachments
  data/secrets/  your encrypted Anthropic token
  .env        the key that decrypts it — lose this and the token is unrecoverable

Re-installing will pick it all up again. To delete it too:
  control-center uninstall --purge     (or simply: rm -rf $CC_HOME)
EOF
    fi
    info ""
    info "Done. The projects on your disk were never touched — only Control Center's own files."
    ;;
  install-app)
    shift 2>/dev/null || :
    need_install
    sh "$APP_DIR/infra/release/make-app-bundle.sh" "$@"
    ;;
  export)
    shift 2>/dev/null || :
    need_node
    need_install
    (cd "$APP_DIR" && PLATFORM_DATA_DIR="$DATA_DIR" ./node_modules/.bin/tsx runner/export.ts "$@")
    ;;
  import)
    shift 2>/dev/null || :
    need_node
    need_install
    # A running app holds the database open; swapping the file under it is how you get a
    # half-written one. Stop first, import, and leave it stopped for the operator to restart.
    if running; then
      info "Stopping the app first…"
      stop_all
    fi
    (cd "$APP_DIR" && PLATFORM_DATA_DIR="$DATA_DIR" ./node_modules/.bin/tsx runner/import.ts "$@") &&
      info "Start it again with: control-center start"
    ;;
  update) cmd_update ;;
  status)
    web_pid=$(pid_of web 2>/dev/null) || web_pid=
    runner_pid=$(pid_of runner 2>/dev/null) || runner_pid=
    if [ -n "$web_pid" ] && [ -n "$runner_pid" ]; then
      info "Running — v$(installed_version) on $URL (web pid $web_pid, runner pid $runner_pid)"
    elif [ -n "$web_pid" ]; then
      warn "Partially running — web is up (pid $web_pid) but the runner is not. v$(installed_version) on $URL"
    elif [ -n "$runner_pid" ]; then
      warn "Partially running — the runner is up (pid $runner_pid) but web is not. v$(installed_version) installed at $APP_DIR"
    else
      info "Stopped — v$(installed_version) installed at $APP_DIR"
    fi
    ;;
  logs)
    shift 2>/dev/null || :
    # The update log only exists once an update has been attempted, and `tail` errors on a
    # file that isn't there.
    if [ -f "$UPDATE_LOG_FILE" ]; then
      tail "$@" "$LOG_DIR/web.log" "$LOG_DIR/runner.log" "$UPDATE_LOG_FILE"
    else
      tail "$@" "$LOG_DIR/web.log" "$LOG_DIR/runner.log"
    fi
    ;;
  version)
    installed_version
    echo
    ;;
  help | --help | -h) usage ;;
  *)
    usage
    exit 1
    ;;
esac
