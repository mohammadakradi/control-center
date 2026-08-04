#!/bin/sh
# Create (or refresh) "Control Center.app" so the app launches like any other Mac app — from
# Launchpad, Spotlight or the Applications folder, with its own Dock icon and no terminal.
#
#   sh infra/release/make-app-bundle.sh            # → /Applications, else ~/Applications
#   sh infra/release/make-app-bundle.sh ~/Desktop
#
# Run by install.sh, re-run after every update by the CLI, and available as
# `control-center install-app`.
#
# Two kinds of bundle, decided by what's on the machine:
#
#   native (preferred) — infra/native/ControlCenter.swift compiled with the Swift that ships in
#     Xcode Command Line Tools. It owns its window, so the Dock shows OUR icon and ⌘Tab lists
#     Control Center rather than Chrome. Compiling locally also means nothing is downloaded and
#     therefore nothing is quarantined: no signing, no notarisation, no Gatekeeper prompt.
#
#   launcher (fallback) — a shell script that starts the server and opens a browser window.
#     Same Applications/Launchpad entry and icon, but the window belongs to Chrome, so the Dock
#     shows Chrome's icon. Used when `swiftc` isn't installed.
set -eu

APP_NAME="Control Center"
CC_HOME="${CC_HOME:-$HOME/.control-center}"
root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)

[ "$(uname -s)" = "Darwin" ] || {
  echo "error: app bundles are a macOS thing; nothing to do here." >&2
  exit 1
}

if [ $# -gt 0 ]; then
  dest_dir=$1
elif [ -w /Applications ]; then
  dest_dir=/Applications
else
  # Normal on a managed Mac; Launchpad and Spotlight index this too.
  dest_dir="$HOME/Applications"
  mkdir -p "$dest_dir"
fi
app="$dest_dir/$APP_NAME.app"

# The CLI that starts the server, applies updates and runs migrations. Prefer an installed copy;
# fall back to this checkout so the bundle also works in a dev tree.
if [ -x "$HOME/.local/bin/control-center" ]; then
  cli="$HOME/.local/bin/control-center"
elif [ -x "$CC_HOME/app/infra/release/control-center.sh" ]; then
  cli="$CC_HOME/app/infra/release/control-center.sh"
else
  cli="$root/infra/release/control-center.sh"
fi

# Sources and icon: the installed copy first (so an update refreshes them), else this checkout.
for base in "$CC_HOME/app" "$root"; do
  [ -f "$base/infra/native/ControlCenter.swift" ] && src_root=$base && break
done
: "${src_root:=$root}"
icon="$src_root/public/icons/app.icns"

# Build into a staging copy, then rename it into place. `mv` is atomic and leaves a *running*
# app's inode alone — refreshing the bundle during an update must not break the app doing it.
stage=$(mktemp -d "${TMPDIR:-/tmp}/cc-bundle.XXXXXX")
trap 'rm -rf "$stage"' EXIT INT TERM
staged="$stage/$APP_NAME.app"
mkdir -p "$staged/Contents/MacOS" "$staged/Contents/Resources"

kind=launcher
if command -v swiftc >/dev/null 2>&1 && [ -f "$src_root/infra/native/ControlCenter.swift" ]; then
  echo "Compiling the native app (Swift)…"
  if swiftc -O -whole-module-optimization \
    -o "$staged/Contents/MacOS/ControlCenterApp" \
    "$src_root/infra/native/ControlCenter.swift" 2>"$stage/swift.log"; then
    kind=native
  else
    echo "warning: the native build failed; falling back to the browser launcher." >&2
    sed 's/^/  /' "$stage/swift.log" >&2 || :
  fi
fi

if [ "$kind" = launcher ]; then
  cat >"$staged/Contents/MacOS/ControlCenterApp" <<LAUNCHER
#!/bin/sh
# Generated fallback: start the server, then open a browser window.
mkdir -p "\$HOME/.control-center/logs"
exec >>"\$HOME/.control-center/logs/launcher.log" 2>&1
echo "--- launched \$(date) ---"
exec "$cli" start
LAUNCHER
fi
chmod +x "$staged/Contents/MacOS/ControlCenterApp"

# LSUIElement only for the fallback: that one hands off to Chrome and exits, so a Dock entry
# would just flicker. The native app *is* the window and must be a normal app.
extra=""
[ "$kind" = launcher ] && extra="  <key>LSUIElement</key><true/>"

cat >"$staged/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>$APP_NAME</string>
  <key>CFBundleDisplayName</key><string>$APP_NAME</string>
  <key>CFBundleIdentifier</key><string>dev.controlcenter.app</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <!-- Not "ControlCenter": macOS runs its own process by that name, and two of them in
       Activity Monitor is needlessly confusing. The display name is unaffected. -->
  <key>CFBundleExecutable</key><string>ControlCenterApp</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <!-- The dashboard is plain HTTP on loopback; App Transport Security blocks that by
       default, and there is nothing to encrypt between a process and localhost. -->
  <key>NSAppTransportSecurity</key>
  <dict>
    <key>NSAllowsLocalNetworking</key><true/>
    <key>NSExceptionDomains</key>
    <dict>
      <key>localhost</key>
      <dict><key>NSExceptionAllowsInsecureHTTPLoads</key><true/></dict>
    </dict>
  </dict>
$extra
</dict>
</plist>
PLIST

if [ -f "$icon" ]; then
  cp "$icon" "$staged/Contents/Resources/AppIcon.icns"
else
  echo "warning: no app.icns at $icon — the bundle will use the generic app icon." >&2
fi

old=""
[ -d "$app" ] && old="$stage/old.app" && mv "$app" "$old"
mv "$staged" "$app"
rm -rf "$old"

# Nudge Launch Services so Finder, Launchpad and Spotlight pick up the (possibly new) icon.
touch "$app"
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister \
  -f "$app" >/dev/null 2>&1 || :

if [ "$kind" = native ]; then
  echo "Installed $app (native window — its own Dock icon)"
else
  echo "Installed $app (browser launcher — install Xcode Command Line Tools for a native window:"
  echo "  xcode-select --install)"
fi
echo "Open it from Launchpad, Spotlight, or $dest_dir — no terminal needed."
