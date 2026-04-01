#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# ClawBot -- Gmail OAuth2 Setup
# Guides user through OAuth2 authentication for both Gmail accounts
# Run AFTER completing manual GCP Console prerequisites (see checklist below)
# =============================================================================

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

header() { echo -e "\n${CYAN}${BOLD}=== $1 ===${NC}\n"; }
info()   { echo -e "${BOLD}$1${NC}"; }
ok()     { echo -e "${GREEN}[OK]${NC} $1"; }
warn()   { echo -e "${YELLOW}[WARN]${NC} $1"; }
fail()   { echo -e "${RED}[FAIL]${NC} $1"; }

header "ClawBot -- Gmail OAuth2 Setup"

# ---------------------------------------------------------------------------
# Step 1: Check .env exists and has required OAuth vars
# ---------------------------------------------------------------------------
header "Step 1: Checking prerequisites"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
ENV_FILE="${PROJECT_DIR}/.env"

if [ ! -f "$ENV_FILE" ]; then
  fail ".env file not found at $ENV_FILE"
  echo ""
  echo "  Copy .env.example to .env and fill in your values:"
  echo "    cp ${PROJECT_DIR}/.env.example ${PROJECT_DIR}/.env"
  exit 1
fi

source "$ENV_FILE"

if [ -z "${GMAIL_OAUTH_CLIENT_ID:-}" ]; then
  fail "GMAIL_OAUTH_CLIENT_ID is not set in .env"
  echo ""
  echo "  Get your OAuth Client ID from GCP Console:"
  echo "    https://console.cloud.google.com/apis/credentials"
  echo "  Add it to .env: GMAIL_OAUTH_CLIENT_ID=your-client-id"
  exit 1
fi

if [ -z "${GMAIL_OAUTH_CLIENT_SECRET:-}" ]; then
  fail "GMAIL_OAUTH_CLIENT_SECRET is not set in .env"
  echo ""
  echo "  Get your OAuth Client Secret from GCP Console:"
  echo "    https://console.cloud.google.com/apis/credentials"
  echo "  Add it to .env: GMAIL_OAUTH_CLIENT_SECRET=your-secret"
  exit 1
fi

ok "GMAIL_OAUTH_CLIENT_ID is set"
ok "GMAIL_OAUTH_CLIENT_SECRET is set"

# ---------------------------------------------------------------------------
# Step 2: Display manual prerequisites checklist
# ---------------------------------------------------------------------------
header "Step 2: Manual prerequisites checklist"

echo -e "${BOLD}MANUAL PREREQUISITES (complete these in GCP Console first):${NC}"
echo ""
echo "  [ ] Created GCP project (or using existing)"
echo "  [ ] Enabled Gmail API"
echo "  [ ] Enabled Google Calendar API"
echo -e "  [ ] Set OAuth consent screen to ${YELLOW}PRODUCTION${NC} mode (${RED}NOT Testing${NC})"
echo -e "      ${YELLOW}WARNING: Testing mode causes 7-day token expiry!${NC}"
echo "  [ ] Created OAuth 2.0 Client ID with type 'Desktop app'"
echo "  [ ] Downloaded client_secret.json"
echo "  [ ] Copied GMAIL_OAUTH_CLIENT_ID and GMAIL_OAUTH_CLIENT_SECRET to .env"
echo ""

read -p "Have you completed all prerequisites? [y/N] " CONFIRM
if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
  echo ""
  echo "Please complete the prerequisites first, then re-run this script."
  echo "GCP Console: https://console.cloud.google.com/"
  exit 1
fi

# ---------------------------------------------------------------------------
# Step 3: Check for client_secret.json
# ---------------------------------------------------------------------------
header "Step 3: Checking client_secret.json"

CLIENT_SECRET_PATH="/sandbox/config/client_secret.json"

if [ ! -f "$CLIENT_SECRET_PATH" ]; then
  warn "client_secret.json not found at $CLIENT_SECRET_PATH"
  echo ""
  echo "  Please copy the downloaded client_secret.json to:"
  echo "    $CLIENT_SECRET_PATH"
  echo ""
  read -p "Press Enter after copying the file... "

  if [ ! -f "$CLIENT_SECRET_PATH" ]; then
    fail "client_secret.json still not found at $CLIENT_SECRET_PATH"
    exit 1
  fi
fi

ok "client_secret.json found at $CLIENT_SECRET_PATH"

# ---------------------------------------------------------------------------
# Step 4: Load credentials into gog
# ---------------------------------------------------------------------------
header "Step 4: Loading OAuth credentials into gog"

echo "Loading client_secret.json into gog CLI..."
gog auth credentials "$CLIENT_SECRET_PATH"
ok "Credentials loaded"

# ---------------------------------------------------------------------------
# Step 5: Authenticate personal account
# ---------------------------------------------------------------------------
header "Step 5: Authenticate personal Gmail account"

read -p "Enter personal Gmail address: " PERSONAL_EMAIL

if [ -z "$PERSONAL_EMAIL" ]; then
  fail "No email address provided"
  exit 1
fi

echo ""
echo "Opening browser for personal account OAuth consent..."
echo "Scopes: gmail.readonly, gmail.compose, gmail.modify, calendar.readonly"
echo ""
gog auth add "$PERSONAL_EMAIL" --services gmail,calendar
ok "Personal account ($PERSONAL_EMAIL) authenticated"

# ---------------------------------------------------------------------------
# Step 6: Authenticate work account
# ---------------------------------------------------------------------------
header "Step 6: Authenticate work Gmail account"

read -p "Enter work Gmail address: " WORK_EMAIL

if [ -z "$WORK_EMAIL" ]; then
  fail "No email address provided"
  exit 1
fi

echo ""
echo "Opening browser for work account OAuth consent..."
echo "Scopes: gmail.readonly, gmail.compose, gmail.modify, calendar.readonly"
echo ""
gog auth add "$WORK_EMAIL" --services gmail,calendar
ok "Work account ($WORK_EMAIL) authenticated"

# ---------------------------------------------------------------------------
# Step 7: Verify both accounts are listed
# ---------------------------------------------------------------------------
header "Step 7: Verifying authenticated accounts"

echo "Listing authenticated accounts:"
gog auth list
echo ""

# ---------------------------------------------------------------------------
# Step 8: Initialize sync state files
# ---------------------------------------------------------------------------
header "Step 8: Initializing sync state files"

mkdir -p /sandbox/state

# Get initial historyId for personal account
echo "Fetching profile for personal account ($PERSONAL_EMAIL)..."
PERSONAL_PROFILE=$(gog gmail profile --account "$PERSONAL_EMAIL" --json)
PERSONAL_HISTORY_ID=$(echo "$PERSONAL_PROFILE" | jq -r '.historyId')

if [ -z "$PERSONAL_HISTORY_ID" ] || [ "$PERSONAL_HISTORY_ID" = "null" ]; then
  fail "Could not get historyId for personal account"
  exit 1
fi

cat > /sandbox/state/email-sync-personal.json << EOFSTATE
{
  "account": "personal",
  "email": "$PERSONAL_EMAIL",
  "historyId": "$PERSONAL_HISTORY_ID",
  "lastSuccessfulSync": null,
  "lastAttempt": null,
  "lastError": null,
  "consecutiveErrors": 0,
  "tokenHealthy": true,
  "tokenLastRefreshed": null,
  "tokenLastRefreshFailed": null
}
EOFSTATE

ok "Created /sandbox/state/email-sync-personal.json (historyId=$PERSONAL_HISTORY_ID)"

# Get initial historyId for work account
echo "Fetching profile for work account ($WORK_EMAIL)..."
WORK_PROFILE=$(gog gmail profile --account "$WORK_EMAIL" --json)
WORK_HISTORY_ID=$(echo "$WORK_PROFILE" | jq -r '.historyId')

if [ -z "$WORK_HISTORY_ID" ] || [ "$WORK_HISTORY_ID" = "null" ]; then
  fail "Could not get historyId for work account"
  exit 1
fi

cat > /sandbox/state/email-sync-work.json << EOFSTATE
{
  "account": "work",
  "email": "$WORK_EMAIL",
  "historyId": "$WORK_HISTORY_ID",
  "lastSuccessfulSync": null,
  "lastAttempt": null,
  "lastError": null,
  "consecutiveErrors": 0,
  "tokenHealthy": true,
  "tokenLastRefreshed": null,
  "tokenLastRefreshFailed": null
}
EOFSTATE

ok "Created /sandbox/state/email-sync-work.json (historyId=$WORK_HISTORY_ID)"

# ---------------------------------------------------------------------------
# Step 9: Initialize memory directories
# ---------------------------------------------------------------------------
header "Step 9: Initializing memory directories"

mkdir -p /sandbox/memory/email-patterns/personal
mkdir -p /sandbox/memory/email-patterns/work

ok "Created /sandbox/memory/email-patterns/personal/"
ok "Created /sandbox/memory/email-patterns/work/"

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
header "Setup Complete"

echo -e "${GREEN}${BOLD}Gmail OAuth2 setup completed successfully!${NC}"
echo ""
echo "  Authenticated accounts:"
echo -e "    Personal: ${BOLD}$PERSONAL_EMAIL${NC}"
echo -e "    Work:     ${BOLD}$WORK_EMAIL${NC}"
echo ""
echo "  State files:"
echo "    /sandbox/state/email-sync-personal.json (historyId=$PERSONAL_HISTORY_ID)"
echo "    /sandbox/state/email-sync-work.json (historyId=$WORK_HISTORY_ID)"
echo ""
echo "  Memory directories:"
echo "    /sandbox/memory/email-patterns/personal/"
echo "    /sandbox/memory/email-patterns/work/"
echo ""
echo -e "  ${BOLD}Next step:${NC} Run scripts/11-verify-gmail-auth.sh to confirm everything works."
