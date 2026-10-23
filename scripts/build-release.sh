#!/bin/sh
# Build the Homebrew-cask release artifact: the agentctl CLI with its production node_modules,
# zipped as agentctl/ → release/agentctl.zip. The cask symlinks agentctl/bin/agentctl onto PATH;
# it runs on Node (depends_on node).
set -eu
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "› npm run build"
npm run build >/dev/null

OUT="release"
PKG="$OUT/agentctl"
rm -rf "$OUT"
mkdir -p "$PKG"

echo "› staging production node_modules"
cp package.json package-lock.json "$PKG/"
( cd "$PKG" && npm ci --omit=dev --silent >/dev/null )
rm "$PKG/package-lock.json"
cp -R dist bin config.example.toml "$PKG/"
chmod +x "$PKG/bin/"*

( cd "$OUT" && ditto -c -k --norsrc --noextattr --keepParent agentctl agentctl.zip )

SHA=$(shasum -a 256 "$OUT/agentctl.zip" | cut -d' ' -f1)
SIZE=$(du -h "$OUT/agentctl.zip" | cut -f1)
echo "✓ built $ROOT/$OUT/agentctl.zip  ($SIZE)"
echo "  sha256: $SHA"
