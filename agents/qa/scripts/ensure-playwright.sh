#!/usr/bin/env bash
# Make the machine able to run browser QA. Idempotent, always exits 0, never hangs.
# Prints a one-line JSON summary, in the spirit of the other agents' ensure-tool.sh.
set -uo pipefail

have_node=false; have_npx=false; chrome=""; chromium_installed=false; pw=false
command -v node >/dev/null 2>&1 && have_node=true
command -v npx  >/dev/null 2>&1 && have_npx=true

for c in "/Applications/Google Chrome.app" "/Applications/Chromium.app" \
         "/usr/bin/google-chrome" "/usr/bin/chromium" "/usr/bin/chromium-browser"; do
  [ -e "$c" ] && { chrome="$c"; break; }
done

# The MCP server drives the installed Chrome channel, so it needs no download. Generated
# Playwright specs run on bundled chromium, which does.
if $have_npx; then
  npx --yes playwright install chromium >/dev/null 2>&1 && chromium_installed=true
  npx --yes playwright --version >/dev/null 2>&1 && pw=true
fi

printf '{"node":%s,"npx":%s,"chrome":"%s","chromiumForSpecs":%s,"playwrightCli":%s}\n' \
  "$have_node" "$have_npx" "${chrome:-}" "$chromium_installed" "$pw"
exit 0
