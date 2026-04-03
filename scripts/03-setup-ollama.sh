#!/usr/bin/env bash
# 03-setup-ollama.sh — Install Ollama, pull qwen2.5:7b, verify GPU
set -euo pipefail

echo "=== Setting Up Ollama ==="
echo ""

MODEL="qwen2.5:7b"

# Install Ollama
if ! command -v ollama &>/dev/null; then
    echo "--- Installing Ollama ---"
    curl -fsSL https://ollama.com/install.sh | sh
else
    echo "--- Ollama already installed ---"
fi

# Start Ollama service if not running
if ! curl -s http://127.0.0.1:11434/api/tags &>/dev/null; then
    echo "--- Starting Ollama ---"
    ollama serve &>/dev/null &
    sleep 3
fi

# Pull the model
echo ""
echo "--- Pulling $MODEL ---"
ollama pull "$MODEL"

# Verify GPU detection
echo ""
echo "--- GPU Detection ---"
if ollama ps 2>/dev/null | grep -qi "gpu\|cuda"; then
    echo "  [PASS] Ollama detected GPU"
elif nvidia-smi &>/dev/null; then
    echo "  [WARN] nvidia-smi works but Ollama may not be using GPU"
    echo "         Check: OLLAMA_NUM_GPU=1 ollama run $MODEL"
else
    echo "  [WARN] No GPU detected — Ollama will use CPU (slower but functional)"
fi

# Verify model responds
echo ""
echo "--- Testing model response ---"
RESPONSE=$(curl -s http://127.0.0.1:11434/api/generate \
    -d "{\"model\": \"$MODEL\", \"prompt\": \"Say hello in one sentence.\", \"stream\": false}" \
    | grep -o '"response":"[^"]*"' | head -1)

if [ -n "$RESPONSE" ]; then
    echo "  [PASS] Model responded: $RESPONSE"
else
    echo "  [FAIL] Model did not respond"
    exit 1
fi

# Verify API endpoint
echo ""
echo "--- API endpoint check ---"
if curl -s http://127.0.0.1:11434/api/tags | grep -q "$MODEL"; then
    echo "  [PASS] Model $MODEL available at http://127.0.0.1:11434"
else
    echo "  [FAIL] Model not found in API response"
    exit 1
fi

echo ""
echo "Ollama installed with $MODEL."
echo "Proceed to 04-setup-nemoclaw.sh"
