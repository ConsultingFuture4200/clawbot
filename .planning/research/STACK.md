# Technology Stack: Email Triage Agent

**Project:** ClawBot Email Triage Agent
**Researched:** 2026-03-31
**Overall confidence:** HIGH

---

## Recommended Stack

### Core Framework (Already Deployed)

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| **OpenClaw** | 2026.2.x (latest stable) | Agent framework, gateway, heartbeat scheduler, session management | Already deployed and operational. The comms agent skeleton exists with `gmail` and `google-calendar` skills configured. No reason to use anything else. | HIGH |
| **NemoClaw / OpenShell** | Latest stable | Sandbox, egress policy, filesystem isolation | Already deployed. Email triage runs inside the existing sandbox. Egress policy already allows `www.googleapis.com`, `oauth2.googleapis.com`, `accounts.google.com`. | HIGH |
| **Node.js** | 22+ (already in WSL2) | Runtime for OpenClaw gateway and skills | OpenClaw requirement. Already installed and validated in Phase 1. | HIGH |

### Gmail Integration

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| **gog CLI** (OpenClaw skill) | Built-in (openclaw/skills/gog) | Gmail read, draft, label, search operations; Google Calendar event queries | The gog skill is OpenClaw's official Google Workspace CLI. Already referenced in comms agent config (`skills: ["gmail", "google-calendar"]`). Supports multi-account via `gog auth add`, Gmail search/send/draft/label, Calendar event read/create, Drive search. Outputs JSON for automation. No need to write custom Gmail API wrappers. | HIGH |
| **Google OAuth2** | OAuth 2.0 (current) | Authentication for both Gmail accounts | Required by Gmail API. Use user-credential OAuth (not service account) because personal Gmail accounts do not support domain-wide delegation. One GCP project, two user authorizations. Set consent screen to "Production" status to avoid the 7-day token expiry trap (see PITFALLS.md #1). | HIGH |
| **googleapis** (npm) | 171.4.0 | Direct Gmail API access for operations gog does not cover (history.list, batch get) | gog CLI handles most operations, but `history.list` for incremental sync and batch message fetching may require direct API calls from custom skill code. The `googleapis` package is Google's official Node.js client. Use the standalone `@googleapis/gmail` (v16.1.1) if you want a smaller install footprint. | HIGH |
| **google-auth-library** (npm) | 10.6.2 | OAuth2 token management, refresh, and multi-account credential handling | Google's official Node.js auth library. Handles token refresh automatically. Required for direct API calls outside gog. Supports multiple OAuth2Client instances (one per Gmail account). | HIGH |

**Why NOT these alternatives:**

| Alternative | Why Not |
|-------------|---------|
| **Himalaya (IMAP/SMTP)** | OpenClaw's simpler email method, but OAuth2 requires a browser (agents run headless). IMAP polling is less efficient than Gmail API `history.list`. No structured metadata access (labels, threadId, historyId). No draft creation via API -- only raw SMTP. gog with OAuth is strictly superior for this use case. |
| **Gmail Pub/Sub push** | Requires a publicly reachable HTTPS endpoint or GCP pull subscription. NemoClaw sandbox behind WSL2/Docker does not expose inbound ports by default. GCP Pub/Sub adds billing account dependency and infrastructure complexity. For a personal assistant polling 2 accounts, `history.list` every 10 minutes during business hours is perfectly adequate. Save Pub/Sub for if/when polling latency becomes a pain point. |
| **AgentMail / LobsterMail** | Third-party agent-email APIs marketed for AI agent use. Unnecessary complexity and cost for 2 personal Gmail accounts. These solve multi-tenant SaaS problems we do not have. Direct Gmail API access is free, well-documented, and already allowed through the sandbox egress policy. |
| **nodemailer** | SMTP sending library. We create Gmail drafts via API, not send via SMTP. The user sends from Gmail UI after approving in Telegram. nodemailer has no role here. |
| **Zapier MCP** | Adds Zapier as a dependency between agent and Gmail. Unnecessary middleware layer. Direct API access is simpler, faster, and free. |

### Email Sync & Polling

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| **Gmail API `history.list`** | v1 (current) | Incremental email sync via historyId tracking | The correct sync primitive for polling. Returns only changes since last check. Costs 2 quota units per call (vs 5 for `messages.list`). Store historyId per account in `/sandbox/state/email-sync-{account}.json`. Falls back gracefully to full sync on 404. | HIGH |
| **OpenClaw heartbeat** | Built-in | Schedule polling intervals with priority-aware cadence | OpenClaw's heartbeat scheduler handles the cron/interval mechanics. Configure tiered polling: every 10 min during business hours, every 30 min evenings, every 3 hours overnight. Uses `ollama/qwen2.5:7b` for the gate check (is there new mail?), escalates to `gemini-3-flash` only when new messages exist. | HIGH |
| **OpenClaw cron** | Built-in | Exact-time scheduled tasks (morning digest, evening summary) | Use cron for time-precise deliveries (morning briefing at 7 AM, evening summary at 9 PM). Use heartbeat for interval-based polling. They complement each other. | HIGH |

### Classification Engine

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| **Gemini 3 Flash** | gemini-3-flash (API) | Primary email classification model | Free tier workhorse. Supports structured JSON output natively via response schema. 7-category multi-label classification with confidence scores in a single API call. ~500-1500 tokens per classification (metadata + few-shot examples + response). At 50 emails/day, that is ~25K-75K tokens/day -- well within free tier even at reduced quotas. | HIGH |
| **Gemini structured output** | responseSchema | Force JSON classification responses | Gemini's `responseMimeType: "application/json"` with a JSON Schema ensures every classification returns valid, parseable JSON with required fields (categories, confidence, priority, reasoning). No regex parsing of free-text. No "oops the model returned prose instead of JSON." This is the correct approach for classification pipelines. | HIGH |
| **Few-shot prompt engineering** | N/A | Classification technique | Start with well-crafted few-shot examples (2-3 per category = 14-21 total). This is the consensus 2025-2026 approach for classification before fine-tuning: 32 few-shot examples match or beat fine-tuned BERT. Fine-tuning Gemini would require hundreds of curated examples and ongoing training -- premature for v1. | HIGH |
| **ollama/qwen2.5:7b** | 7b-q4 | Pre-filter obvious spam/noise locally | Run locally on GTX 1070 Ti. Handles the binary "is this clearly spam?" question at zero API cost before sending ambiguous emails to Gemini. Also handles heartbeat gate checks ("any new historyId?"). Keeps cloud quota for emails that actually need intelligent classification. | MEDIUM |

**Why NOT fine-tuning:**

Fine-tuning requires minimum hundreds of labeled examples, cloud GPU compute (not available locally on GTX 1070 Ti), and ongoing retraining as email patterns shift. Few-shot prompting with a learning memory file achieves the same adaptive behavior with zero training cost. If classification accuracy plateaus below 85% after 4+ weeks of corrections, revisit fine-tuning as a Phase 3+ optimization. Until then, structured few-shot prompts are the correct choice.

### Agent Communication & Delegation

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| **OpenClaw `sessions_spawn`** | Built-in (2026.2+) | Delegate emails to sibling agents (dev, research, productivity, home) | Creates an isolated sub-agent session for a delegated task. Non-blocking: returns immediately with `runId` and `childSessionKey`. Results announced back to the comms agent's channel. Sub-agents get full tool sets minus session tools (no recursive spawning). Ideal for "classify this email, send context to dev agent, get summary back." | HIGH |
| **OpenClaw `sessions_send`** | Built-in (2026.2+) | Synchronous inter-agent messaging for simple queries | When comms needs a quick answer from another agent (e.g., "is this PR already reviewed?" to dev), `sessions_send` with a timeout provides inline response. Use for short queries; use `sessions_spawn` for full tasks. | HIGH |
| **OpenClaw `agentToAgent`** | Built-in | Enable inter-agent communication in config | Disabled by default for safety. Must explicitly enable: `tools.agentToAgent.enabled: true` with `allow: ["dev", "research", "productivity", "home", "main"]` in the comms agent config. Without this, all delegation attempts fail silently. | HIGH |

**Delegation architecture decision:** Use `sessions_spawn` (not `sessions_send`) for email delegation because:
1. Email processing is a self-contained unit of work (classify, summarize, suggest action)
2. The comms agent should not block waiting for dev agent to analyze a PR
3. Sub-agent isolation prevents context contamination between accounts
4. Results post back to the comms agent's channel automatically

### Memory & Learning

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| **OpenClaw memory (markdown)** | Built-in | Store classification patterns, user corrections, contact preferences | OpenClaw's native memory system: MEMORY.md for durable facts, memory/YYYY-MM-DD.md for daily notes. Loaded automatically at session start. Account-separated files: `memory/email-patterns/personal/` and `memory/email-patterns/work/`. Human-readable, git-backupable, zero infrastructure. | HIGH |
| **OpenClaw `memory_search`** | Built-in | Semantic search over stored patterns | Hybrid search combining vector similarity + keyword matching. Auto-detects embedding provider (OpenAI text-embedding-3-small is already configured). When the classifier encounters an ambiguous email, `memory_search` finds similar past corrections to boost confidence. | HIGH |
| **text-embedding-3-small** (OpenAI) | Current | Embeddings for pattern similarity search | Already configured in openclaw.json5. ~$0.02/M tokens -- trivial cost. Used for embedding email (subject + snippet) -> vector index -> similarity lookup against corrected classifications. The learning loop: user corrects a classification -> embed the email -> store vector -> future similar emails get the corrected label. | HIGH |

### Draft Generation

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| **Gemini 3 Flash** | gemini-3-flash | Routine draft generation (acknowledgments, receipts, template-based) | Handles 80% of drafts: "thanks, got it," "I'll review and get back to you," RSVP accept/decline with calendar conflict check. Fast, free, adequate quality for formulaic responses. | HIGH |
| **Claude Sonnet 4.6** (Anthropic) | claude-sonnet-4-6 | Nuanced draft generation (complex replies, professional correspondence) | Already configured as comms agent fallback. Reserved for emails that need careful tone, complex reasoning, or multi-paragraph replies. Budget-capped at $30/month. At ~$15/M output tokens, that is ~2M output tokens/month -- enough for ~40-60 substantive draft generations. Use sparingly: only when Gemini's draft quality is insufficient. | HIGH |
| **Gmail Drafts API** | v1 (`users.drafts.create`) | Create actual Gmail drafts | Drafts are created as real Gmail drafts, not Telegram text previews. User edits in Gmail's native interface with full formatting tools. Costs 10 quota units per draft. Telegram notification links to the draft. This is the correct UX: triage in Telegram, compose in Gmail. | HIGH |

### Notification & Delivery

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| **Telegram Bot API** | Current (via OpenClaw channel) | All user-facing notifications, digests, approval gates | Already configured and operational. OpenClaw's Telegram channel binding handles message delivery. Comms agent uses the same bot as all other agents. 4096-character message limit requires digest pagination for large batches. | HIGH |
| **Telegram inline keyboards** | Bot API feature | Approval buttons (Approve/Reject/Snooze) for draft and archive actions | One-tap approval in Telegram instead of typing "yes." Reduces friction for the ~10-20 daily approval actions. OpenClaw supports Telegram interactive elements through the bot framework. | MEDIUM |

### Infrastructure & Monitoring

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| **Sync state files (JSON)** | Custom | Per-account email sync state (historyId, lastCheck, errors) | Simple JSON files at `/sandbox/state/email-sync-personal.json` and `/sandbox/state/email-sync-work.json`. Persisted to disk on every successful sync. Read on every heartbeat. No database needed for 2 accounts. | HIGH |
| **Delegation queue (JSON)** | Custom | Track pending delegations, failed deliveries, retry state | `/sandbox/state/delegation-queue.json` tracks delegation requests with timeout, retry count, and dead-letter status. Comms agent checks queue on every heartbeat before processing new email. | HIGH |
| **Draft tracker (JSON)** | Custom | Track created drafts, prevent duplicates, enforce expiry | `/sandbox/state/draft-tracker.json` maps threadId -> draftId with timestamps. Prevents orphaned/duplicate drafts. Auto-cleanup after 24 hours. | HIGH |
| **OpenShell TUI** | Built-in (NemoClaw) | Real-time monitoring of sandbox activity, blocked requests | Already available. Use `openshell term` to monitor Gmail API calls, blocked egress attempts, and agent activity. Essential during development and debugging. | HIGH |

---

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| Gmail integration | gog CLI (OpenClaw built-in) | Himalaya (IMAP), raw googleapis, nodemailer | gog handles OAuth, multi-account, draft creation, labels. Why reinvent? |
| Email sync | history.list polling | Gmail Pub/Sub push | Sandbox cannot receive inbound webhooks; push adds GCP complexity |
| Classification model | Gemini 3 Flash (few-shot) | Fine-tuned model, Claude for classification | Gemini free tier covers classification volume; fine-tuning premature |
| Classification technique | Structured JSON output + few-shot | Free-text classification, regex parsing | Structured output guarantees parseable responses; few-shot beats fine-tuned BERT |
| Local pre-filter | ollama/qwen2.5:7b | None (send everything to Gemini) | Local pre-filter saves cloud quota on obvious spam |
| Agent delegation | sessions_spawn (async) | sessions_send (sync), custom HTTP | Spawn is non-blocking, isolated, auto-announces results back |
| Memory system | OpenClaw markdown + embeddings | SQLite, external DB, Redis | Markdown is OpenClaw-native, human-readable, git-backupable |
| Draft creation | Gmail Drafts API | Telegram preview text, email via SMTP | Gmail drafts let user edit with full formatting tools |
| Notification | Telegram (existing) | Email digest, web dashboard, SMS | Telegram is already the sole channel; adding another is anti-pattern |
| State management | JSON files on disk | SQLite, Redis, PostgreSQL | Two accounts, simple state. JSON files are adequate. No DB infra to maintain. |

---

## OAuth2 Configuration (Two Accounts)

### Google Cloud Console Setup

One GCP project serves both accounts. Both accounts authorize through the same OAuth client.

**Required APIs to enable:**
- Gmail API
- Google Calendar API (for RSVP conflict checks)

**OAuth consent screen:**
- User type: External (personal Gmail accounts cannot use Internal)
- Publishing status: **Production** (NOT Testing -- Testing mode causes 7-day token expiry)
- Scopes requested:
  ```
  https://www.googleapis.com/auth/gmail.readonly
  https://www.googleapis.com/auth/gmail.compose
  https://www.googleapis.com/auth/gmail.labels
  https://www.googleapis.com/auth/calendar.readonly
  ```

**OAuth credentials:**
- Type: Desktop app (not Web -- agent runs headless after initial auth)
- Download `client_secret.json` -> store at `/sandbox/config/client_secret.json`

**Per-account authorization:**
```bash
# Account 1: Personal
gog auth credentials /sandbox/config/client_secret.json
gog auth add personal@gmail.com --services gmail,calendar

# Account 2: Work
gog auth add work@company.com --services gmail,calendar

# Verify
gog auth list
```

**Token storage:**
- gog stores tokens internally (typically `~/.config/gog/`)
- For direct API usage, store refresh tokens in `~/.openclaw/.env`:
  ```
  GMAIL_PERSONAL_REFRESH_TOKEN=...
  GMAIL_WORK_REFRESH_TOKEN=...
  GOOGLE_CLIENT_ID=...
  GOOGLE_CLIENT_SECRET=...
  ```

**Scope caveat:** `gmail.compose` grants both draft creation AND send capability. The "never auto-send" constraint is enforced at the application level (comms agent SOUL.md + approval gate), not the OAuth scope level. There is no "drafts only, no send" scope in the Gmail API.

---

## OpenClaw Configuration Additions

### Comms Agent Config Update (openclaw.json5)

```json5
"comms": {
  "displayName": "Comms",
  "model": "google/gemini-3-flash",
  "fallback": ["anthropic/claude-sonnet-4-6"],
  "soul": "agents/comms/SOUL.md",
  "skills": ["gmail", "google-calendar"],  // gog skill handles both
  "heartbeat": {
    "enabled": true,
    "schedule": [
      // Business hours: every 10 minutes (Mon-Fri 7am-6pm Pacific)
      { "cron": "*/10 7-18 * * 1-5", "tz": "America/Los_Angeles", "task": "email-check" },
      // Evenings: every 30 minutes (6pm-11pm daily)
      { "cron": "*/30 18-23 * * *", "tz": "America/Los_Angeles", "task": "email-check" },
      // Overnight: every 3 hours (11pm-7am daily)
      { "cron": "0 23,2,5 * * *", "tz": "America/Los_Angeles", "task": "email-check" }
    ],
    "model": "ollama/qwen2.5:7b"  // Gate check uses local model
  },
  "tools": {
    "agentToAgent": {
      "enabled": true,
      "allow": ["dev", "research", "productivity", "home", "main"]
    }
  }
}
```

### Egress Policy Update (openclaw-sandbox.yaml)

No changes needed. The existing egress policy already allows all required endpoints:
- `www.googleapis.com:443` -- Gmail API, Calendar API
- `oauth2.googleapis.com:443` -- Token refresh
- `accounts.google.com:443` -- OAuth flows
- `api.telegram.org:443` -- Notifications
- `generativelanguage.googleapis.com:443` -- Gemini classification
- `api.anthropic.com:443` -- Claude draft fallback
- `api.openai.com:443` -- Embeddings for memory search
- `127.0.0.1:11434` -- Ollama for heartbeat gate checks

If gmail.googleapis.com is ever used directly (instead of www.googleapis.com), add it to the egress allowlist.

---

## Gmail API Quota Budget

Designed for 2 accounts, 50 emails/day average, 10-minute business-hour polling.

| Operation | Quota Units | Frequency | Daily Units |
|-----------|-------------|-----------|-------------|
| `history.list` (per account) | 2 | ~100 polls/day (2 accounts) | 200 |
| `messages.get` (metadata) | 5 | ~50 new messages/day | 250 |
| `messages.get` (full, for drafts) | 5 | ~15 draft-worthy/day | 75 |
| `drafts.create` | 10 | ~10 drafts/day | 100 |
| `labels.list` (cached) | 1 | 2/day (startup per account) | 2 |
| `messages.modify` (archive) | 5 | ~10 archives/day | 50 |
| `getProfile` (canary check) | 1 | ~100/day (every poll) | 100 |
| **Daily total** | | | **~777** |

Gmail API allows 15,000 units/minute per user and 1,200,000 units/minute per project. At 777 units/day, we use 0.065% of the per-project daily capacity. No quota concerns.

---

## Gemini API Budget

Designed for 50 emails/day classification + 10 routine drafts + 3 nuanced drafts.

| Operation | Tokens | Count/Day | Daily Tokens |
|-----------|--------|-----------|--------------|
| Classification (metadata + few-shot + response) | ~1,200 | 40 (after local pre-filter) | ~48,000 |
| Routine draft generation | ~800 | 10 | ~8,000 |
| Digest formatting | ~500 | 3 | ~1,500 |
| **Daily Gemini total** | | | **~57,500** |

Gemini free tier: even at the reduced 250 RPD floor, 53 requests/day (40 classify + 10 draft + 3 digest) is well within limits. Token budget is ~57K/day = ~1.7M/month, well within free tier token allowances.

**Claude budget for nuanced drafts:**
- ~3 drafts/day x ~2,000 output tokens = 6,000 output tokens/day
- Monthly: ~180K output tokens = ~$2.70/month (well under $30 cap)

---

## Installation & Setup Sequence

```bash
# Step 1: Verify existing stack (already deployed)
openclaw --version          # Confirm OpenClaw running
node --version              # Confirm Node.js 22+
ollama list                 # Confirm qwen2.5:7b available

# Step 2: Configure gog CLI for Gmail (one-time setup)
# Download client_secret.json from GCP Console first
gog auth credentials /path/to/client_secret.json
gog auth add personal@gmail.com --services gmail,calendar
gog auth add work@company.com --services gmail,calendar
gog auth list  # Verify both accounts

# Step 3: Test Gmail API access
GOG_ACCOUNT=personal@gmail.com gog gmail search "newer_than:1d" --max 5 --json
GOG_ACCOUNT=work@company.com gog gmail search "newer_than:1d" --max 5 --json

# Step 4: Test draft creation
GOG_ACCOUNT=personal@gmail.com gog gmail drafts create \
  --to test@example.com --subject "Test Draft" --body "Testing draft creation"

# Step 5: Install googleapis for direct API access (custom skill code)
cd ~/.openclaw/workspace
npm install @googleapis/gmail@16.1.1 google-auth-library@10.6.2

# Step 6: Initialize sync state files
mkdir -p /sandbox/state
echo '{"account":"personal","historyId":"","lastCheckTimestamp":"","consecutiveErrors":0}' \
  > /sandbox/state/email-sync-personal.json
echo '{"account":"work","historyId":"","lastCheckTimestamp":"","consecutiveErrors":0}' \
  > /sandbox/state/email-sync-work.json

# Step 7: Initialize memory structure
mkdir -p /sandbox/comms-workspace/memory/email-patterns/personal
mkdir -p /sandbox/comms-workspace/memory/email-patterns/work

# Step 8: Update openclaw.json5 with heartbeat + agentToAgent config
# (Manual edit -- see config additions above)

# Step 9: Restart OpenClaw gateway
openclaw restart
```

---

## Version Verification Notes

| Package | Claimed Version | Verification Method | Verified? |
|---------|----------------|---------------------|-----------|
| googleapis | 171.4.0 | npm registry (published ~Jan 2026) | YES -- WebSearch confirmed |
| @googleapis/gmail | 16.1.1 | npm registry (published ~Jan 2026) | YES -- WebSearch confirmed |
| google-auth-library | 10.6.2 | npm registry (published ~Mar 2026) | YES -- WebSearch confirmed |
| OpenClaw | 2026.2.x | GitHub releases | YES -- WebSearch confirmed 2026.2.17 |
| Gemini 3 Flash | gemini-3-flash | Google AI Studio | YES -- WebSearch confirmed model available |
| Gemini structured output | JSON mode | Official Gemini API docs | YES -- Verified via official docs |
| gog CLI | Built into OpenClaw skills | OpenClaw skills registry | YES -- Verified via SKILL.md on GitHub |

---

## Sources

### Official Documentation (HIGH confidence)
- [Gmail API Usage Limits](https://developers.google.com/workspace/gmail/api/reference/quota) -- quota units per method
- [Gmail API users.watch](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users/watch) -- push notification setup
- [Google OAuth2 for Server Apps](https://developers.google.com/identity/protocols/oauth2/service-account) -- service account vs user creds
- [Using OAuth 2.0 to Access Google APIs](https://developers.google.com/identity/protocols/oauth2) -- general OAuth2 guide
- [Gemini Structured Output](https://ai.google.dev/gemini-api/docs/structured-output) -- JSON mode and response schemas
- [Gemini 3 Developer Guide](https://ai.google.dev/gemini-api/docs/gemini-3) -- model capabilities
- [OpenClaw Skills Documentation](https://docs.openclaw.ai/tools/skills) -- SKILL.md structure, tool integration
- [OpenClaw Multi-Agent Routing](https://docs.openclaw.ai/concepts/multi-agent) -- agent delegation, session tools
- [OpenClaw Session Tools](https://docs.openclaw.ai/concepts/session-tool) -- sessions_spawn, sessions_send
- [OpenClaw Cron vs Heartbeat](https://docs.openclaw.ai/automation/cron-vs-heartbeat) -- scheduling patterns
- [OpenClaw Memory Overview](https://docs.openclaw.ai/concepts/memory) -- markdown memory, search, compaction

### npm Registry (HIGH confidence)
- [googleapis 171.4.0](https://www.npmjs.com/package/googleapis)
- [@googleapis/gmail 16.1.1](https://www.npmjs.com/package/@googleapis/gmail)
- [google-auth-library 10.6.2](https://www.npmjs.com/package/google-auth-library)

### OpenClaw GitHub (HIGH confidence)
- [gog SKILL.md](https://github.com/openclaw/openclaw/blob/main/skills/gog/SKILL.md) -- Gmail/Calendar CLI commands
- [OpenClaw subagents.md](https://github.com/openclaw/openclaw/blob/main/docs/tools/subagents.md) -- sub-agent delegation
- [NemoClaw network-policies.md](https://github.com/NVIDIA/NemoClaw/blob/main/docs/reference/network-policies.md) -- egress policy

### Verified Third-Party (MEDIUM confidence)
- [OpenClaw Gmail Integration Guide](https://lumadock.com/tutorials/openclaw-gmail-integration-email-automation) -- gog vs Himalaya comparison
- [Connect OpenClaw to Gmail (AgentMail)](https://www.agentmail.to/blog/connect-openclaw-to-gmail) -- multi-account setup
- [OpenClaw Agent Orchestration](https://openclawsetup.info/en/blog/openclaw-agent-orchestration-how-agents-delegate) -- delegation patterns
- [Heartbeats: Cheap Checks First](https://dev.to/damogallagher/heartbeats-in-openclaw-cheap-checks-first-models-only-when-you-need-them-4bfi) -- two-tier polling pattern
- [LLM Classification: Prompt Engineering vs Fine-Tuning](https://dextralabs.com/blog/prompt-engineering-vs-fine-tuning/) -- few-shot sufficiency evidence
- [Improving Structured Outputs (Google Blog)](https://blog.google/technology/developers/gemini-api-structured-outputs/) -- JSON mode guidance

---
*Stack research for: ClawBot Email Triage Agent (comms agent)*
*Researched: 2026-03-31*
