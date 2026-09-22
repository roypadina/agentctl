#!/bin/sh
# Build AgentctlBar.app (menu-bar agent) — release binary + .app bundle + ad-hoc sign.
set -eu
cd "$(dirname "$0")/AgentctlBar"

echo "› swift build -c release"
swift build -c release >/dev/null
BIN=".build/release/AgentctlBar"

APP="../Agentctl.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BIN" "$APP/Contents/MacOS/AgentctlBar"
cp Info.plist "$APP/Contents/Info.plist"
cp AppIcon.icns "$APP/Contents/Resources/AppIcon.icns"
# Single source of truth for the app version: package.json, stamped in at build time so the
# bundle can never report a stale literal (it sat at 0.2.1 through two releases).
VERSION=$(node -p "require('../../package.json').version")
/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $VERSION" "$APP/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleVersion $VERSION" "$APP/Contents/Info.plist"


# ad-hoc sign (same approach as Cloney; un-notarized, local use)
codesign --force --deep --sign - "$APP" >/dev/null 2>&1 || true

echo "✓ built $(cd .. && pwd)/Agentctl.app"
echo "  run:  open '$(cd .. && pwd)/Agentctl.app'   (look for ✦ in the menu bar)"
echo "  needs 'agentctl' on PATH — install it (brew, or 'npm link' from the repo root) first."
