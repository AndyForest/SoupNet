#!/usr/bin/env bash
# Build the Soup.net MCP desktop extension (.mcpb)
#
# Usage: cd apps/mcp-server && bash bundle.sh
#
# Output: soupnet.mcpb (a ZIP archive installable by Claude Desktop)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BUNDLE_DIR="$SCRIPT_DIR/.bundle"
OUT_FILE="$SCRIPT_DIR/soupnet.mcpb"

echo "=== Building Soup.net MCP extension ==="

# 1. Bundle TypeScript into a single JS file
echo "Bundling TypeScript..."
npx tsup "$SCRIPT_DIR/src/index.ts" \
  --format esm \
  --target node20 \
  --outDir "$SCRIPT_DIR/dist" \
  --no-splitting \
  --silent

# 2. Assemble bundle directory
rm -rf "$BUNDLE_DIR"
mkdir -p "$BUNDLE_DIR/server"

cp "$SCRIPT_DIR/manifest.json" "$BUNDLE_DIR/"
cp "$SCRIPT_DIR/dist/index.mjs" "$BUNDLE_DIR/server/index.js"

# 3. Package as .mcpb (ZIP)
rm -f "$OUT_FILE"
cd "$BUNDLE_DIR"
if command -v zip &>/dev/null; then
  zip -r "$OUT_FILE" . -x '.*'
else
  # Fallback for Windows — PowerShell requires .zip extension, rename after
  WIN_BUNDLE=$(cygpath -w "$BUNDLE_DIR")
  WIN_ZIP=$(cygpath -w "${OUT_FILE%.mcpb}.zip")
  powershell -Command "Compress-Archive -Path '$WIN_BUNDLE\\*' -DestinationPath '$WIN_ZIP' -Force"
  mv "${OUT_FILE%.mcpb}.zip" "$OUT_FILE"
fi

# 4. Cleanup
rm -rf "$BUNDLE_DIR"

SIZE=$(wc -c < "$OUT_FILE" | tr -d ' ')
echo "=== Built: soupnet.mcpb ($SIZE bytes) ==="
