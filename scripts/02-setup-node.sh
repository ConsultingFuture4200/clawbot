#!/usr/bin/env bash
# 02-setup-node.sh — Install Node.js 22+ via nvm
set -euo pipefail

echo "=== Setting Up Node.js 22 LTS via nvm ==="
echo ""

NODE_MAJOR=22

# Install nvm if not present
if [ ! -d "$HOME/.nvm" ]; then
    echo "--- Installing nvm ---"
    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
else
    echo "--- nvm already installed ---"
fi

# Load nvm
export NVM_DIR="$HOME/.nvm"
# shellcheck source=/dev/null
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

# Install Node.js 22 LTS
echo ""
echo "--- Installing Node.js $NODE_MAJOR LTS ---"
nvm install "$NODE_MAJOR"
nvm use "$NODE_MAJOR"
nvm alias default "$NODE_MAJOR"

# Verify
echo ""
echo "--- Verification ---"
NODE_VER=$(node --version)
NPM_VER=$(npm --version)

if [[ "$NODE_VER" == v${NODE_MAJOR}.* ]]; then
    echo "  [PASS] Node.js: $NODE_VER"
else
    echo "  [FAIL] Expected Node.js v${NODE_MAJOR}.x, got $NODE_VER"
    exit 1
fi

echo "  [INFO] npm: $NPM_VER"

echo ""
echo "Node.js $NODE_MAJOR installed successfully."
echo "Proceed to 03-setup-ollama.sh"
