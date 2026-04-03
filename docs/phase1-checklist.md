# Phase 1: Foundation — Exit Criteria Checklist

> **Objective:** Get a single working OpenClaw agent inside NemoClaw on WSL2, connected to Telegram, authenticating via Codex OAuth.

## Exit Criteria (14 deliverables from PRD §10)

- [ ] **1. WSL2 Ubuntu 24.04 configured**
  - Verify: `wsl --list --verbose` shows Ubuntu running v2

- [ ] **2. Docker Engine installed in WSL2**
  - Verify: `docker run hello-world` succeeds inside WSL2

- [ ] **3. Node.js 22+ installed in WSL2**
  - Verify: `node --version` shows v22+

- [ ] **4. NemoClaw installed and sandbox running**
  - Verify: `nemoclaw clawbot status` shows sandbox healthy

- [ ] **5. OpenClaw installed inside sandbox**
  - Verify: `openclaw --version` returns current stable

- [ ] **6. Codex OAuth authenticated**
  - Verify: `openclaw models status` shows openai-codex profile active

- [ ] **7. Gemini API key configured as default model**
  - Verify: `openclaw models status` shows google provider available AND set as global default

- [ ] **8. Anthropic API key configured as fallback**
  - Verify: `openclaw models status` shows anthropic provider available

- [ ] **9. Ollama running with 7B model**
  - Verify: `curl http://localhost:11434/api/tags` returns model list including qwen2.5:7b

- [ ] **10. Telegram bot connected**
  - Verify: `openclaw channels status --probe` shows Telegram connected

- [ ] **11. Single "main" agent responding via Telegram (using Gemini)**
  - Verify: Send "hello" → receive coherent response via Gemini
  - Check logs for `provider: google/gemini-3-flash`

- [ ] **12. NemoClaw egress policy applied**
  - Verify: `openshell term` shows policy active
  - Test: attempt to reach a blocked domain from inside the sandbox → blocked

- [ ] **13. OpenAI embeddings API key configured**
  - Verify: `openclaw models status` shows embeddings available

- [ ] **14. Fallback chain tested (Gemini → Codex → Claude)**
  - Test procedure:
    1. Temporarily set an invalid Gemini key → send a message → verify Codex picks up
    2. Also invalidate Codex → send a message → verify Claude picks up
    3. Restore all keys when done
  - Verify: automatic failover completes in <10s with no user action

## Kill Criteria

If NemoClaw cannot run inside WSL2/Docker due to kernel-level sandboxing incompatibility (Landlock/seccomp on WSL2 kernel), fall back to:
- Raw OpenClaw with manual security hardening
- AppArmor profile
- Read-only mounts
- VLAN isolation

## Automated Validation

Run `scripts/09-verify-phase1.sh` to check all automated criteria.
Manual items (11, 12 partial, 14) require hands-on testing.
