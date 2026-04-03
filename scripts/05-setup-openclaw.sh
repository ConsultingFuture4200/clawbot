#!/usr/bin/env bash
# 05-setup-openclaw.sh — Install OpenClaw inside NemoClaw sandbox
set -euo pipefail

echo "=== Setting Up OpenClaw ==="
echo ""

SANDBOX_NAME="clawbot"

# Verify Node.js
if ! command -v node &>/dev/null; then
    echo "[FAIL] Node.js not found. Run 02-setup-node.sh first."
    exit 1
fi

NODE_VER=$(node --version)
echo "  [INFO] Node.js: $NODE_VER"

# OpenClaw is bundled with NemoClaw — check if it's already available
echo ""
echo "--- Checking OpenClaw installation ---"
if command -v openclaw &>/dev/null; then
    OC_VER=$(openclaw --version)
    echo "  [PASS] OpenClaw already installed: $OC_VER"
    echo "  (Bundled with NemoClaw)"
else
    echo "  OpenClaw not found, attempting install via NemoClaw..."
    if nemoclaw "$SANDBOX_NAME" status &>/dev/null; then
        nemoclaw exec "$SANDBOX_NAME" -- npm install -g openclaw
    else
        npm install -g openclaw
    fi

    # Verify
    if openclaw --version &>/dev/null; then
        OC_VER=$(openclaw --version)
        echo "  [PASS] OpenClaw installed: $OC_VER"
    else
        echo "  [FAIL] openclaw --version failed"
        exit 1
    fi
fi

echo ""
echo "OpenClaw installed successfully."
echo "Proceed to 06-configure-providers.sh"
