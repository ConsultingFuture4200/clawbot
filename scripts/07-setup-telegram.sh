#!/usr/bin/env bash
# 07-setup-telegram.sh — Telegram bot setup + pairing
set -euo pipefail

echo "=== Setting Up Telegram Bot ==="
echo ""

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
ENV_FILE="$PROJECT_DIR/.env"

# Load .env
if [ ! -f "$ENV_FILE" ]; then
    echo "[FAIL] .env file not found. Copy .env.example to .env first."
    exit 1
fi
# shellcheck source=/dev/null
source "$ENV_FILE"

# Check token
if [ -z "${TELEGRAM_BOT_TOKEN:-}" ]; then
    echo "=== Telegram Bot Setup Guide ==="
    echo ""
    echo "1. Open Telegram and search for @BotFather"
    echo "2. Send /newbot"
    echo "3. Choose a name (e.g., 'ClawBot')"
    echo "4. Choose a username (e.g., 'clawbot_yourname_bot')"
    echo "5. Copy the bot token BotFather gives you"
    echo "6. Paste it in your .env file as TELEGRAM_BOT_TOKEN=..."
    echo "7. Re-run this script"
    echo ""
    exit 1
fi

echo "  [INFO] Bot token found: ${TELEGRAM_BOT_TOKEN:0:10}..."

# Configure Telegram channel in OpenClaw
echo ""
echo "--- Configuring Telegram channel ---"
openclaw channels add \
    --channel telegram \
    --token "$TELEGRAM_BOT_TOKEN" \
    2>/dev/null && {
    echo "  [PASS] Telegram channel configured"
} || {
    echo "  [WARN] Channel config command failed — may need manual config"
    echo "  Try: openclaw channels add --channel telegram --token \$TELEGRAM_BOT_TOKEN"
}

# Check channel status
echo ""
echo "--- Verification ---"
openclaw channels list 2>/dev/null || true
echo ""
openclaw channels status 2>/dev/null || true

echo ""
echo "--- Next Steps ---"
echo "  1. Start the gateway:  openclaw gateway run"
echo "  2. Open Telegram and send /start to your bot"
echo "  3. The gateway will detect and pair with your device"
echo "  4. Verify: openclaw channels status --probe"

echo ""
echo "Telegram setup complete."
echo "Proceed to 08-deploy-agents.sh"
