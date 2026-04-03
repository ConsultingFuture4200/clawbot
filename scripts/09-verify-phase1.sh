#!/usr/bin/env bash
# 09-verify-phase1.sh — Run all 14 Phase 1 exit criteria from PRD §10
set -euo pipefail

echo "============================================="
echo "  ClawBot Phase 1 — Exit Criteria Validation"
echo "============================================="
echo ""

PASS=0
FAIL=0
WARN=0

check_pass() { echo "  [PASS] $1"; PASS=$((PASS + 1)); }
check_fail() { echo "  [FAIL] $1"; FAIL=$((FAIL + 1)); }
check_warn() { echo "  [WARN] $1"; WARN=$((WARN + 1)); }

# --- 1. WSL2 Ubuntu 24.04 ---
echo "--- 1. WSL2 Ubuntu 24.04 configured ---"
if grep -qi microsoft /proc/version 2>/dev/null; then
    check_pass "Running inside WSL2"
else
    check_fail "Not running in WSL2"
fi

# --- 2. Docker Engine ---
echo ""
echo "--- 2. Docker Engine installed ---"
if docker run --rm hello-world 2>/dev/null | grep -q "Hello from Docker"; then
    check_pass "docker run hello-world succeeded"
else
    check_fail "docker run hello-world failed"
fi

# --- 3. Node.js 22+ ---
echo ""
echo "--- 3. Node.js 22+ installed ---"
if command -v node &>/dev/null; then
    NODE_VER=$(node --version)
    if [[ "$NODE_VER" == v2[2-9].* ]] || [[ "$NODE_VER" == v[3-9][0-9].* ]]; then
        check_pass "Node.js $NODE_VER"
    else
        check_fail "Node.js $NODE_VER (need v22+)"
    fi
else
    check_fail "Node.js not found"
fi

# --- 4. NemoClaw sandbox ---
echo ""
echo "--- 4. NemoClaw sandbox running ---"
if command -v nemoclaw &>/dev/null && nemoclaw clawbot status 2>/dev/null | grep -qi "healthy\|running"; then
    check_pass "Sandbox 'clawbot' is healthy"
else
    check_warn "NemoClaw sandbox status unclear — verify manually: nemoclaw clawbot status"
fi

# --- 5. OpenClaw installed ---
echo ""
echo "--- 5. OpenClaw installed ---"
if openclaw --version &>/dev/null; then
    OC_VER=$(openclaw --version 2>/dev/null)
    check_pass "OpenClaw $OC_VER"
else
    check_fail "openclaw --version failed"
fi

# --- 6. Codex OAuth ---
echo ""
echo "--- 6. Codex OAuth authenticated ---"
if openclaw models status 2>/dev/null | grep -qi "openai-codex.*oauth"; then
    check_pass "Codex OAuth active"
else
    check_warn "Codex OAuth status unclear — run: openclaw models status"
fi

# --- 7. Gemini API as default ---
echo ""
echo "--- 7. Gemini API configured as default ---"
if openclaw models status 2>/dev/null | grep -qi "Default.*gemini"; then
    check_pass "Gemini set as default"
else
    check_warn "Gemini default status unclear — run: openclaw models status"
fi

# --- 8. Anthropic API key ---
echo ""
echo "--- 8. Anthropic API configured ---"
if openclaw models status 2>/dev/null | grep -qi "anthropic.*effective=env"; then
    check_pass "Anthropic provider available"
else
    check_warn "Anthropic status unclear — run: openclaw models status"
fi

# --- 9. Ollama with 7B model ---
echo ""
echo "--- 9. Ollama running with 7B model ---"
if curl -s http://127.0.0.1:11434/api/tags 2>/dev/null | grep -q "qwen2.5"; then
    check_pass "Ollama running with qwen2.5 model"
else
    check_fail "Ollama not responding or model not found"
fi

# --- 10. Telegram bot configured ---
echo ""
echo "--- 10. Telegram bot configured ---"
if openclaw channels list 2>/dev/null | grep -qi "telegram.*configured"; then
    check_pass "Telegram channel configured"
else
    check_warn "Telegram status unclear — run: openclaw channels list"
fi

# --- 11. Main agent responding ---
echo ""
echo "--- 11. Main agent responding via Telegram ---"
echo "  [MANUAL] Send 'hello' to your Telegram bot and verify a coherent response"
echo "           using Gemini (check logs for provider: google/gemini-3-flash)"

# --- 12. NemoClaw egress policy ---
echo ""
echo "--- 12. NemoClaw egress policy active ---"
if command -v openshell &>/dev/null; then
    check_pass "openshell available"
    echo "  [MANUAL] Run 'openshell term' and verify policy is loaded"
    echo "           Test: try to reach a blocked domain from inside the sandbox"
else
    check_warn "openshell not found — verify NemoClaw policy manually"
fi

# --- 13. OpenAI embeddings ---
echo ""
echo "--- 13. OpenAI embeddings configured ---"
if openclaw models status 2>/dev/null | grep -qi "openai.*effective=env"; then
    check_pass "OpenAI API key available (for embeddings)"
else
    check_warn "OpenAI embeddings status unclear — run: openclaw models status"
fi

# --- 14. Fallback chain ---
echo ""
echo "--- 14. Fallback chain (Gemini → Codex → Claude) ---"
echo "  [MANUAL] Test fallback chain:"
echo "    1. Temporarily set an invalid Gemini key → send a message"
echo "       Verify: Codex picks up (check logs for provider switch)"
echo "    2. Also invalidate Codex → send a message"
echo "       Verify: Claude picks up"
echo "    3. Restore all keys when done"

# Summary
echo ""
echo "============================================="
echo "  Phase 1 Verification Summary"
echo "============================================="
echo "  Automated PASS: $PASS"
echo "  Automated FAIL: $FAIL"
echo "  Needs Manual:   $WARN + 3 manual checks"
echo ""

if [ "$FAIL" -gt 0 ]; then
    echo "  STATUS: INCOMPLETE — fix failures above"
    exit 1
elif [ "$WARN" -gt 0 ]; then
    echo "  STATUS: REVIEW NEEDED — check warnings and manual items"
    exit 0
else
    echo "  STATUS: ALL AUTOMATED CHECKS PASSED"
    echo "  Complete the 3 manual checks to fully validate Phase 1."
fi
