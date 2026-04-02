#!/usr/bin/env bash
set -uo pipefail

# =============================================================================
# ClawBot — Phase 1 Gmail Foundation Exit Criteria Verification
# Tests all 7 GMAIL requirements. Uses gmail-oauth-helper.cjs (not gog CLI).
# =============================================================================

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

PASS=0
FAIL=0
TOTAL=0

check() {
  local name="$1"
  local result="$2"  # 0 = pass, non-zero = fail
  TOTAL=$((TOTAL + 1))
  if [ "$result" -eq 0 ]; then
    PASS=$((PASS + 1))
    echo -e "  ${GREEN}PASS${NC}: $name"
  else
    FAIL=$((FAIL + 1))
    echo -e "  ${RED}FAIL${NC}: $name"
  fi
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
HELPER="$SCRIPT_DIR/gmail-oauth-helper.cjs"

# =============================================================================
echo -e "\n${CYAN}${BOLD}=== GMAIL-01: OAuth Authentication ===${NC}\n"
# =============================================================================

# Check helper script exists
[ -f "$HELPER" ]
check "gmail-oauth-helper.cjs exists" $?

# Check authenticated accounts via helper list command
ACCOUNT_LIST=$(cd "$PROJECT_DIR" && node "$HELPER" list 2>/dev/null) || ACCOUNT_LIST="[]"
ACCOUNT_COUNT=$(echo "$ACCOUNT_LIST" | node -e "
  const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  console.log(Array.isArray(d) ? d.length : 0);
" 2>/dev/null) || ACCOUNT_COUNT=0
[ "$ACCOUNT_COUNT" -ge 2 ]
check "Helper has >= 2 authenticated accounts (found: $ACCOUNT_COUNT)" $?

# Check personal account token file exists
[ -f /sandbox/state/token-personal.json ]
check "Personal account token file exists" $?

# Check work account token file exists
[ -f /sandbox/state/token-work.json ]
check "Work account token file exists" $?

# Verify personal account Gmail API access via helper
PERSONAL_RESULT=$(cd "$PROJECT_DIR" && node "$HELPER" verify personal 2>&1) || true
PERSONAL_PROFILE=$(echo "$PERSONAL_RESULT" | node -e "
  const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  console.log(d.checks && d.checks.gmail_profile === true ? 'true' : 'false');
" 2>/dev/null) || PERSONAL_PROFILE="false"
[ "$PERSONAL_PROFILE" = "true" ]
check "Personal account Gmail API accessible" $?

# Verify work account Gmail API access via helper
WORK_RESULT=$(cd "$PROJECT_DIR" && node "$HELPER" verify work 2>&1) || true
WORK_PROFILE=$(echo "$WORK_RESULT" | node -e "
  const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  console.log(d.checks && d.checks.gmail_profile === true ? 'true' : 'false');
" 2>/dev/null) || WORK_PROFILE="false"
[ "$WORK_PROFILE" = "true" ]
check "Work account Gmail API accessible" $?

# =============================================================================
echo ""
echo -e "${CYAN}${BOLD}=== GMAIL-02: Production Mode (Token Persistence) ===${NC}\n"
# =============================================================================

# Verify tokens have refresh_token (required for long-lived access)
PERSONAL_HAS_REFRESH=$(echo "$PERSONAL_RESULT" | node -e "
  const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  console.log(d.checks && d.checks.has_refresh_token === true ? 'true' : 'false');
" 2>/dev/null) || PERSONAL_HAS_REFRESH="false"
[ "$PERSONAL_HAS_REFRESH" = "true" ]
check "Personal account has refresh_token" $?

WORK_HAS_REFRESH=$(echo "$WORK_RESULT" | node -e "
  const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  console.log(d.checks && d.checks.has_refresh_token === true ? 'true' : 'false');
" 2>/dev/null) || WORK_HAS_REFRESH="false"
[ "$WORK_HAS_REFRESH" = "true" ]
check "Work account has refresh_token" $?

# Check token health in sync state files
PERSONAL_STATE="/sandbox/state/email-sync-personal.json"
if [ -f "$PERSONAL_STATE" ]; then
  TOKEN_HEALTHY=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$PERSONAL_STATE','utf8')).tokenHealthy)" 2>/dev/null)
  [ "$TOKEN_HEALTHY" = "true" ]
  check "Personal account token marked healthy in state file" $?
else
  check "Personal account token marked healthy in state file" 1
fi

WORK_STATE="/sandbox/state/email-sync-work.json"
if [ -f "$WORK_STATE" ]; then
  TOKEN_HEALTHY=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$WORK_STATE','utf8')).tokenHealthy)" 2>/dev/null)
  [ "$TOKEN_HEALTHY" = "true" ]
  check "Work account token marked healthy in state file" $?
else
  check "Work account token marked healthy in state file" 1
fi

echo -e "  ${YELLOW}NOTE${NC}: Full 7-day persistence test requires waiting 7+ days after setup."
echo "  If tokens stop working after 7 days, consent screen is still in Testing mode."

# =============================================================================
echo ""
echo -e "${CYAN}${BOLD}=== GMAIL-03: Incremental Sync (history.list) ===${NC}\n"
# =============================================================================

# Verify historyId in state files
if [ -f "$PERSONAL_STATE" ]; then
  PERSONAL_HID=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$PERSONAL_STATE','utf8')).historyId)" 2>/dev/null)
  [ "$PERSONAL_HID" != "null" ] && [ "$PERSONAL_HID" != "undefined" ] && [ -n "$PERSONAL_HID" ]
  check "Personal account has valid historyId ($PERSONAL_HID)" $?
else
  check "Personal account has valid historyId (state file missing)" 1
fi

if [ -f "$WORK_STATE" ]; then
  WORK_HID=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$WORK_STATE','utf8')).historyId)" 2>/dev/null)
  [ "$WORK_HID" != "null" ] && [ "$WORK_HID" != "undefined" ] && [ -n "$WORK_HID" ]
  check "Work account has valid historyId ($WORK_HID)" $?
else
  check "Work account has valid historyId (state file missing)" 1
fi

# Verify history.list works via helper verify (already run above, check results)
PERSONAL_HISTORY=$(echo "$PERSONAL_RESULT" | node -e "
  const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  console.log(d.checks && d.checks.gmail_history_list === true ? 'true' : 'false');
" 2>/dev/null) || PERSONAL_HISTORY="false"
[ "$PERSONAL_HISTORY" = "true" ]
check "Personal account history.list returns successfully" $?

WORK_HISTORY=$(echo "$WORK_RESULT" | node -e "
  const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  console.log(d.checks && d.checks.gmail_history_list === true ? 'true' : 'false');
" 2>/dev/null) || WORK_HISTORY="false"
[ "$WORK_HISTORY" = "true" ]
check "Work account history.list returns successfully" $?

# Verify state files are persisted to disk
[ -f /sandbox/state/email-sync-personal.json ]
check "Personal sync state file persisted at /sandbox/state/email-sync-personal.json" $?

[ -f /sandbox/state/email-sync-work.json ]
check "Work sync state file persisted at /sandbox/state/email-sync-work.json" $?

# Verify messages.list works (confirms basic Gmail read access for sync)
PERSONAL_MESSAGES=$(echo "$PERSONAL_RESULT" | node -e "
  const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  console.log(d.checks && d.checks.gmail_messages_list === true ? 'true' : 'false');
" 2>/dev/null) || PERSONAL_MESSAGES="false"
[ "$PERSONAL_MESSAGES" = "true" ]
check "Personal account messages.list works (sync prerequisite)" $?

WORK_MESSAGES=$(echo "$WORK_RESULT" | node -e "
  const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  console.log(d.checks && d.checks.gmail_messages_list === true ? 'true' : 'false');
" 2>/dev/null) || WORK_MESSAGES="false"
[ "$WORK_MESSAGES" = "true" ]
check "Work account messages.list works (sync prerequisite)" $?

# =============================================================================
echo ""
echo -e "${CYAN}${BOLD}=== GMAIL-04: Heartbeat & Cron Schedule ===${NC}\n"
# =============================================================================

CONFIG="$PROJECT_DIR/config/openclaw.json5"

grep -q '"every": "30m"' "$CONFIG" 2>/dev/null
check "Heartbeat interval set to 30m in openclaw.json5" $?

grep -q '"start": "08:00"' "$CONFIG" 2>/dev/null
check "Active hours start at 08:00" $?

grep -q '"end": "20:00"' "$CONFIG" 2>/dev/null
check "Active hours end at 20:00" $?

grep -q 'America/Los_Angeles' "$CONFIG" 2>/dev/null
check "Timezone set to America/Los_Angeles" $?

grep -q '"0 0 \* \* \*"' "$CONFIG" 2>/dev/null
check "Cron entry for midnight PT exists" $?

grep -q '"0 6 \* \* \*"' "$CONFIG" 2>/dev/null
check "Cron entry for 6 AM PT exists" $?

grep -q 'ollama/qwen2.5:7b' "$CONFIG" 2>/dev/null
check "Heartbeat model is ollama/qwen2.5:7b (local, not cloud)" $?

# =============================================================================
echo ""
echo -e "${CYAN}${BOLD}=== GMAIL-05: Account Separation ===${NC}\n"
# =============================================================================

# Verify separate state files with correct account labels
if [ -f "$PERSONAL_STATE" ]; then
  PERSONAL_ACCT=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$PERSONAL_STATE','utf8')).account)" 2>/dev/null)
  [ "$PERSONAL_ACCT" = "personal" ]
  check "Personal state file labeled 'personal'" $?
else
  check "Personal state file labeled 'personal' (file missing)" 1
fi

if [ -f "$WORK_STATE" ]; then
  WORK_ACCT=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$WORK_STATE','utf8')).account)" 2>/dev/null)
  [ "$WORK_ACCT" = "work" ]
  check "Work state file labeled 'work'" $?
else
  check "Work state file labeled 'work' (file missing)" 1
fi

# Verify emails are different between accounts
if [ -f "$PERSONAL_STATE" ] && [ -f "$WORK_STATE" ]; then
  PERSONAL_EMAIL_STATE=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$PERSONAL_STATE','utf8')).email)" 2>/dev/null)
  WORK_EMAIL_STATE=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$WORK_STATE','utf8')).email)" 2>/dev/null)
  [ "$PERSONAL_EMAIL_STATE" != "$WORK_EMAIL_STATE" ]
  check "Personal and work emails are different addresses" $?
else
  check "Personal and work emails are different addresses (state files missing)" 1
fi

# Verify separate memory directories
[ -d /sandbox/memory/email-patterns/personal ]
check "Personal memory directory exists" $?

[ -d /sandbox/memory/email-patterns/work ]
check "Work memory directory exists" $?

# Verify HEARTBEAT.md references work-first priority
HEARTBEAT="$PROJECT_DIR/agents/comms/HEARTBEAT.md"
grep -q "Work Account First" "$HEARTBEAT" 2>/dev/null
check "HEARTBEAT.md specifies work-first polling order (D-12)" $?

# =============================================================================
echo ""
echo -e "${CYAN}${BOLD}=== GMAIL-06: Token Health Monitoring ===${NC}\n"
# =============================================================================

# Verify state files have token health fields
if [ -f "$PERSONAL_STATE" ]; then
  node -e "const d=JSON.parse(require('fs').readFileSync('$PERSONAL_STATE','utf8')); if(!('tokenHealthy' in d)) process.exit(1);" 2>/dev/null
  check "Personal state file has tokenHealthy field" $?

  node -e "const d=JSON.parse(require('fs').readFileSync('$PERSONAL_STATE','utf8')); if(!('tokenLastRefreshed' in d)) process.exit(1);" 2>/dev/null
  check "Personal state file has tokenLastRefreshed field" $?

  node -e "const d=JSON.parse(require('fs').readFileSync('$PERSONAL_STATE','utf8')); if(!('tokenLastRefreshFailed' in d)) process.exit(1);" 2>/dev/null
  check "Personal state file has tokenLastRefreshFailed field" $?
else
  check "Personal state file has tokenHealthy field (file missing)" 1
  check "Personal state file has tokenLastRefreshed field (file missing)" 1
  check "Personal state file has tokenLastRefreshFailed field (file missing)" 1
fi

if [ -f "$WORK_STATE" ]; then
  node -e "const d=JSON.parse(require('fs').readFileSync('$WORK_STATE','utf8')); if(!('tokenHealthy' in d)) process.exit(1);" 2>/dev/null
  check "Work state file has tokenHealthy field" $?

  node -e "const d=JSON.parse(require('fs').readFileSync('$WORK_STATE','utf8')); if(!('tokenLastRefreshed' in d)) process.exit(1);" 2>/dev/null
  check "Work state file has tokenLastRefreshed field" $?

  node -e "const d=JSON.parse(require('fs').readFileSync('$WORK_STATE','utf8')); if(!('tokenLastRefreshFailed' in d)) process.exit(1);" 2>/dev/null
  check "Work state file has tokenLastRefreshFailed field" $?
else
  check "Work state file has tokenHealthy field (file missing)" 1
  check "Work state file has tokenLastRefreshed field (file missing)" 1
  check "Work state file has tokenLastRefreshFailed field (file missing)" 1
fi

# Verify HEARTBEAT.md has token health check section
grep -q "Token Health Check" "$HEARTBEAT" 2>/dev/null
check "HEARTBEAT.md has Token Health Check section" $?

# Verify HEARTBEAT.md references D-09 proactive warning
grep -q "D-09" "$HEARTBEAT" 2>/dev/null
check "HEARTBEAT.md references D-09 (24h proactive warning)" $?

# =============================================================================
echo ""
echo -e "${CYAN}${BOLD}=== GMAIL-07: Sandbox Egress Policy ===${NC}\n"
# =============================================================================

EGRESS="$PROJECT_DIR/config/openclaw-sandbox.yaml"

grep -q "gmail.googleapis.com" "$EGRESS" 2>/dev/null
check "gmail.googleapis.com in egress allowed list" $?

grep -q "www.googleapis.com" "$EGRESS" 2>/dev/null
check "www.googleapis.com still in egress allowed list (not removed)" $?

grep -q "oauth2.googleapis.com" "$EGRESS" 2>/dev/null
check "oauth2.googleapis.com in egress allowed list" $?

grep -q "accounts.google.com" "$EGRESS" 2>/dev/null
check "accounts.google.com in egress allowed list" $?

# =============================================================================
echo ""
echo -e "${CYAN}${BOLD}============================================${NC}"
echo -e "${CYAN}${BOLD}  Phase 1: Gmail Foundation -- Results${NC}"
echo -e "${CYAN}${BOLD}============================================${NC}"
echo -e "  Passed: ${GREEN}${BOLD}$PASS${NC} / $TOTAL"
echo -e "  Failed: ${RED}${BOLD}$FAIL${NC} / $TOTAL"
echo ""

if [ "$FAIL" -eq 0 ]; then
  echo -e "  ${GREEN}${BOLD}ALL CHECKS PASSED -- Phase 1 exit criteria met.${NC}"
  echo "  Ready for Phase 2: Classification & Delivery"
  exit 0
else
  echo -e "  ${RED}${BOLD}$FAIL CHECK(S) FAILED -- Review failures above.${NC}"
  echo "  Fix issues and re-run this script."
  exit 1
fi
