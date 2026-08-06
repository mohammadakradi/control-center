#!/usr/bin/env bash
# Smoke tests for ensure-tool.sh — guards the two claims that callers actually depend on:
# "always exits 0" and "never hangs". Every case runs under `timeout`, so a hang fails loudly
# (exit 124) instead of stalling the agent's Bash call, which is how the argument-parsing
# infinite loop originally slipped through.
#
# Usage: bash test-ensure-tool.sh
# Exits non-zero if any case fails. Needs no network for the offline cases; the two
# network-dependent cases are skipped automatically when PyPI is unreachable.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET="$SCRIPT_DIR/ensure-tool.sh"
PASS=0
FAIL=0
CASE_TIMEOUT=25   # generous: covers a real uv bootstrap + install on a slow link

ok()   { printf '  ok   %s\n' "$1"; PASS=$((PASS+1)); }
bad()  { printf '  FAIL %s — %s\n' "$1" "$2"; FAIL=$((FAIL+1)); }

# run_case <name> <expect-available: true|false> [args…]
# Asserts: exit code 0 (never 124/timeout), stdout is a single valid JSON object, and the
# `available` field matches.
run_case() {
  local name="$1" expect="$2"; shift 2
  local out rc
  out=$(timeout "$CASE_TIMEOUT" bash "$TARGET" "$@" 2>/dev/null)
  rc=$?
  if [ "$rc" -eq 124 ]; then bad "$name" "HUNG (timed out after ${CASE_TIMEOUT}s)"; return; fi
  if [ "$rc" -ne 0 ]; then bad "$name" "exit=$rc, expected 0 (fail-soft contract)"; return; fi
  if ! printf '%s' "$out" | python3 -c '
import json,sys
d=json.load(sys.stdin)
assert isinstance(d,dict), "not an object"
for k in ("tool","available","path","via","bin_dir"): assert k in d, f"missing key {k}"
' 2>/dev/null; then
    bad "$name" "stdout is not the documented JSON object: $out"; return
  fi
  local got
  got=$(printf '%s' "$out" | python3 -c 'import json,sys; print(str(json.load(sys.stdin)["available"]).lower())')
  if [ "$got" != "$expect" ]; then bad "$name" "available=$got, expected $expect"; return; fi
  ok "$name"
}

echo "ensure-tool.sh smoke tests → $TARGET"
echo

echo "-- contract: fail-soft on bad input (must never hang) --"
run_case "no arguments"                       false
run_case "unknown tool, no install source"    false definitely-not-a-real-tool
# Regression: a value-taking flag as the final token used to spin forever, because a failed
# `shift 2` consumes nothing. One case per flag.
run_case "trailing --pypi with no value"      false sometool --pypi
run_case "trailing --npm with no value"       false sometool --npm
run_case "trailing --brew with no value"      false sometool --brew
run_case "trailing --go with no value"        false sometool --go
# Regression: a flag must not swallow the *next flag* as its value.
run_case "--pypi followed by another flag"    false sometool --pypi --quiet
run_case "unknown option is ignored"          false sometool --not-a-real-flag

echo
echo "-- contract: idempotent no-op for a tool already present --"
# `sh` is guaranteed on any POSIX machine, so this exercises the preinstalled fast path.
run_case "already-installed tool (sh)"        true  sh

echo
echo "-- network cases (skipped if PyPI is unreachable) --"
if curl -fsS --max-time 10 -o /dev/null https://pypi.org/simple/ 2>/dev/null; then
  run_case "nonexistent PyPI package"         false nope-cli --pypi 'this-package-does-not-exist-xyz123==9.9.9'

  # Regression: a leftover shim pointing at a vanished target used to make `uv tool install`
  # abort with "Executable already exists", leaving the tool permanently unrepairable — the
  # exact state a wiped /tmp venv or a half-removed uv tool leaves behind. Must self-heal.
  # Runs against a scratch HOME so the real environment is untouched.
  stale_shim_case() {
    local name="recovers from a stale/dangling shim" scratch out rc
    scratch=$(mktemp -d) || { bad "$name" "mktemp failed"; return; }
    mkdir -p "$scratch/home/.local/bin"
    ln -s "$scratch/home/.local/share/uv/tools/cowsay/bin/cowsay" "$scratch/home/.local/bin/cowsay"
    out=$(HOME="$scratch/home" timeout 120 bash "$TARGET" cowsay --pypi 'cowsay==6.1' 2>/dev/null)
    rc=$?
    if [ "$rc" -ne 0 ]; then bad "$name" "exit=$rc"; rm -rf "$scratch"; return; fi
    local avail
    avail=$(printf '%s' "$out" | python3 -c 'import json,sys; print(str(json.load(sys.stdin)["available"]).lower())' 2>/dev/null)
    if [ "$avail" != "true" ]; then
      bad "$name" "did not recover (available=$avail) — is --force missing from uv tool install?"
    elif [ ! -x "$scratch/home/.local/bin/cowsay" ]; then
      bad "$name" "shim still broken after install"
    else
      ok "$name"
    fi
    rm -rf "$scratch"
  }
  stale_shim_case
else
  echo "  skip  network cases (PyPI unreachable)"
fi

echo
echo "-- checksum gate (hermetic: local fixture server, no internet needed) --"
# The SHA-256 verification is the security-critical part of the uv bootstrap: it is what lets us
# drop `curl | sh`. Assert it actually refuses a tampered artifact rather than trusting that it
# would. Served from a local fixture so this is fast and offline-safe.
#
# KNOWN COVERAGE GAP (deliberate, documented rather than hidden): this only tests the
# reject-on-mismatch direction. Nothing here guarantees the accept-on-match path executes,
# because bootstrap_uv() returns early via `have uv` whenever uv is already on PATH — true on
# most dev boxes after the first bootstrap. So a future bug that made the comparison *always*
# reject would still pass this suite while breaking real installs. The success path is covered
# by the manual clean-slate run in .swe/test-scenarios/agent-tool-autoinstall.md. Closing this
# properly means serving a real cached uv tarball with its correct checksum, or refactoring
# sha256_of/comparison to be unit-testable on their own.
checksum_case() {
  local name="refuses a tampered uv tarball" scratch triple os arch port out rc srv
  command -v python3 >/dev/null 2>&1 || { echo "  skip  $name (no python3)"; return; }
  case "$(uname -s)" in Linux) os="unknown-linux-gnu";; Darwin) os="apple-darwin";;
    *) echo "  skip  $name (unsupported OS)"; return;; esac
  case "$(uname -m)" in x86_64|amd64) arch="x86_64";; aarch64|arm64) arch="aarch64";;
    *) echo "  skip  $name (unsupported arch)"; return;; esac
  triple="${arch}-${os}"

  scratch=$(mktemp -d) || { bad "$name" "mktemp failed"; return; }
  mkdir -p "$scratch/srv/$UV_VER_FOR_TEST" "$scratch/home"
  # A bogus "tarball" plus a checksum that deliberately does not match it.
  printf 'this is not a real uv tarball' > "$scratch/srv/$UV_VER_FOR_TEST/uv-${triple}.tar.gz"
  printf '%s  uv-%s.tar.gz\n' "$(printf 'something else entirely' | sha256sum | awk '{print $1}')" \
    "$triple" > "$scratch/srv/$UV_VER_FOR_TEST/uv-${triple}.tar.gz.sha256"

  port=$(python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1]);s.close()')
  (cd "$scratch/srv" && exec python3 -m http.server "$port" --bind 127.0.0.1 >/dev/null 2>&1) &
  srv=$!
  # Wait for the fixture server to accept connections.
  local i=0
  while [ $i -lt 50 ] && ! curl -fsS --max-time 1 -o /dev/null "http://127.0.0.1:$port/" 2>/dev/null; do
    i=$((i+1)); sleep 0.1
  done

  # Sanitized PATH (system dirs only) so a real `uv` on the host can't satisfy the check and
  # skip the bootstrap we're trying to exercise.
  out=$(HOME="$scratch/home" PATH="/usr/local/bin:/usr/bin:/bin" \
        ENSURE_TOOL_UV_BASE="http://127.0.0.1:$port" \
        timeout 60 bash "$TARGET" faketool-chk --pypi 'cowsay==6.1' 2>&1)
  rc=$?
  kill "$srv" 2>/dev/null; wait "$srv" 2>/dev/null

  if [ "$rc" -ne 0 ]; then bad "$name" "exit=$rc, expected 0"; rm -rf "$scratch"; return; fi
  if ! printf '%s' "$out" | grep -q "SHA-256 MISMATCH"; then
    bad "$name" "no mismatch reported — is the checksum gate wired up? got: $out"
  elif [ -e "$scratch/home/.local/bin/uv" ]; then
    bad "$name" "installed uv despite a bad checksum"
  else
    ok "$name"
  fi
  rm -rf "$scratch"
}
# Keep in step with UV_VERSION in ensure-tool.sh (read it out so the two can't silently drift).
UV_VER_FOR_TEST=$(awk -F'"' '/^readonly UV_VERSION=/{print $2; exit}' "$TARGET")
if [ -z "$UV_VER_FOR_TEST" ]; then
  bad "refuses a tampered uv tarball" "could not read UV_VERSION from $TARGET"
else
  checksum_case
fi

echo
printf 'passed: %d   failed: %d\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
echo "all ensure-tool.sh smoke tests passed."
