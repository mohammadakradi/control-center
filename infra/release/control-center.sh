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

latest_release() {
  curl -fsSL --max-time 10 -H 'Accept: application/vnd.github+json' \
    "https://api.github.com/repos/$REPO/releases/latest" 2>/dev/null |
    sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1
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
  curl -fsSL --max-time 300 -o "$tmp/$tarball" "$base/$tarball" || die "download failed: $base/$tarball"
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

check_and_update() {
  current=$(installed_version)
  info "Checking for updates (current: $current)…"
  latest=$(latest_release)
  if [ -z "$latest" ]; then
    warn "Couldn't reach GitHub Releases — continuing on $current."
    return 0
  fi
  if version_gt "$latest" "$current"; then
    apply_update "$latest"
  else
    info "Already on the latest release ($current)."
  fi
}

# ── commands ────────────────────────────────────────────────────────────────────────────
cmd_start() {
  need_node
  need_install
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
  update)
    need_node
    need_install
    current=$(installed_version)
    latest=$(latest_release)
    [ -n "$latest" ] || die "couldn't reach GitHub Releases."
    if version_gt "$latest" "$current"; then
      was_running=no
      running && was_running=yes
      apply_update "$latest"
      [ "$was_running" = yes ] && CC_SKIP_UPDATE_CHECK=1 cmd_start || :
    else
      info "Already on the latest release ($current)."
    fi
    ;;
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
    tail "$@" "$LOG_DIR/web.log" "$LOG_DIR/runner.log"
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
