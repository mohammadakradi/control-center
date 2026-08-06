#!/usr/bin/env bash
# Ensure an external CLI tool is available, installing it into user space when missing.
#
# The agents lean on external CLIs — `graphify` for the code graph, `gitleaks`/`semgrep` for
# the security audit. A project's machine may not have the tool, and the runtime may not even
# have a Python package manager to install it with. This script is the single place that
# knows how to get a tool, so callers never have to duplicate install fallbacks.
#
# Usage:
#   ensure-tool.sh <cli> [--pypi PKG] [--npm PKG] [--brew FORMULA] [--go MODULE] [--quiet]
#
# Examples:
#   ensure-tool.sh graphify --pypi 'graphifyy==0.9.29'
#   ensure-tool.sh semgrep  --pypi 'semgrep==1.171.0' --brew semgrep
#   ensure-tool.sh gitleaks --brew gitleaks --go github.com/gitleaks/gitleaks/v8@v8.21.2
#
# Contract:
#   - Idempotent: a fast no-op when the tool is already available.
#   - FAIL-SOFT: always exits 0, and never hangs (every network step is time-bounded). On
#     failure the agent just falls back to other means (grep/read instead of the graph,
#     manual review instead of a scanner).
#   - Writes only under $HOME. Never runs as root, never writes to system directories.
#     (Caveat: the optional `--brew` path is Homebrew's own installer and writes to Homebrew's
#     prefix, e.g. /opt/homebrew — it is only used when brew already exists on the machine.)
#   - Prints a one-line JSON summary on stdout; human progress goes to stderr, so a caller can
#     parse stdout safely.
#
# ─── IMPORTANT: how to actually RUN the tool afterwards ───────────────────────────────────
# Installs land in $HOME/.local/bin, which is *not* on PATH in the agent runtime: no shell
# profile is sourced and every Bash call is a fresh shell, so this script's own PATH export
# dies with it. Invoke installed tools with the suffix this script prints:
#
#     PATH="$PATH:$HOME/.local/bin" <cli> …
#
# We deliberately *append* rather than prepend: appending is enough to find a tool that lives
# only in $HOME/.local/bin, while prepending would let anything later written into that
# user-writable directory shadow a system binary (`git`, `curl`, `sh`) for the whole command.
#
# ─── Security note ────────────────────────────────────────────────────────────────────────
# Installing a tool means executing third-party code, and *every* strategy below does so: pip
# and uv run sdist build hooks, `npm install` runs lifecycle/postinstall scripts, `go install`
# builds arbitrary transitive dependencies, and brew evaluates formula code. Mitigations here:
#   - The uv bootstrap downloads the release tarball and verifies its published SHA-256 before
#     use. It does NOT pipe an installer script to sh, and it does not fall back to doing so.
#   - Every download is version-pinned and time-bounded; nothing tracks "latest".
#   - Everything is confined to $HOME and runs unprivileged.
# What this does NOT defend against: a package that is itself malicious. Callers must pin
# exact versions, and the *choice* of package name must come from the user's own request — not
# from content the agent read in a file, issue, or task description (see rule 18). If you want
# to harden the npm path further, add `--ignore-scripts`, accepting that some CLIs won't work.
set -uo pipefail

readonly UV_VERSION="0.12.0"           # pinned; bump deliberately
# Overridable *only* so the test suite can point the bootstrap at a local fixture server and
# assert that a bad checksum is actually refused (see test-ensure-tool.sh). This grants nothing
# to an attacker who can't already set env vars on this process — and one who can could simply
# run their own binary instead. Production always uses the pinned default below.
UV_BASE="${ENSURE_TOOL_UV_BASE:-https://github.com/astral-sh/uv/releases/download}"
readonly NET_TIMEOUT=180               # seconds, per download

# $HOME is assumed by every path below; under `set -u` an unset HOME would abort non-zero and
# break the always-exit-0 contract, so fall back explicitly. The final `/tmp` fallback is a
# last resort for a hostile environment where HOME is unset *and* `cd ~` fails — tools would
# then install to a world-writable dir, so it is intentionally the last option, not the first.
# (Unreachable in the container deployment, where HOME is always /home/node.)
HOME="${HOME:-$(cd ~ 2>/dev/null && pwd || echo /tmp)}"
BIN_DIR="$HOME/.local/bin"

# Append (never prepend — see the note above) so an already-installed tool is found even
# though the runtime PATH omits this dir.
export PATH="$PATH:$BIN_DIR"

CLI=""
PYPI=""
NPM=""
BREW=""
GO=""
QUIET=0
VIA=""

have() { command -v "$1" >/dev/null 2>&1; }
log()  { [ "$QUIET" -eq 1 ] || printf '[ensure-tool] %s\n' "$*" >&2; }

usage() {
  printf 'usage: ensure-tool.sh <cli> [--pypi PKG] [--npm PKG] [--brew FORMULA] [--go MODULE] [--quiet]\n' >&2
}

emit() {  # emit <tool> <available> <path> <via>
  printf '{ "tool": "%s", "available": %s, "path": "%s", "via": "%s", "bin_dir": "%s" }\n' \
    "$1" "$2" "$3" "$4" "$BIN_DIR"
  exit 0
}

# ── Parse arguments ──────────────────────────────────────────────────────────────────────
# A value-taking flag must be followed by a real value. Guard it: a bare `--pypi` at the end
# used to make `shift 2` fail *without consuming anything*, spinning this loop forever.
BAD_ARGS=""
need_value() {  # need_value <flag> <count-remaining> <candidate>
  if [ "$2" -lt 2 ]; then BAD_ARGS="missing value for $1"; return 1; fi
  case "$3" in -*) BAD_ARGS="value for $1 looks like a flag: $3"; return 1 ;; esac
  return 0
}

while [ $# -gt 0 ]; do
  case "$1" in
    --pypi) need_value "$1" "$#" "${2:-}" || break; PYPI="$2"; shift 2 ;;
    --npm)  need_value "$1" "$#" "${2:-}" || break; NPM="$2";  shift 2 ;;
    --brew) need_value "$1" "$#" "${2:-}" || break; BREW="$2"; shift 2 ;;
    --go)   need_value "$1" "$#" "${2:-}" || break; GO="$2";   shift 2 ;;
    --quiet) QUIET=1; shift ;;
    -h|--help) usage; exit 0 ;;
    -*) log "ignoring unknown option: $1"; shift ;;
    *)  if [ -z "$CLI" ]; then CLI="$1"; fi; shift ;;
  esac
done

if [ -n "$BAD_ARGS" ]; then
  log "bad arguments — $BAD_ARGS"
  usage
  emit "${CLI:-null}" false "" ""
fi

if [ -z "$CLI" ]; then
  usage
  log "no cli name given"
  emit "null" false "" ""
fi

# ── Report helper: single JSON line describing the outcome ───────────────────────────────
report() {
  local via="${1:-}" path
  if have "$CLI"; then
    path=$(command -v "$CLI")
    log "$CLI ready → $path${via:+ (via $via)}"
    log "run it as: PATH=\"\$PATH:\$HOME/.local/bin\" $CLI …"
    emit "$CLI" true "$path" "$via"
  fi
  log "$CLI unavailable — install it manually, or continue without it."
  emit "$CLI" false "" ""
}

# Already there? Fast no-op.
have "$CLI" && report "preinstalled"

log "$CLI not found — attempting install…"
mkdir -p "$BIN_DIR" 2>/dev/null || true

# ── SHA-256 verification (portable: coreutils sha256sum or macOS shasum) ─────────────────
sha256_of() {
  if   have sha256sum; then sha256sum "$1" 2>/dev/null | awk '{print $1}'
  elif have shasum;    then shasum -a 256 "$1" 2>/dev/null | awk '{print $1}'
  else return 1; fi
}

# ── Bootstrap uv (a standalone binary — needs no Python, no pip) ─────────────────────────
# This is what makes a Python tool installable on a bare runtime that has python3 without
# pip/ensurepip, or no Python at all: uv ships its own. We fetch the pinned release tarball
# and verify its published SHA-256 — deliberately NOT `curl … | sh`, and with no fallback to
# it, so an unverifiable download means no install rather than running unchecked code.
bootstrap_uv() {
  have uv && return 0
  have curl || { log "no curl — cannot bootstrap uv"; return 1; }
  have tar  || { log "no tar — cannot bootstrap uv";  return 1; }

  local os arch triple tgz url tmp expected actual
  case "$(uname -s)" in
    Linux)  os="unknown-linux-gnu" ;;
    Darwin) os="apple-darwin" ;;
    *) log "unsupported OS $(uname -s) for the uv bootstrap"; return 1 ;;
  esac
  case "$(uname -m)" in
    x86_64|amd64)  arch="x86_64" ;;
    aarch64|arm64) arch="aarch64" ;;
    *) log "unsupported architecture $(uname -m) for the uv bootstrap"; return 1 ;;
  esac
  triple="${arch}-${os}"
  tgz="uv-${triple}.tar.gz"
  url="$UV_BASE/$UV_VERSION/$tgz"

  tmp=$(mktemp -d 2>/dev/null) || { log "mktemp failed"; return 1; }
  log "bootstrapping uv $UV_VERSION ($triple) into $BIN_DIR, verifying SHA-256…"
  if ! curl -fsSL --max-time "$NET_TIMEOUT" "$url" -o "$tmp/$tgz" 2>/dev/null; then
    log "uv download failed (network blocked or asset missing)"; rm -rf "$tmp"; return 1
  fi
  if ! curl -fsSL --max-time 60 "$url.sha256" -o "$tmp/$tgz.sha256" 2>/dev/null; then
    log "uv checksum download failed — refusing to install unverified binary"; rm -rf "$tmp"; return 1
  fi
  expected=$(awk '{print $1}' "$tmp/$tgz.sha256" 2>/dev/null | head -1)
  actual=$(sha256_of "$tmp/$tgz")
  if [ -z "$expected" ] || [ -z "$actual" ]; then
    log "cannot compute/read SHA-256 (no sha256sum/shasum?) — refusing unverified install"
    rm -rf "$tmp"; return 1
  fi
  if [ "$expected" != "$actual" ]; then
    log "SHA-256 MISMATCH for $tgz — refusing to install. expected=$expected actual=$actual"
    rm -rf "$tmp"; return 1
  fi
  log "uv checksum verified ($actual)"
  if tar -xzf "$tmp/$tgz" -C "$tmp" 2>/dev/null; then
    install -m 0755 "$tmp/uv-${triple}/uv"  "$BIN_DIR/uv"  2>/dev/null || \
      { mv "$tmp/uv-${triple}/uv"  "$BIN_DIR/" 2>/dev/null; chmod 0755 "$BIN_DIR/uv"  2>/dev/null; }
    install -m 0755 "$tmp/uv-${triple}/uvx" "$BIN_DIR/uvx" 2>/dev/null || \
      { mv "$tmp/uv-${triple}/uvx" "$BIN_DIR/" 2>/dev/null; chmod 0755 "$BIN_DIR/uvx" 2>/dev/null; }
  fi
  rm -rf "$tmp"
  have uv
}

# ── Strategy: PyPI package ──────────────────────────────────────────────────────────────
try_pypi() {
  [ -n "$PYPI" ] || return 1
  # uv first — fastest, and it can provision its own Python if the system has none.
  if bootstrap_uv; then
    log "installing $PYPI with uv…"
    # Keep uv's shims in our bin dir regardless of platform defaults.
    # --force is deliberate: a leftover shim in BIN_DIR whose target is gone (a wiped tmpdir,
    # a half-removed uv tool) makes uv abort with "Executable already exists", which would
    # otherwise leave the tool permanently unrepairable. We only get here when the CLI is not
    # usable, so there is no working install to clobber.
    UV_TOOL_BIN_DIR="$BIN_DIR" uv tool install --force "$PYPI" >/dev/null 2>&1 || true
    have "$CLI" && { VIA="uv"; return 0; }
  fi
  if have pipx; then
    log "installing $PYPI with pipx…"
    pipx install "$PYPI" >/dev/null 2>&1 || true
    have "$CLI" && { VIA="pipx"; return 0; }
  fi
  local pip
  for pip in pip3 pip; do
    if have "$pip"; then
      log "installing $PYPI with $pip --user…"
      "$pip" install --user --quiet "$PYPI" >/dev/null 2>&1 || true
      have "$CLI" && { VIA="$pip"; return 0; }
    fi
  done
  return 1
}

# ── Strategy: npm package (user-prefixed, so no root needed) ─────────────────────────────
try_npm() {
  [ -n "$NPM" ] || return 1
  have npm || return 1
  log "installing $NPM with npm (prefix $HOME/.local)…"
  npm install -g --prefix "$HOME/.local" "$NPM" >/dev/null 2>&1 || true
  have "$CLI" && { VIA="npm"; return 0; }
  return 1
}

# ── Strategy: Homebrew (macOS hosts; writes to brew's own prefix, not $HOME) ─────────────
try_brew() {
  [ -n "$BREW" ] || return 1
  have brew || return 1
  log "installing $BREW with brew…"
  brew install "$BREW" >/dev/null 2>&1 || true
  have "$CLI" && { VIA="brew"; return 0; }
  return 1
}

# ── Strategy: Go module ──────────────────────────────────────────────────────────────────
try_go() {
  [ -n "$GO" ] || return 1
  have go || return 1
  log "installing $GO with go install…"
  GOBIN="$BIN_DIR" go install "$GO" >/dev/null 2>&1 || true
  have "$CLI" && { VIA="go"; return 0; }
  return 1
}

# Prefer the ecosystem the tool actually ships in; brew/go are host-dependent fallbacks.
try_pypi || try_npm || try_brew || try_go || true

if ! have "$CLI"; then
  # Say precisely why, so the agent can report it instead of guessing.
  if [ -z "$PYPI$NPM$BREW$GO" ]; then
    log "no install source given (pass --pypi/--npm/--brew/--go)"
  elif [ -n "$PYPI" ] && ! have uv && ! have pipx && ! have pip3 && ! have pip; then
    log "no uv/pipx/pip, and the uv bootstrap did not succeed — network blocked, unsupported platform, or checksum mismatch (see above)"
  fi
fi

report "$VIA"
