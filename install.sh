#!/bin/bash
# ────────────────────────────────────────────────────────────
# Agents Office — One-Line Installer
#
# Usage:
#   bash <(curl -sSL https://raw.githubusercontent.com/luca-actimento/agents-office/main/install.sh)
#
# What it does:
#   1. Downloads the latest .vsix from GitHub Releases
#   2. Installs it into VS Code
#   3. Prompts you to reload
# ────────────────────────────────────────────────────────────
set -e

REPO="luca-actimento/agents-office"
VSIX_NAME="agents-office.vsix"
TMP_DIR=$(mktemp -d)

cleanup() { rm -rf "$TMP_DIR"; }
trap cleanup EXIT

echo ""
echo "  ╔══════════════════════════════════════╗"
echo "  ║     Agents Office — Installer        ║"
echo "  ╚══════════════════════════════════════╝"
echo ""

# ── Check for VS Code CLI ──────────────────────────────────
CODE_CMD=""
if command -v code &>/dev/null; then
  CODE_CMD="code"
elif command -v code-insiders &>/dev/null; then
  CODE_CMD="code-insiders"
elif [ -f "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" ]; then
  CODE_CMD="/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code"
fi

if [ -z "$CODE_CMD" ]; then
  echo "  [!] VS Code CLI (code) not found."
  echo "      Open VS Code → Cmd+Shift+P → 'Shell Command: Install code command'"
  echo "      Then re-run this script."
  exit 1
fi

echo "  [1/3] Downloading latest release..."

# ── Download latest .vsix from GitHub Releases ─────────────
DOWNLOAD_URL=$(curl -sSL "https://api.github.com/repos/$REPO/releases/latest" \
  | grep "browser_download_url.*\.vsix" \
  | head -1 \
  | cut -d '"' -f 4)

if [ -z "$DOWNLOAD_URL" ]; then
  echo "  [!] No .vsix found in latest release."
  echo "      Falling back to building from source..."

  echo "  [1/3] Cloning repository..."
  git clone --depth 1 "https://github.com/$REPO.git" "$TMP_DIR/repo" 2>/dev/null

  echo "  [2/3] Building (this may take a minute)..."
  cd "$TMP_DIR/repo"
  npm install --silent 2>/dev/null
  cd webview-ui && npm install --silent 2>/dev/null && cd ..
  npx @vscode/vsce package --no-dependencies 2>/dev/null
  VSIX_PATH=$(ls *.vsix 2>/dev/null | head -1)

  if [ -z "$VSIX_PATH" ]; then
    echo "  [!] Build failed. Make sure Node.js >= 18 is installed."
    exit 1
  fi
else
  VSIX_PATH="$TMP_DIR/$VSIX_NAME"
  curl -sSL -o "$VSIX_PATH" "$DOWNLOAD_URL"
  echo "  [2/3] Installing extension..."
fi

# ── Install the extension ──────────────────────────────────
echo "  [3/3] Installing into VS Code..."
"$CODE_CMD" --install-extension "$VSIX_PATH" --force 2>/dev/null

echo ""
echo "  Done!"
echo ""
echo "  Next steps:"
echo "    1. Reload VS Code (Cmd+Shift+P → 'Reload Window')"
echo "    2. Open the Agents Office panel in the bottom bar"
echo "    3. Click + Agent to spawn your first character"
echo ""
