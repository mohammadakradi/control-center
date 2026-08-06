#!/usr/bin/env bash
# Best-effort, idempotent installer for the security scanners the swe agent relies on:
#   - gitleaks  (secret scanning)
#   - semgrep   (static taint/SAST analysis)
#
# Installation is delegated to ensure-tool.sh, which knows how to get a CLI onto a bare
# machine — including bootstrapping `uv` when the runtime has no pip/pipx/uv at all. That
# matters here: semgrep is a PyPI tool, and a slim container typically has python3 *without*
# pip, so the old pipx/pip-only path silently failed.
#
# Fast no-op when the tools are already present. Never fails the caller — prints a JSON
# summary of what is now available so the auditor knows exactly what it can run.
#
# ─── Reaching the tools afterwards ────────────────────────────────────────────────────────
# Installs land in $HOME/.local/bin, which is *not* on PATH in the agent runtime, and every
# Bash call is a fresh shell (no profile is sourced), so an `export PATH` does NOT persist
# between calls. Extend PATH on each invocation instead — appending, not prepending, so a
# user-writable dir can never shadow a system binary:
#     PATH="$PATH:$HOME/.local/bin" semgrep --config auto .
set -u

# Pinned deliberately (supply-chain): bump when you want newer scanners. semgrep still pulls
# fresh rules at run time via `--config auto`, so a pinned binary is not a stale ruleset.
readonly SEMGREP_PKG="semgrep==1.171.0"
readonly GITLEAKS_VER="8.21.2"
readonly GITLEAKS_GO="github.com/gitleaks/gitleaks/v8@v${GITLEAKS_VER}"

HOME="${HOME:-$(cd ~ 2>/dev/null && pwd || echo /tmp)}"
BIN_DIR="$HOME/.local/bin"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Append, never prepend: enough to find tools that live only here, without letting this
# user-writable dir shadow a system binary.
export PATH="$PATH:$BIN_DIR"

have() { command -v "$1" >/dev/null 2>&1; }
log()  { printf '%s\n' "$*" >&2; }

ensure_tool() { bash "$SCRIPT_DIR/ensure-tool.sh" "$@" >/dev/null 2>&1 || true; }

sha256_of() {
  if   have sha256sum; then sha256sum "$1" 2>/dev/null | awk '{print $1}'
  elif have shasum;    then shasum -a 256 "$1" 2>/dev/null | awk '{print $1}'
  else return 1; fi
}

# ── gitleaks: a single static Go binary. Try brew/go, then fall back to the release tarball
#    (works on a machine with neither, needing only curl + tar). The tarball is verified
#    against the release's published checksums file before anything is extracted — a pinned
#    version alone would not detect a tampered artifact at that URL. ───────────────────────
ensure_gitleaks() {
  have gitleaks && return 0
  ensure_tool gitleaks --brew gitleaks --go "$GITLEAKS_GO"
  have gitleaks && return 0

  log "[ensure-tools] gitleaks — falling back to the pinned release binary…"
  have curl || return 1
  local os arch tgz url sums tmp expected actual
  os=$(uname -s | tr '[:upper:]' '[:lower:]'); arch=$(uname -m)
  case "$arch" in x86_64|amd64) arch=x64;; arm64|aarch64) arch=arm64;; esac
  tgz="gitleaks_${GITLEAKS_VER}_${os}_${arch}.tar.gz"
  url="https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VER}/${tgz}"
  sums="https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VER}/gitleaks_${GITLEAKS_VER}_checksums.txt"
  tmp=$(mktemp -d) || return 1

  if ! curl -fsSL --max-time 180 "$url" -o "$tmp/$tgz" 2>/dev/null; then
    log "[ensure-tools] gitleaks download failed"; rm -rf "$tmp"; return 1
  fi
  if ! curl -fsSL --max-time 60 "$sums" -o "$tmp/sums.txt" 2>/dev/null; then
    log "[ensure-tools] gitleaks checksums unavailable — refusing unverified binary"
    rm -rf "$tmp"; return 1
  fi
  expected=$(awk -v f="$tgz" '$2 == f {print $1}' "$tmp/sums.txt" | head -1)
  actual=$(sha256_of "$tmp/$tgz")
  if [ -z "$expected" ] || [ -z "$actual" ] || [ "$expected" != "$actual" ]; then
    log "[ensure-tools] gitleaks SHA-256 verification FAILED (expected=${expected:-none} actual=${actual:-none}) — not installing"
    rm -rf "$tmp"; return 1
  fi
  log "[ensure-tools] gitleaks checksum verified ($actual)"
  mkdir -p "$BIN_DIR"
  tar -xzf "$tmp/$tgz" -C "$tmp" gitleaks 2>/dev/null \
    && install -m 0755 "$tmp/gitleaks" "$BIN_DIR/gitleaks" 2>/dev/null
  rm -rf "$tmp"
  have gitleaks
}

# ── semgrep: PyPI. ensure-tool.sh bootstraps uv when there's no Python package manager. ───
ensure_semgrep() {
  have semgrep && return 0
  ensure_tool semgrep --pypi "$SEMGREP_PKG" --brew semgrep
  have semgrep
}

ensure_gitleaks || true
ensure_semgrep  || true

# Report only tools that actually resolve *and* are executable. `command -v` already rejects a
# fully dangling symlink, but not one whose target exists with the executable bit lost — that
# looks installed and fails on use, which is worse than a clean miss.
usable() { have "$1" && [ -x "$(command -v "$1")" ]; }

printf '{ "gitleaks": %s, "semgrep": %s, "bin_dir": "%s", "invoke_prefix": "PATH=\\"$PATH:$HOME/.local/bin\\"" }\n' \
  "$(usable gitleaks && echo true || echo false)" \
  "$(usable semgrep  && echo true || echo false)" \
  "$BIN_DIR"
