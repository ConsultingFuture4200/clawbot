#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# ClawBot -- Gmail Auth Verification
# Verifies OAuth2 authentication, API access, and state initialization
# for both Gmail accounts (personal + work)
# =============================================================================

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

header() { echo -e "\n${CYAN}${BOLD}=== $1 ===${NC}\n"; }
ok()     { echo -e "${GREEN}[PASS]${NC} $1"; }
fail()   { echo -e "${RED}[FAIL]${NC} $1"; }

PASS_COUNT=0
FAIL_COUNT=0
TOTAL_CHECKS=0

check_pass() {
  ok "$1"
  PASS_COUNT=$((PASS_COUNT + 1))
  TOTAL_CHECKS=$((TOTAL_CHECKS + 1))
}

check_fail() {
  fail "$1"
  FAIL_COUNT=$((FAIL_COUNT + 1))
  TOTAL_CHECKS=$((TOTAL_CHECKS + 1))
}

header "ClawBot -- Gmail Auth Verification"

# ---------------------------------------------------------------------------
# Check 1: Verify gog auth has both accounts
# ---------------------------------------------------------------------------
header "Check 1: Authenticated accounts"

ACCOUNTS=$(gog auth list --json)
ACCOUNT_COUNT=$(echo "$ACCOUNTS" | jq 'length')

if [ "$ACCOUNT_COUNT" -ge 2 ]; then
  check_pass "Found $ACCOUNT_COUNT authenticated accounts (expected >= 2)"
else
  check_fail "Expected >= 2 accounts, found $ACCOUNT_COUNT"
  echo "  Run scripts/10-gmail-oauth-setup.sh to authenticate both accounts."
fi

# ---------------------------------------------------------------------------
# Check 2: Verify state files exist and have valid historyId
# ---------------------------------------------------------------------------
header "Check 2: Sync state files"

for ACCOUNT in personal work; do
  FILE="/sandbox/state/email-sync-${ACCOUNT}.json"

  if [ ! -f "$FILE" ]; then
    check_fail "$FILE missing"
    continue
  fi

  HID=$(jq -r '.historyId' "$FILE")
  if [ "$HID" = "null" ] || [ -z "$HID" ]; then
    check_fail "$FILE has null or empty historyId"
  else
    check_pass "$FILE exists with historyId=$HID"
  fi

  EMAIL=$(jq -r '.email' "$FILE")
  if [ "$EMAIL" = "null" ] || [ -z "$EMAIL" ]; then
    check_fail "$FILE has null or empty email"
  else
    check_pass "$FILE has email=$EMAIL"
  fi
done

# ---------------------------------------------------------------------------
# Check 3: Test Gmail API access for each account
# ---------------------------------------------------------------------------
header "Check 3: Gmail API access (messages.list)"

for ACCOUNT in personal work; do
  FILE="/sandbox/state/email-sync-${ACCOUNT}.json"

  if [ ! -f "$FILE" ]; then
    check_fail "Cannot test $ACCOUNT -- state file missing"
    continue
  fi

  EMAIL=$(jq -r '.email' "$FILE")

  echo "Testing $ACCOUNT account ($EMAIL) API access..."
  if gog gmail messages search "in:inbox" --max 3 --account "$EMAIL" > /dev/null 2>&1; then
    check_pass "$ACCOUNT account ($EMAIL) Gmail messages.list works"
  else
    check_fail "$ACCOUNT account ($EMAIL) Gmail messages.list failed"
    echo "  Possible causes: invalid token, wrong scopes, egress blocked"
  fi
done

# ---------------------------------------------------------------------------
# Check 4: Test history.list for each account
# ---------------------------------------------------------------------------
header "Check 4: Gmail history.list (incremental sync)"

for ACCOUNT in personal work; do
  FILE="/sandbox/state/email-sync-${ACCOUNT}.json"

  if [ ! -f "$FILE" ]; then
    check_fail "Cannot test $ACCOUNT -- state file missing"
    continue
  fi

  EMAIL=$(jq -r '.email' "$FILE")
  HID=$(jq -r '.historyId' "$FILE")

  echo "Testing $ACCOUNT account history.list with historyId=$HID..."
  if gog gmail history --account "$EMAIL" --since "$HID" > /dev/null 2>&1; then
    check_pass "$ACCOUNT account ($EMAIL) history.list works"
  else
    # history.list 404 is expected if historyId is stale, but connectivity should work
    check_fail "$ACCOUNT account ($EMAIL) history.list failed"
    echo "  If historyId is stale, re-run scripts/10-gmail-oauth-setup.sh to refresh"
  fi
done

# ---------------------------------------------------------------------------
# Check 5: Verify memory directories
# ---------------------------------------------------------------------------
header "Check 5: Memory directories"

for ACCOUNT in personal work; do
  DIR="/sandbox/memory/email-patterns/${ACCOUNT}"
  if [ -d "$DIR" ]; then
    check_pass "$DIR exists"
  else
    check_fail "$DIR missing"
    echo "  Create with: mkdir -p $DIR"
  fi
done

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
header "Verification Summary"

echo -e "  Total checks: ${BOLD}$TOTAL_CHECKS${NC}"
echo -e "  Passed:       ${GREEN}${BOLD}$PASS_COUNT${NC}"
echo -e "  Failed:       ${RED}${BOLD}$FAIL_COUNT${NC}"
echo ""

if [ "$FAIL_COUNT" -eq 0 ]; then
  echo -e "${GREEN}${BOLD}All checks passed! Gmail OAuth2 is fully configured.${NC}"
  exit 0
else
  echo -e "${RED}${BOLD}$FAIL_COUNT check(s) failed. Review errors above.${NC}"
  exit 1
fi
