#!/bin/sh
# Refresh the vendored agent plugins in `agents/` from their source checkouts.
#
# `agents/` is what ships in the release tarball (pack.sh) and what a fresh install discovers
# when the machine has no Claude Code marketplace entries — so it must not drift from the
# sources. Run this after changing an agent, then commit the result.
#
# Sources default to siblings of the repo (../swe-agent, ../fe-agent, ../pm-agent);
# CC_AGENT_SRC points somewhere else.
set -eu

root=$(cd "$(dirname "$0")/../.." && pwd)
src_root=${CC_AGENT_SRC:-$(dirname "${root}")}

for name in swe fe pm; do
  src="${src_root}/${name}-agent"
  [ -d "${src}" ] || {
    printf 'error: %s not found. Set CC_AGENT_SRC to the directory holding the agent checkouts.\n' "${src}" >&2
    exit 1
  }
  [ -f "${src}/.claude-plugin/plugin.json" ] || {
    printf 'error: %s is not a plugin directory (no .claude-plugin/plugin.json).\n' "${src}" >&2
    exit 1
  }

  mkdir -p "${root}/agents/${name}"
  rsync -a --delete \
    --exclude '.git' --exclude '.DS_Store' --exclude 'node_modules' \
    "${src}/" "${root}/agents/${name}/"

  version=$(node -p "require('${root}/agents/${name}/.claude-plugin/plugin.json').version" 2>/dev/null || printf 'unknown')
  printf '  %-4s v%-8s <- %s\n' "${name}" "${version}" "${src}"
done

printf 'Vendored agents refreshed. Review `git diff agents/` and commit.\n'
