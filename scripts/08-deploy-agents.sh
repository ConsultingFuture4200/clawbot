#!/usr/bin/env bash
# 08-deploy-agents.sh — Copy agent configs into OpenClaw workspaces
set -euo pipefail

echo "=== Deploying Agent Configurations ==="
echo ""

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
AGENTS_DIR="$PROJECT_DIR/agents"
CONFIG_FILE="$PROJECT_DIR/config/openclaw.json5"

# Verify agents directory
if [ ! -d "$AGENTS_DIR" ]; then
    echo "[FAIL] agents/ directory not found at $AGENTS_DIR"
    exit 1
fi

# Deploy OpenClaw config
echo "--- Deploying openclaw.json5 ---"
OPENCLAW_CONFIG_DIR="${HOME}/.openclaw"
mkdir -p "$OPENCLAW_CONFIG_DIR"

if [ -f "$CONFIG_FILE" ]; then
    cp "$CONFIG_FILE" "$OPENCLAW_CONFIG_DIR/openclaw.json5"
    echo "  [PASS] Config copied to $OPENCLAW_CONFIG_DIR/openclaw.json5"
else
    echo "  [FAIL] Config not found at $CONFIG_FILE"
    exit 1
fi

# Deploy each agent's markdown files into OpenClaw agent dirs
AGENTS=("main" "dev" "comms" "research" "productivity" "home")
PASS=0
FAIL=0

for agent in "${AGENTS[@]}"; do
    echo ""
    echo "--- Deploying agent: $agent ---"
    AGENT_SRC="$AGENTS_DIR/$agent"
    AGENT_DEST="$OPENCLAW_CONFIG_DIR/agents/$agent/agent"

    if [ ! -d "$AGENT_SRC" ]; then
        echo "  [FAIL] Source directory not found: $AGENT_SRC"
        FAIL=$((FAIL + 1))
        continue
    fi

    mkdir -p "$AGENT_DEST"

    # Copy all markdown files for this agent
    for file in "$AGENT_SRC"/*.md; do
        if [ -f "$file" ]; then
            cp "$file" "$AGENT_DEST/"
            echo "  Copied: $(basename "$file")"
        fi
    done

    # Verify SOUL.md exists
    if [ -f "$AGENT_DEST/SOUL.md" ]; then
        echo "  [PASS] $agent agent deployed"
        PASS=$((PASS + 1))
    else
        echo "  [FAIL] $agent missing SOUL.md"
        FAIL=$((FAIL + 1))
    fi
done

# Register agents with OpenClaw (skip main — already exists)
echo ""
echo "--- Registering agents ---"
EXISTING_AGENTS=$(openclaw agents list 2>/dev/null || true)

for agent in "${AGENTS[@]}"; do
    if [ "$agent" = "main" ]; then
        echo "  [SKIP] main — already default agent"
        continue
    fi

    if echo "$EXISTING_AGENTS" | grep -q "^- $agent"; then
        echo "  [SKIP] $agent — already registered"
        continue
    fi

    openclaw agents add "$agent" \
        --workspace "$OPENCLAW_CONFIG_DIR/agents/$agent/workspace" \
        --non-interactive \
        2>/dev/null && {
        echo "  [PASS] Registered: $agent"
    } || {
        echo "  [WARN] Could not register $agent — may need manual config"
        echo "    Try: openclaw agents add $agent"
    }
done

# Verify
echo ""
echo "--- Verification ---"
openclaw agents list 2>/dev/null || echo "  Run manually: openclaw agents list"

echo ""
echo "=== Deployment Summary ==="
echo "  Agents deployed: $PASS"
echo "  Failures: $FAIL"

if [ "$FAIL" -gt 0 ]; then
    echo "  Fix failures before continuing."
    exit 1
fi

echo ""
echo "All agents deployed."
echo "Proceed to 09-verify-phase1.sh"
