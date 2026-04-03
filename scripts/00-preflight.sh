#!/usr/bin/env bash
# 00-preflight.sh — Verify WSL2, GPU, disk space, no Docker Desktop
set -euo pipefail

PASS=0
FAIL=0

check() {
    local label="$1"
    shift
    if "$@" >/dev/null 2>&1; then
        echo "  [PASS] $label"
        ((PASS++))
    else
        echo "  [FAIL] $label"
        ((FAIL++))
    fi
}

echo "=== ClawBot Preflight Checks ==="
echo ""

# 1. Running inside WSL2
echo "--- Environment ---"
if grep -qi microsoft /proc/version 2>/dev/null; then
    echo "  [PASS] Running inside WSL"
else
    echo "  [FAIL] Not running inside WSL — run this script from WSL2 Ubuntu"
    ((FAIL++))
fi

# 2. WSL version 2
if [ -f /proc/version ] && grep -qi "microsoft" /proc/version; then
    echo "  [PASS] WSL2 kernel detected"
    ((PASS++))
else
    echo "  [FAIL] WSL2 kernel not detected"
    ((FAIL++))
fi

# 3. Ubuntu version
echo ""
echo "--- OS ---"
if command -v lsb_release &>/dev/null; then
    DISTRO=$(lsb_release -d -s 2>/dev/null || echo "unknown")
    echo "  [INFO] Distribution: $DISTRO"
    if lsb_release -r -s 2>/dev/null | grep -q "24.04"; then
        echo "  [PASS] Ubuntu 24.04"
        ((PASS++))
    else
        echo "  [WARN] Expected Ubuntu 24.04, got $(lsb_release -r -s 2>/dev/null)"
    fi
else
    echo "  [WARN] lsb_release not found — cannot verify distro"
fi

# 4. GPU detection
echo ""
echo "--- GPU ---"
if command -v nvidia-smi &>/dev/null; then
    echo "  [PASS] nvidia-smi found"
    ((PASS++))
    echo ""
    nvidia-smi --query-gpu=name,memory.total --format=csv,noheader 2>/dev/null | while read -r line; do
        echo "  [INFO] GPU: $line"
    done
else
    echo "  [FAIL] nvidia-smi not found — NVIDIA drivers not available in WSL2"
    echo "         Install: https://developer.nvidia.com/cuda/wsl"
    ((FAIL++))
fi

# 5. Disk space (need >20GB free)
echo ""
echo "--- Disk Space ---"
AVAIL_KB=$(df / --output=avail | tail -1 | tr -d ' ')
AVAIL_GB=$((AVAIL_KB / 1024 / 1024))
if [ "$AVAIL_GB" -ge 20 ]; then
    echo "  [PASS] ${AVAIL_GB}GB available (need >20GB)"
    ((PASS++))
else
    echo "  [FAIL] Only ${AVAIL_GB}GB available (need >20GB)"
    ((FAIL++))
fi

# 6. No Docker Desktop
echo ""
echo "--- Docker Desktop Check ---"
if command -v docker &>/dev/null && docker version --format '{{.Server.Platform.Name}}' 2>/dev/null | grep -qi "desktop"; then
    echo "  [FAIL] Docker Desktop detected — uninstall it and use Docker Engine in WSL2"
    ((FAIL++))
elif pgrep -f "Docker Desktop" &>/dev/null; then
    echo "  [FAIL] Docker Desktop process detected — uninstall it"
    ((FAIL++))
else
    echo "  [PASS] No Docker Desktop detected"
    ((PASS++))
fi

# 7. curl available
echo ""
echo "--- Tools ---"
check "curl installed" command -v curl
check "git installed" command -v git
check "wget installed" command -v wget

# Summary
echo ""
echo "=== Preflight Summary ==="
echo "  Passed: $PASS"
echo "  Failed: $FAIL"
echo ""

if [ "$FAIL" -gt 0 ]; then
    echo "Fix the failures above before continuing to 01-setup-docker.sh"
    exit 1
else
    echo "All checks passed! Proceed to 01-setup-docker.sh"
fi
