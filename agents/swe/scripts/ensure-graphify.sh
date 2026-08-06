#!/usr/bin/env bash
# Ensure the `graphify` code-graph tool is installed and the project's graph is built.
#
# graphify (PyPI package `graphifyy`, CLI `graphify`) turns a codebase into a queryable
# knowledge graph (graphify-out/graph.json) so the agent can understand structure and
# relationships by querying the graph instead of brute-force reading/grepping — far fewer
# tokens. See https://github.com/Graphify-Labs/graphify.
#
# Installation is delegated to ensure-tool.sh, which knows how to get a CLI onto a bare
# machine — including bootstrapping `uv` (a standalone binary) when the runtime has no
# pip/pipx/uv at all, which is the common case in a slim container.
#
# Idempotent and FAIL-SOFT: if it can't install or build, it prints why and exits 0 so
# onboarding never breaks — the agent simply falls back to normal code search.
#
# Usage: bash ensure-graphify.sh [PROJECT_DIR]   (defaults to the current directory)
#
# NOTE — running graphify afterwards: it installs into $HOME/.local/bin, which is *not* on
# PATH in the agent runtime (no shell profile is sourced; every Bash call is a fresh shell).
# Extend PATH on each invocation, appending so this user-writable dir can never shadow a
# system binary:
#     PATH="$PATH:$HOME/.local/bin" graphify query "…"
set -uo pipefail

# Pinned deliberately: `graphifyy` (double-y) is a plausible typosquat target, so we don't
# silently track "latest". Bump this line when you want a newer graphify.
readonly GRAPHIFY_PKG="graphifyy==0.9.29"

PROJECT_DIR="${1:-.}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOME="${HOME:-$(cd ~ 2>/dev/null && pwd || echo /tmp)}"
export PATH="$PATH:$HOME/.local/bin"

have() { command -v "$1" >/dev/null 2>&1; }

# 1. Ensure the CLI is installed (delegated — handles the no-package-manager case).
if ! have graphify; then
  bash "$SCRIPT_DIR/ensure-tool.sh" graphify --pypi "$GRAPHIFY_PKG" >/dev/null || true
fi

if ! have graphify; then
  echo "[graphify] could not install — skipping. The agent will fall back to normal code"
  echo "           search (grep/read, or the explorer subagent)."
  exit 0
fi
echo "[graphify] $(graphify --version 2>/dev/null || echo installed)"

# 2. Build or refresh the project graph.
GRAPH="$PROJECT_DIR/graphify-out/graph.json"
if [ -f "$GRAPH" ]; then
  echo "[graphify] refreshing existing graph (no LLM needed)…"
  if ! out=$(graphify update "$PROJECT_DIR" 2>&1); then
    printf '%s\n' "$out" | tail -5
    echo "[graphify] update failed (see above) — keeping the existing graph."
  else
    printf '%s\n' "$out" | tail -2
  fi
else
  echo "[graphify] building project graph (AST extraction — no API key required)…"
  # --code-only is what actually keeps this key-free: without it, `extract` runs LLM-based
  # semantic extraction over docs/images and hard-fails when no backend key is set (any repo
  # with a README or a PNG hits this). --no-cluster additionally skips community clustering,
  # which is also LLM-backed — together they make the build fast and deterministic.
  # For richer cross-file semantic edges, set a backend key (e.g. GEMINI_API_KEY) and run
  # `graphify extract .` once without these flags.
  if ! out=$(graphify extract "$PROJECT_DIR" --code-only --no-cluster 2>&1); then
    printf '%s\n' "$out" | tail -5
    echo "[graphify] build failed (see above) — falling back to normal code search."
    exit 0
  fi
  printf '%s\n' "$out" | tail -2
fi

# 3. Keep the generated graph out of version control (it's regenerable).
GI="$PROJECT_DIR/.gitignore"
if [ -f "$GI" ] && ! grep -qxF "graphify-out/" "$GI"; then
  printf '\n# graphify code-graph (generated; rebuild with `graphify update .`)\ngraphify-out/\n' >> "$GI"
  echo "[graphify] added graphify-out/ to .gitignore"
fi

if [ -f "$GRAPH" ]; then
  echo "[graphify] ready → $GRAPH"
  echo "[graphify] IMPORTANT: \$HOME/.local/bin is not on PATH — invoke graphify as:"
  echo "[graphify]   PATH=\"\$PATH:\$HOME/.local/bin\" graphify query \"…\""
  echo "[graphify] commands: query \"…\" | path \"A\" \"B\" | explain \"X\" | affected \"X\""
fi
exit 0
