# OpenClaw + NemoClaw Local Deployment — PRD & Constitution

> **Created:** 2026-03-29
> **Last updated:** 2026-03-29
> **Version:** 1.1 (open questions resolved)
> **Scope:** Full setup, configuration, multi-agent deployment, and optimization of an OpenClaw instance wrapped with NVIDIA NemoClaw, running locally on Windows/WSL2.

---

## 1. Project Identity

This project is the setup, configuration, and ongoing optimization of a personal multi-agent AI assistant powered by OpenClaw, secured by NemoClaw's sandboxing and policy engine, running locally on a Windows machine via WSL2/Docker. It is NOT a SaaS product, not a multi-user deployment, and not a custom fork of OpenClaw — it uses the upstream project as-is with configuration-only customization.

---

## 2. Executive Summary

### What We're Building

A locally-hosted, always-on AI agent system that:

- Runs OpenClaw inside a NemoClaw sandbox on a Windows machine via WSL2 + Docker
- Uses a dual-primary model strategy: OpenAI Codex OAuth (existing ChatGPT Plus subscription, 5hr/week quota) for code-heavy tasks + Google Gemini 3 Flash (free tier) as the bulk workhorse
- Deploys multiple specialized agents (dev, comms, research, productivity, home automation)
- Connects via Telegram as the primary messaging channel
- Integrates with GitHub, Google Workspace, Obsidian, and Home Assistant
- Enforces enterprise-grade security policies from day one via NemoClaw's YAML policy engine
- Optimizes for reliability — tasks complete without babysitting

### Why NemoClaw Over Raw OpenClaw

OpenClaw has had multiple CVEs in early 2026, including a one-click RCE (CVE-2026-25253). NemoClaw adds kernel-level sandboxing via NVIDIA OpenShell, declarative network egress policies, filesystem isolation, and a real-time TUI for monitoring blocked requests. For an always-on agent with access to email, code repos, and home automation, this is not optional.

---

## 3. Hardware & Environment Constraints

| Component | Detail |
|-----------|--------|
| **OS** | Windows (primary) with WSL2 (Ubuntu 24.04) |
| **GPU** | 2× NVIDIA GTX 1070 Ti (8GB VRAM each, Pascal architecture) |
| **Docker** | Not yet installed — must be set up in WSL2 (NOT Docker Desktop) |
| **Node.js** | Required: v22+ (to be installed in WSL2) |
| **GPU limitation** | Pascal GPUs cannot run Nemotron or any serious local LLM. Local Ollama limited to ≤7B quantized models for trivial tasks only |
| **NemoClaw requirement** | Linux only — runs inside WSL2/Docker, not native Windows |

### Critical Constraint: GTX 1070 Ti Limitations

These are Pascal-generation cards. They lack the VRAM and compute for meaningful local inference. The local Ollama tier is strictly for heartbeat pings, simple classification, and routing decisions — never for primary agent reasoning. All substantive inference routes to cloud providers.

---

## 4. Model & Provider Strategy

### Critical Constraint: ChatGPT Plus Rate Limits

The user has a ChatGPT Plus subscription ($20/mo). ChatGPT Plus includes only a **5-hour weekly usage quota** for Codex. Users report hitting the weekly cap after roughly 6-7 full sessions — about 2 days of active use, then locked out for the rest of the week. There is also a known issue (since March 16, 2026) where some Codex OAuth users receive persistent 429 errors despite having quota remaining.

**Implication:** Codex on Plus CANNOT be the sole provider for an always-on multi-agent system. The model strategy must treat Gemini as the real workhorse, with Codex reserved for high-value code/tool tasks.

### Provider Hierarchy (Fallback Chain)

| Priority | Provider | Model | Auth Method | Cost | Role |
|----------|----------|-------|-------------|------|------|
| 1 (Bulk workhorse) | Google Gemini | gemini-3-flash | API key (AI Studio) | Free tier (60 req/min, 1K req/day) → $0.50/M input if exceeded | Default model for most agents. 1M context. Handles 70-80% of all requests. |
| 2 (Code/tool specialist) | OpenAI Codex | gpt-5.4 | Codex OAuth (ChatGPT Plus) | $0 incremental (5hr/week quota) | Dev agent primary. Code generation, tool use, structured output. Reserved for tasks where Codex excels. |
| 3 (Complex reasoning) | Anthropic Claude | claude-sonnet-4-6 | API key (console.anthropic.com) | ~$3/M input, $15/M output | On-demand for nuanced writing, complex multi-step reasoning. Budget-capped. |
| 4 (Local/heartbeats) | Ollama | qwen2.5:7b or similar | Local (127.0.0.1:11434) | $0 | Heartbeat pings, trivial classification, routing decisions only. |
| — | OpenAI API | text-embedding-3-small | API key | ~$0.02/M tokens | Embeddings for memory/search |

### Per-Agent Model Assignment

| Agent | Primary Model | Fallback | Rationale |
|-------|--------------|----------|-----------|
| main (orchestrator) | gemini-3-flash | openai-codex/gpt-5.4 | Routing is lightweight; save Codex quota |
| dev | openai-codex/gpt-5.4 | gemini-3-flash | Codex excels at code; this is where the quota is best spent |
| comms | gemini-3-flash | claude-sonnet-4-6 | Email drafting is prose-heavy; Claude fallback for nuanced writing |
| research | gemini-3-flash | (none — 1M context is the whole point) | Gemini's 1M context window is uniquely suited |
| productivity | gemini-3-flash | openai-codex/gpt-5.4 | Calendar/task ops are lightweight |
| home | ollama/qwen2.5:7b | gemini-3-flash | Simple commands stay local; complex automations escalate |

### Provider Auth Notes

- **Google Gemini API Key:** Free tier from Google AI Studio. NOT subscription OAuth (Google AI Ultra OAuth has caused account restrictions). Set via `GEMINI_API_KEY` in `~/.openclaw/.env`. Free tier: 60 requests/minute, 1,000 requests/day. If exceeded, overflow at $0.50/M input tokens.
- **OpenAI Codex OAuth:** Officially supported by OpenAI for third-party tools including OpenClaw. ToS-compliant. Run `openclaw onboard --auth-choice openai-codex` and complete browser OAuth flow. Tokens auto-refresh during active use. **Quota: 5 hours/week on Plus tier.** Monitor with `/status` in Codex CLI or `openclaw models status`.
- **Anthropic API Key:** Pay-per-token via console.anthropic.com. NOT subscription/setup-token (violates Anthropic ToS, structurally blocked). Budget-capped at $30/month initially.
- **Ollama:** Auto-detected at `http://127.0.0.1:11434` when running in WSL2. No auth needed.
- **Embeddings:** Separate OpenAI API key required — Codex OAuth does not include embeddings.

### Budget (Revised for Gemini-Primary Strategy)

| Category | Monthly Target | Notes |
|----------|---------------|-------|
| Gemini API (overflow past free tier) | $0–10 | Free tier covers ~30K requests/month; overflow unlikely unless heavy research |
| OpenAI Codex subscription | Existing $20/mo — $0 incremental | 5hr/week quota, reserved for dev agent |
| Anthropic Claude API (on-demand) | $0–30 | Comms agent fallback + occasional complex tasks |
| OpenAI embeddings | ~$0.50 | Trivial cost |
| **Total incremental** | **$0–40/month** | Well within $30-100 budget; leaves headroom |

---

## 5. Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│  Windows Host                                           │
│  ┌───────────────────────────────────────────────────┐  │
│  │  WSL2 (Ubuntu 24.04)                              │  │
│  │  ┌─────────────────────────────────────────────┐  │  │
│  │  │  Docker                                     │  │  │
│  │  │  ┌───────────────────────────────────────┐  │  │  │
│  │  │  │  NemoClaw Sandbox (OpenShell)         │  │  │  │
│  │  │  │  ┌───────────────────────────────┐    │  │  │  │
│  │  │  │  │  OpenClaw Gateway (:18789)    │    │  │  │  │
│  │  │  │  │  ├─ Agent: main (orchestrator)│    │  │  │  │
│  │  │  │  │  ├─ Agent: dev                │    │  │  │  │
│  │  │  │  │  ├─ Agent: comms              │    │  │  │  │
│  │  │  │  │  ├─ Agent: research           │    │  │  │  │
│  │  │  │  │  ├─ Agent: productivity       │    │  │  │  │
│  │  │  │  │  └─ Agent: home               │    │  │  │  │
│  │  │  │  └───────────────────────────────┘    │  │  │  │
│  │  │  │  Policy: openclaw-sandbox.yaml        │  │  │  │
│  │  │  │  Egress: allowlist-only               │  │  │  │
│  │  │  └───────────────────────────────────────┘  │  │  │
│  │  │  Ollama (localhost:11434) ← 7B models       │  │  │
│  │  └─────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────┘  │
│  Telegram ←→ Gateway (via allowed egress)               │
│  Obsidian vault (mounted read-only into sandbox)        │
└─────────────────────────────────────────────────────────┘
```

---

## 6. Agent Definitions

### 6.1 Main Agent (Orchestrator)

- **ID:** `main`
- **Model:** `google/gemini-3-flash` (fallback: `openai-codex/gpt-5.4`)
- **Role:** Routes incoming messages to specialized agents. Handles anything that doesn't clearly belong to a sub-agent. Manages inter-agent coordination.
- **Channel binding:** `telegram:*` (default fallback)
- **Skills:** Core OpenClaw skills only (shell, browser, file ops)

### 6.2 Dev Agent

- **ID:** `dev`
- **Model:** `openai-codex/gpt-5.4` (fallback: `google/gemini-3-flash`)
- **Role:** Software development automation — code review, PR triage, CI/CD monitoring, debugging, test writing. This agent gets priority Codex quota allocation.
- **Integrations:** GitHub API (all personal repos), local git repos (mounted), shell access
- **Channel binding:** Routed from main agent via `/dev` prefix or auto-detected dev context
- **SOUL.md focus:** Concise, opinionated code reviews. Prefer small PRs. Always run tests before suggesting merge.

### 6.3 Comms Agent

- **ID:** `comms`
- **Model:** `google/gemini-3-flash` (fallback: `anthropic/claude-sonnet-4-6` for nuanced writing)
- **Role:** Email drafting, client communication, message triage, response suggestions
- **Integrations:** Gmail API (personal + one work/business account), Google Calendar
- **Accounts:** Two Gmail accounts — personal and work/business. Agent must clearly label which account a draft is for.
- **Channel binding:** Routed from main agent
- **SOUL.md focus:** Professional tone, never send without explicit approval, always summarize before drafting

### 6.4 Research Agent

- **ID:** `research`
- **Model:** `google/gemini-3-flash` (no fallback needed — 1M context is the whole point)
- **Role:** Web research, document analysis, summarization, competitive intelligence
- **Integrations:** Browser (headless Chromium), Obsidian vault (read-only)
- **Channel binding:** Routed from main agent
- **SOUL.md focus:** Cite sources, flag uncertainty, prefer primary sources

### 6.5 Productivity Agent

- **ID:** `productivity`
- **Model:** `google/gemini-3-flash` (fallback: `openai-codex/gpt-5.4`)
- **Role:** Calendar management, task tracking, daily briefings, habit tracking, note organization
- **Integrations:** Google Calendar, Google Drive, Obsidian vault
- **Channel binding:** Routed from main agent
- **Heartbeat:** Active — morning briefing at 7:00 AM Pacific, evening summary at 9:00 PM Pacific
- **SOUL.md focus:** Proactive, concise, structured output (markdown tables for schedules)
- **Timezone:** US Pacific (America/Los_Angeles)

### 6.6 Home Agent

- **ID:** `home`
- **Model:** `ollama/qwen2.5:7b` (simple commands) → `google/gemini-3-flash` (complex automations)
- **Role:** Home Assistant control, device status, automation creation
- **Integrations:** Home Assistant REST API (to be set up — not yet running)
- **Channel binding:** Routed from main agent via `/home` prefix
- **SOUL.md focus:** Confirm destructive actions, never execute without confirmation for security devices (locks, alarms, cameras)
- **Note:** Home Assistant setup is a prerequisite. This agent will be configured in Phase 2 but may be deferred to Phase 3 if HA setup takes longer than expected.

---

## 7. Security & NemoClaw Policy

### 7.1 Security Posture: Enterprise-Grade

All agent activity runs inside the NemoClaw sandbox. Default-deny for network egress. Filesystem restricted to sandbox + tmp. Real-time monitoring via `openshell term` TUI.

### 7.2 Network Egress Policy (openclaw-sandbox.yaml)

```yaml
# Allow only these endpoints — everything else is blocked
egress:
  allowed:
    # LLM providers
    - api.openai.com
    - auth.openai.com
    - generativelanguage.googleapis.com
    - api.anthropic.com
    # Integrations
    - api.github.com
    - api.telegram.org
    - www.googleapis.com        # Google Workspace
    - oauth2.googleapis.com
    - accounts.google.com
    # Home Assistant (local network)
    - homeassistant.local:8123  # adjust to your HA instance
    # Package registries (for skill installation)
    - registry.npmjs.org
    - pypi.org
    - files.pythonhosted.org
  denied:
    - "*"  # default deny
```

### 7.3 Filesystem Policy

- `/sandbox/` — agent workspace (read-write)
- `/tmp/` — temporary files (read-write, cleared on restart)
- `/mnt/obsidian/` — Obsidian vault (read-only mount from host)
- Everything else — blocked

### 7.4 Operational Security Rules

- Agents MUST NOT modify their own config, auth credentials, or SOUL.md files
- Comms agent MUST NOT send emails without explicit user approval via Telegram confirmation
- Home agent MUST NOT execute destructive actions (locks, alarms, garage) without confirmation
- All agent actions are audit-logged by OpenShell
- Setup-tokens and API keys stored in `~/.openclaw/.env` — never in openclaw.json or committed to git
- Telegram channel uses device pairing (one authorized device only)

---

## 8. Integration Details

### 8.1 Telegram

- Primary (and initially only) messaging channel
- Bot created via @BotFather
- Device pairing enabled for security
- All agents accessible through the main bot — routing handled by main agent
- Commands: `/dev`, `/comms`, `/research`, `/home`, `/tasks` for explicit routing

### 8.2 GitHub

- Personal Access Token (fine-grained, scoped to ALL personal repos)
- Capabilities: read/write issues, read/write PRs, read repo contents, webhooks
- Dev agent monitors all personal repos for new PRs and issues
- Token scope should cover all repos owned by the user's GitHub account

### 8.3 Google Workspace

- OAuth 2.0 via Google Cloud Console project
- Scopes: Gmail (read/send), Calendar (read/write), Drive (read)
- **Two Gmail accounts:** personal and work/business
- Comms agent handles both accounts; must clearly label which account a draft belongs to
- Productivity agent handles Calendar/Drive (primary account)

### 8.4 Obsidian

- Local vault directory mounted read-only into the NemoClaw sandbox
- Research and Productivity agents can read notes for context
- No write access — notes are managed by the user outside the agent system
- Agent can suggest additions via Telegram messages
- **Vault folder exclusions:** TBD — will be configured during Phase 2 setup. For now, mount the entire vault read-only and refine later.

### 8.5 Home Assistant

- **Status: Not yet set up.** User wants to set up Home Assistant as part of this project.
- Will run locally on the home network (separate device or Docker container in WSL2 — TBD)
- REST API access via long-lived access token
- Limited to non-destructive actions by default (lights, climate, sensors, media)
- Destructive actions (locks, alarms, garage) require Telegram confirmation
- Home agent runs on local Ollama for simple commands, escalates to Gemini for complex automations
- **Phase note:** HA setup may be deferred from Phase 2 to Phase 3 depending on hardware/time. The home agent skeleton will be created in Phase 2 but HA integration is not a Phase 2 gate.

### 8.6 Suggested Future Integrations

These are out of scope for Phase 1 but worth planning for:

- **Linear/Jira** — project/issue tracking beyond GitHub Issues
- **Todoist** — lightweight personal task capture
- **RSS/Hacker News** — research agent content surfacing
- **Docker API** — let dev agent manage containers
- **Cloudflare** — DNS/tunnel management if hosting anything
- **n8n (self-hosted)** — workflow bridge for services without direct OpenClaw skills

---

## 9. Optimization Strategy

### Primary Optimization Target: Reliability

"Tasks complete without babysitting" means:

1. **Fallback chains work silently.** If Codex OAuth token expires mid-task, the agent falls back to Gemini, then Claude API, without user intervention. The user sees the result, not the provider switch.
2. **Heartbeats are resilient.** The heartbeat scheduler uses local Ollama for simple check-ins, so cloud provider outages don't break the wake-up cycle. Heartbeats MUST NOT consume Codex quota.
3. **Codex quota is preserved.** Only the dev agent uses Codex as its primary model. All other agents default to Gemini. Codex quota (~5hr/week on Plus) is a scarce resource treated like a budget.
3. **Memory persists correctly.** Markdown-based memory files are backed up to a private GitHub repo nightly. Context carries across sessions without drift.
4. **Error recovery is autonomous.** If a tool call fails (e.g., GitHub API 500), the agent retries with exponential backoff, then reports the failure to Telegram if it can't recover.
5. **No silent failures.** Every unrecoverable error produces a Telegram notification.

### Secondary Optimization: Cost Control

- Model routing: Gemini free tier handles 70-80% of requests at $0. Codex (free but quota-limited) handles dev tasks. Claude API is budget-capped at $30/month.
- Heartbeat frequency tuned to avoid burning Gemini free tier limits (1K req/day = ~42 req/hour max). Default heartbeat every 30 min is safe.
- Embeddings use the cheapest model (text-embedding-3-small at $0.02/M tokens)
- Monitor Codex quota usage weekly; if consistently hitting cap, consider upgrading to ChatGPT Pro ($200/mo) or shifting more dev work to Gemini

### Tertiary Optimization: Response Quality

- Per-agent SOUL.md files tuned for each agent's primary model (Gemini for most, Codex for dev, Ollama for home)
- Gemini used specifically for long-context tasks where its 1M window is an advantage
- Claude API reserved for tasks requiring nuanced writing or complex multi-step reasoning (comms agent fallback)
- Codex reserved for code generation, tool use, and structured output where it measurably outperforms Gemini

---

## 10. Phased Delivery Plan

### Phase 1: Foundation (Infrastructure + Single Agent)

> **Objective:** Get a single working OpenClaw agent inside NemoClaw on WSL2, connected to Telegram, authenticating via Codex OAuth.

**Entry criteria:** None (greenfield)

**Deliverables:**

| # | Deliverable | Exit Criteria |
|---|------------|---------------|
| 1 | WSL2 Ubuntu 24.04 configured | `wsl --list --verbose` shows Ubuntu running v2 |
| 2 | Docker Engine installed in WSL2 | `docker run hello-world` succeeds inside WSL2 |
| 3 | Node.js 22+ installed in WSL2 | `node --version` shows v22+ |
| 4 | NemoClaw installed and sandbox running | `nemoclaw <name> status` shows sandbox healthy |
| 5 | OpenClaw installed inside sandbox | `openclaw --version` returns current stable |
| 6 | Codex OAuth authenticated | `openclaw models status` shows openai-codex profile active |
| 7 | Gemini API key configured as default model | `openclaw models status` shows google provider available AND set as global default |
| 8 | Anthropic API key configured as fallback | `openclaw models status` shows anthropic provider available |
| 9 | Ollama running with 7B model | `curl http://localhost:11434/api/tags` returns model list |
| 10 | Telegram bot connected | `openclaw channels status --probe` shows Telegram connected |
| 11 | Single "main" agent responding via Telegram (using Gemini) | Send "hello" → receive coherent response via Gemini |
| 12 | NemoClaw egress policy applied | `openshell term` shows policy active, test blocked domain |
| 13 | OpenAI embeddings API key configured | `openclaw models status` shows embeddings available |
| 14 | Fallback chain tested (Gemini → Codex → Claude) | Temporarily disable Gemini key → verify Codex picks up; disable both → verify Claude picks up |

**Kill criteria:** If NemoClaw cannot run inside WSL2/Docker due to kernel-level sandboxing incompatibility (Landlock/seccomp may not work in WSL2 kernel), fall back to raw OpenClaw with manual security hardening (AppArmor profile, read-only mounts, VLAN isolation).

**Cost estimate:**

| Category | Low | High | Notes |
|----------|-----|------|-------|
| Build cost | $0 | $0 | All open source |
| Monthly operating | $0 | $5 | Mostly free tier; some Gemini overflow |

**Top risks:**

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| NemoClaw sandboxing fails on WSL2 kernel | Medium | High | Fallback to raw OpenClaw + manual hardening |
| Codex OAuth token refresh fails | Low | Medium | Gemini fallback + alert to Telegram |
| GTX 1070 Ti Ollama performance too slow | Low | Low | Reduce heartbeat frequency, use cloud for everything |
| WSL2 networking issues with Docker | Medium | Medium | Use host networking mode; port-forward from Windows |

---

### Phase 2: Multi-Agent + Core Integrations

> **Objective:** Deploy all 6 agents with routing, connect GitHub, Google Workspace, and Obsidian.

**Entry criteria:** Phase 1 exit criteria all pass

**Deliverables:**

| # | Deliverable | Exit Criteria |
|---|------------|---------------|
| 1 | All 6 agents created with SOUL.md files | `openclaw agents list` shows 6 agents |
| 2 | Routing bindings configured | Messages route to correct agent based on prefix/context |
| 3 | GitHub integration working | Dev agent can list PRs, read issues, post comments |
| 4 | Gmail integration working | Comms agent can read inbox, draft replies (no auto-send) |
| 5 | Google Calendar integration working | Productivity agent can read/create events |
| 6 | Obsidian vault mounted read-only | Research agent can search and read notes |
| 7 | Per-agent model routing configured | Research agent uses Gemini; Home agent uses Ollama for simple tasks |
| 8 | Fallback chain tested | Manually expire Codex token → verify automatic fallback to Gemini |
| 9 | NemoClaw policy updated for all integrations | All new API endpoints in egress allowlist |
| 10 | Each agent responds correctly to a test scenario | Scripted test per agent (see acceptance criteria below) |

**Agent acceptance tests:**

- **Dev:** "List open PRs on [repo]" → returns accurate PR list from GitHub
- **Comms:** "Summarize my last 5 emails" → returns email summaries from Gmail
- **Research:** "Summarize the key points from my note on [topic]" → reads Obsidian vault, returns summary
- **Productivity:** "What's on my calendar tomorrow?" → returns correct calendar events
- **Home:** "Turn on the living room lights" → sends correct API call to Home Assistant
- **Main:** "Help me debug this error: [paste]" → routes to dev agent automatically

**Cost estimate:**

| Category | Low | High | Notes |
|----------|-----|------|-------|
| Build cost | $0 | $0 | Configuration only |
| Monthly operating | $0 | $15 | More API calls during setup/testing |

**Top risks:**

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| Google OAuth scope approval delays | Medium | Medium | Start with API key for Gmail; upgrade to OAuth later |
| Agent routing misclassifies messages | Medium | Low | Add explicit `/command` prefixes as override |
| Obsidian vault too large for context | Low | Medium | Use Gemini's 1M context; add search/filter skills |

---

### Phase 3: Automation & Heartbeats

> **Objective:** Set up proactive behaviors — morning briefings, PR monitoring, habit tracking, nightly backups.

**Entry criteria:** Phase 2 exit criteria all pass. All agents responding correctly for at least 48 hours without manual intervention.

**Deliverables:**

| # | Deliverable | Exit Criteria |
|---|------------|---------------|
| 1 | Morning briefing cron job | Telegram message at 7:00 AM Pacific with calendar, email summary, tasks |
| 2 | Evening summary cron job | Telegram message at 9:00 PM Pacific with day's activity, pending items |
| 3 | PR monitoring heartbeat | New PRs on any personal repo trigger Telegram notification + summary |
| 4 | Nightly memory backup to GitHub | Private repo updated nightly with memory/*.md files |
| 5 | Error alerting configured | Any unrecoverable agent error → Telegram notification within 60s |
| 6 | Heartbeat frequency tuned | Heartbeat interval set to balance responsiveness vs. Gemini free tier rate limits (1K req/day) |
| 7 | Habit tracking via Telegram | "Log gym 45 minutes" → updates habits markdown, persists |
| 8 | Home Assistant setup (if ready) | HA running locally, home agent connected. **May defer to Phase 4 if HA hardware not yet available.** |

**Cost estimate:**

| Category | Low | High | Notes |
|----------|-----|------|-------|
| Build cost | $0 | $0 | Skills + cron config |
| Monthly operating | $5 | $30 | Increased heartbeat/cron API usage |

---

### Phase 4: Optimization & Hardening

> **Objective:** Tune for long-term reliability, optimize costs, harden security based on real usage data.

**Entry criteria:** Phase 3 running for at least 2 weeks. Usage logs available for cost analysis.

**Deliverables:**

| # | Deliverable | Exit Criteria |
|---|------------|---------------|
| 1 | Cost analysis report | Breakdown of API spend by provider, agent, and task type |
| 2 | Model routing optimized | Tasks routed to cheapest capable model based on 2-week usage data |
| 3 | SOUL.md files tuned | Agents follow instructions reliably >90% of the time (manual audit of 20 tasks per agent) |
| 4 | Memory quality audit | Agent correctly recalls context from 1+ week ago in test scenarios |
| 5 | NemoClaw policy tightened | Remove any unused egress endpoints; add rate limits |
| 6 | Backup/restore tested | Simulate sandbox destruction → restore from backup → all agents operational |
| 7 | Documentation complete | README with architecture diagram, troubleshooting guide, and runbook |

**Cost estimate:**

| Category | Low | High | Notes |
|----------|-----|------|-------|
| Monthly operating (steady state) | $5 | $55 | Optimized routing should lower costs |

---

## 11. Stack Constraints

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Host OS | Windows + WSL2 (Ubuntu 24.04) | User's existing machine |
| Container runtime | Docker Engine (in WSL2) | NemoClaw requirement |
| Sandbox | NemoClaw / NVIDIA OpenShell | Enterprise security posture |
| Agent framework | OpenClaw (upstream, latest stable) | No custom forks |
| Primary LLM | Gemini 3 Flash via API key | Free tier workhorse; 1M context; 70-80% of requests |
| Code specialist | OpenAI Codex via OAuth (ChatGPT Plus) | 5hr/week quota; reserved for dev agent |
| On-demand LLM | Claude Sonnet 4.6 via API key | Complex reasoning; budget-capped at $30/mo |
| Local LLM | Ollama (7B models) on GTX 1070 Ti | Heartbeats only |
| Embeddings | OpenAI text-embedding-3-small | Cheapest option |
| Messaging | Telegram | User preference |
| Package manager | npm (global installs in WSL2) | OpenClaw standard |
| Memory storage | Markdown files (OpenClaw default) | Local-first, portable |
| Backup | Private GitHub repo (nightly cron) | Disaster recovery |

---

## 12. Anti-Patterns

| Anti-Pattern | Rationale |
|-------------|-----------|
| Using Claude subscription OAuth tokens in OpenClaw | Explicitly violates Anthropic ToS; structurally blocked; accounts have been banned |
| Using Google AI Ultra subscription OAuth in OpenClaw | Accounts have been restricted without warning |
| Running OpenClaw outside the NemoClaw sandbox | Unacceptable attack surface for an always-on agent with email/code/home access |
| Letting agents modify their own config or auth | Creates circular dependencies and potential security holes |
| Auto-sending emails without user confirmation | Risk of sending incorrect/inappropriate communications |
| Hardcoding API keys in openclaw.json | Keys belong in ~/.openclaw/.env or auth-profiles.json only |
| Using Docker Desktop on Windows | Resource-heavy; use Docker Engine directly in WSL2 instead |
| Running Nemotron or large models on GTX 1070 Ti | 8GB VRAM is insufficient; will OOM or crawl |
| Using Codex for non-code tasks | 5hr/week quota is scarce; only the dev agent should use Codex as primary. All other agents default to Gemini. |
| Running heartbeats on cloud providers | Heartbeats must use local Ollama to avoid burning Gemini/Codex quota on trivial pings |
| Single-provider dependency | Always maintain fallback chain; never assume one provider is always available |
| Calendar-based phase transitions | All phase gates are measurement-based, not time-based |

---

## 13. Resolved Questions

All questions resolved as of 2026-03-29.

| # | Question | Resolution | Impact |
|---|----------|-----------|--------|
| 1 | Does NemoClaw's Landlock/seccomp sandboxing work correctly on the WSL2 kernel? | **UNTESTED — will be validated in Phase 1.** Kill criteria defined: if it fails, fall back to raw OpenClaw with manual AppArmor hardening. | Phase 1 kill criteria |
| 2 | What ChatGPT subscription tier? | **ChatGPT Plus ($20/mo).** 5hr/week Codex quota. Model strategy revised: Gemini is the bulk workhorse, Codex reserved for dev agent only. | Revised entire model strategy — see §4 |
| 3 | Which GitHub repos? | **All personal repos.** Fine-grained PAT scoped to all repos owned by the user's account. | Dev agent config, PAT scope |
| 4 | Home Assistant? | **Not yet running.** User wants to set it up. HA integration may defer from Phase 2 to Phase 3. Home agent skeleton created in Phase 2, full integration when HA is ready. | Phase 2/3 flexibility |
| 5 | Time zone and briefing times? | **US Pacific (America/Los_Angeles).** Morning briefing: 7:00 AM. Evening summary: 9:00 PM. | Cron job config |
| 6 | Obsidian vault folders to exclude? | **TBD — will be configured during Phase 2.** Mount entire vault read-only initially, refine later. | Phase 2 config |
| 7 | Email accounts beyond personal Gmail? | **Personal + one work/business account.** Comms agent handles both. Must clearly label which account a draft belongs to. | OAuth scope, comms agent SOUL.md |

---

## 14. Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Agent uptime | >99% over 30 days | `openclaw logs` — count minutes of gateway downtime |
| Task completion without intervention | >90% of initiated tasks | Manual audit of 50 random tasks over 2 weeks |
| Gemini free tier sufficiency | >90% of days stay within free tier (1K req/day) | Google AI Studio usage dashboard |
| Codex quota usage | <80% of weekly 5hr quota (leaves headroom) | `openclaw models status --json` or OpenAI Codex dashboard |
| Monthly API cost (steady state) | <$40 | Provider billing dashboards |
| Morning briefing delivery | >95% on-time (within 5 min of 7:00 AM Pacific) | Telegram message timestamps |
| Evening summary delivery | >95% on-time (within 5 min of 9:00 PM Pacific) | Telegram message timestamps |
| Error alert latency | <60s from error to Telegram notification | Test with synthetic failures |
| Memory recall accuracy | Correctly references context from 7+ days ago | Manual test scenarios |
| Fallback chain reliability | Automatic failover completes in <10s with no user action | Test by temporarily disabling primary provider |

---

## 15. Glossary

- **OpenClaw:** Open-source AI agent framework. Persistent daemon with messaging integrations, heartbeat scheduler, skill system, and markdown-based memory.
- **NemoClaw:** NVIDIA's security wrapper for OpenClaw. Adds OpenShell sandboxing, policy-based egress control, and optional local Nemotron inference.
- **OpenShell:** NVIDIA's open-source runtime for sandboxing autonomous agents. Provides Landlock + seccomp + network namespace isolation.
- **Codex OAuth:** OpenAI's subscription-based authentication that allows ChatGPT Plus/Pro subscribers to use their subscription in third-party tools like OpenClaw.
- **Setup-token:** A Claude Code CLI mechanism for generating OAuth tokens linked to Anthropic subscriptions. Currently blocked for third-party use by Anthropic's ToS.
- **Gateway:** OpenClaw's long-lived WebSocket server (default port 18789) that accepts input from all channels and routes to agents.
- **Heartbeat:** A scheduled wake-up cycle where the agent proactively checks for tasks, monitors inboxes, and sends updates without being prompted.
- **SOUL.md:** An OpenClaw file that defines an agent's personality, capabilities, and behavioral constraints. Equivalent to a system prompt.
- **Skill:** An OpenClaw plugin (markdown file + optional code) that gives an agent a specific capability.
- **Egress policy:** A NemoClaw YAML file that defines which network endpoints the sandboxed agent is allowed to reach. Default-deny.
