#!/usr/bin/env bash
# 04-setup-nemoclaw.sh — Install NemoClaw + create sandbox
set -euo pipefail

echo "=== Setting Up NemoClaw ==="
echo ""

SANDBOX_NAME="clawbot"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Check Docker is running
if ! docker info &>/dev/null; then
    echo "[FAIL] Docker is not running. Run 01-setup-docker.sh first."
    exit 1
fi

# Install NemoClaw
if ! command -v nemoclaw &>/dev/null; then
    echo "--- Installing NemoClaw ---"
    echo ""
    echo "Running official NemoClaw installer..."
    curl -fsSL https://www.nvidia.com/nemoclaw.sh | bash
else
    echo "--- NemoClaw already installed ---"
    nemoclaw --version
fi

# Create sandbox via onboard (nemoclaw v0.1.0 uses onboard, not create)
echo ""
echo "--- Creating sandbox: $SANDBOX_NAME ---"
if nemoclaw list 2>/dev/null | grep -q "$SANDBOX_NAME"; then
    echo "  Sandbox '$SANDBOX_NAME' already exists"
else
    echo "  Running 'nemoclaw onboard' to create sandbox..."
    echo "  (This is interactive — follow the prompts)"
    nemoclaw onboard || {
        echo ""
        echo "  ============================================================"
        echo "  NemoClaw onboard failed."
        echo "  PRD §10 FALLBACK: run OpenClaw without NemoClaw sandbox."
        echo "  The gateway will run unsandboxed. Harden with AppArmor later."
        echo "  ============================================================"
    }
fi

# Start services
echo ""
echo "--- Starting services ---"
nemoclaw start 2>/dev/null || true

# Verify sandbox health
echo ""
echo "--- Verification ---"
if nemoclaw "$SANDBOX_NAME" status 2>/dev/null | grep -qi "healthy\|running"; then
    echo "  [PASS] Sandbox '$SANDBOX_NAME' is healthy"
else
    echo "  [WARN] Could not verify sandbox health"
    echo ""
    echo "  ============================================================"
    echo "  IMPORTANT: NemoClaw sandboxing on WSL2 is UNTESTED."
    echo "  If Landlock/seccomp fails on the WSL2 kernel, see PRD §10"
    echo "  kill criteria: fall back to raw OpenClaw + AppArmor hardening."
    echo "  ============================================================"
    echo ""
    echo "  To debug:"
    echo "    nemoclaw $SANDBOX_NAME status"
    echo "    nemoclaw $SANDBOX_NAME logs"
    echo "    openshell term"
fi

echo ""
echo "NemoClaw setup complete."
echo "Proceed to 05-setup-openclaw.sh"
