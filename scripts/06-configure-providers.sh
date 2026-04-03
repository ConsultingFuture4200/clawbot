#!/usr/bin/env bash
# 06-configure-providers.sh — Wire up Gemini/Codex/Claude/Ollama/Embeddings
set -euo pipefail

echo "=== Configuring LLM Providers ==="
echo ""

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
ENV_FILE="$PROJECT_DIR/.env"

# Load .env
if [ ! -f "$ENV_FILE" ]; then
    echo "[FAIL] .env file not found at $ENV_FILE"
    echo "  Copy .env.example to .env and fill in your API keys first."
    exit 1
fi

# shellcheck source=/dev/null
source "$ENV_FILE"

PASS=0
FAIL=0

# --- 1. Gemini ---
echo "--- 1. Google Gemini ---"
if [ -n "${GEMINI_API_KEY:-}" ]; then
    echo "  [PASS] GEMINI_API_KEY detected in environment"
    PASS=$((PASS + 1))
else
    echo "  [FAIL] GEMINI_API_KEY not set in .env"
    FAIL=$((FAIL + 1))
fi

# --- 2. Anthropic Claude ---
echo ""
echo "--- 2. Anthropic Claude ---"
if [ -n "${ANTHROPIC_API_KEY:-}" ]; then
    echo "  [PASS] ANTHROPIC_API_KEY detected in environment"
    PASS=$((PASS + 1))
else
    echo "  [FAIL] ANTHROPIC_API_KEY not set in .env"
    FAIL=$((FAIL + 1))
fi

# --- 3. OpenAI (Embeddings) ---
echo ""
echo "--- 3. OpenAI (Embeddings) ---"
if [ -n "${OPENAI_API_KEY:-}" ]; then
    echo "  [PASS] OPENAI_API_KEY detected in environment"
    PASS=$((PASS + 1))
else
    echo "  [FAIL] OPENAI_API_KEY not set in .env"
    FAIL=$((FAIL + 1))
fi

# --- 4. OpenAI Codex (OAuth) ---
echo ""
echo "--- 4. OpenAI Codex (OAuth) ---"
if openclaw models status 2>/dev/null | grep -q "openai-codex"; then
    echo "  [PASS] Codex OAuth already configured"
    PASS=$((PASS + 1))
else
    echo "  [WARN] Codex OAuth not found"
    echo "  Run manually: openclaw models auth login --provider openai-codex"
fi

# --- 5. Ollama (Local) ---
echo ""
echo "--- 5. Ollama (Local) ---"
OLLAMA_URL="${OLLAMA_HOST:-http://127.0.0.1:11434}"
if curl -s "$OLLAMA_URL/api/tags" &>/dev/null; then
    echo "  [PASS] Ollama responding at $OLLAMA_URL"
    PASS=$((PASS + 1))
else
    echo "  [WARN] Ollama not responding at $OLLAMA_URL"
    echo "  Start it: ollama serve"
fi

# --- Set Gemini as default model ---
echo ""
echo "--- Setting default model to gemini-3-flash ---"
if openclaw models set google/gemini-3-flash 2>/dev/null; then
    echo "  [PASS] Default model set to google/gemini-3-flash"
else
    echo "  [WARN] Could not set default model (may need 'openclaw configure --section model')"
fi

# --- Show provider status ---
echo ""
echo "--- Provider Status ---"
openclaw models status 2>/dev/null || echo "  (Run manually: openclaw models status)"

# Summary
echo ""
echo "=== Provider Configuration Summary ==="
echo "  Passed: $PASS"
echo "  Failed: $FAIL"

if [ "$FAIL" -gt 0 ]; then
    echo "  Fix failures before continuing."
    exit 1
fi

echo ""
echo "All providers configured."
echo "Proceed to 07-setup-telegram.sh"
