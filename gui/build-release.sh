#!/bin/sh
# Build the Homebrew-cask release artifact: Agentctl.app with the agentctl + agentctl CLI
# bundled inside (Contents/Resources/cli), then zip it. The cask installs the app and
# symlinks the bundled bin shims onto PATH; they run on Node (depends_on node).
set -eu
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "› npm run build"
npm run build >/dev/null

echo "› swift build -c release"
( cd gui/AgentctlBar && swift build -c release >/dev/null )
BIN="gui/AgentctlBar/.build/release/AgentctlBar"

APP="gui/Agentctl.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BIN" "$APP/Contents/MacOS/AgentctlBar"
cp gui/AgentctlBar/Info.plist "$APP/Contents/Info.plist"
cp gui/AgentctlBar/AppIcon.icns "$APP/Contents/Resources/AppIcon.icns"
# Single source of truth for the app version: package.json, stamped in at build time so the
# bundle can never report a stale literal (it sat at 0.2.1 through two releases).
VERSION=$(node -p "require('./package.json').version")
/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $VERSION" "$APP/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleVersion $VERSION" "$APP/Contents/Info.plist"


# ── bundle the CLI (production deps only) inside the app ──
echo "› staging cli/ with production node_modules"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
cp package.json package-lock.json "$STAGE/"
( cd "$STAGE" && npm ci --omit=dev --silent >/dev/null )

CLI="$APP/Contents/Resources/cli"
mkdir -p "$CLI"
cp -R dist "$CLI/dist"
cp -R bin "$CLI/bin"
cp -R "$STAGE/node_modules" "$CLI/node_modules"
cp package.json "$CLI/package.json"
chmod +x "$CLI/bin/"*

# ad-hoc sign (un-notarized, local use — same as Cloney/LanGuard)
codesign --force --deep --sign - "$APP" >/dev/null 2>&1 || true

# ── zip ──
ZIP="gui/agentctl.zip"
rm -f "$ZIP"
( cd gui && ditto -c -k --sequesterRsrc --keepParent "Agentctl.app" "agentctl.zip" )

SHA=$(shasum -a 256 "$ZIP" | cut -d' ' -f1)
SIZE=$(du -h "$ZIP" | cut -f1)
echo "✓ built $ROOT/$ZIP  ($SIZE)"
echo "  sha256: $SHA"
