#!/usr/bin/env bash
# Launcher for the Playwright MCP server that the qa agent drives.
#
# Why a wrapper instead of putting the flags straight in .mcp.json:
#   1. --storage-state and --secrets point at files that must EXIST before the server starts.
#      A fresh clone has neither, and a plugin whose MCP server dies on first launch is a
#      plugin that looks broken. This creates them (empty, harmless) and carries on.
#   2. Per-project settings (headless, viewport, browser, test-id attribute) belong to the
#      project, not to the plugin. They are read from .qa/config.json here so a project can
#      change them without editing the plugin.
#
# Fail-soft: every lookup has a default. A missing/!valid config.json is ignored, not fatal.
set -uo pipefail

PROJECT_DIR="${QA_PROJECT_DIR:-$PWD}"
QA_DIR="$PROJECT_DIR/.qa"
AUTH_DIR="$QA_DIR/auth"
STORAGE_STATE="$AUTH_DIR/storageState.json"
SECRETS="$AUTH_DIR/secrets.env"
ARTIFACTS="$QA_DIR/artifacts"
CONFIG="$QA_DIR/config.json"

# Pinned on purpose. Bump deliberately and re-run /qa:onboard so a tool-name change in the
# server is noticed at onboarding time rather than halfway through a test run.
MCP_VERSION="0.0.83"

mkdir -p "$AUTH_DIR" "$ARTIFACTS" 2>/dev/null || true

# An empty storage state is a valid one: "no cookies, no origins". /qa:auth overwrites it.
[ -f "$STORAGE_STATE" ] || printf '{"cookies":[],"origins":[]}\n' > "$STORAGE_STATE" 2>/dev/null || true
if [ ! -f "$SECRETS" ]; then
  printf '# Secrets for QA runs, dotenv format. Referenced in scenarios as <secret>NAME</secret>.\n# The browser substitutes them at type-time; their values never enter the transcript.\n# Example:\n#   QA_PASSWORD=...\n' > "$SECRETS" 2>/dev/null || true
  chmod 600 "$SECRETS" 2>/dev/null || true
fi

# --- per-project overrides -------------------------------------------------------------
cfg() { # cfg <json-path> <default>
  node -e '
    const fs=require("fs");
    try{
      const c=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
      const v=process.argv[2].split(".").reduce((o,k)=>(o==null?o:o[k]),c);
      process.stdout.write(v===undefined||v===null?process.argv[3]:String(v));
    }catch{ process.stdout.write(process.argv[3]); }
  ' "$CONFIG" "$1" "$2" 2>/dev/null || printf '%s' "$2"
}

HEADLESS=$(cfg headless true)
VIEWPORT=$(cfg viewport 1440x900)
BROWSER=$(cfg browser chrome)
TEST_ID=$(cfg testIdAttribute data-testid)
ACTION_TIMEOUT=$(cfg timeouts.action 10000)
NAV_TIMEOUT=$(cfg timeouts.navigation 60000)

ARGS=(
  -y "@playwright/mcp@${MCP_VERSION}"
  --isolated
  --browser "$BROWSER"
  --viewport-size "$VIEWPORT"
  --test-id-attribute "$TEST_ID"
  --console-level error
  --timeout-action "$ACTION_TIMEOUT"
  --timeout-navigation "$NAV_TIMEOUT"
  --storage-state "$STORAGE_STATE"
  --secrets "$SECRETS"
  --output-dir "$ARTIFACTS"
  --save-session
)
[ "$HEADLESS" = "true" ] && ARGS+=(--headless)

# Optional origin blocklist, e.g. keep a run off analytics/payment providers.
BLOCKED=$(cfg blockedOrigins "")
[ -n "$BLOCKED" ] && ARGS+=(--blocked-origins "$BLOCKED")

exec npx "${ARGS[@]}"
