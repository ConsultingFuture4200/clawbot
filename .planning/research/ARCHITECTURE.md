# Architecture Patterns: Email Triage Agent

**Domain:** Email triage + classification within a multi-agent AI system (OpenClaw)
**Researched:** 2026-03-31
**Overall confidence:** HIGH

---

## Recommended Architecture

The email triage system is structured as five distinct components connected through OpenClaw's existing agent infrastructure. The comms agent remains the orchestrator for all email operations, with heartbeat-driven polling, a classification pipeline, delegation to sibling agents, and a learning memory store.

```
                    +-----------------------+
                    |   Gmail API (2 accts) |
                    |  personal  |  work    |
                    +------+----+----+------+
                           |         |
                    (OAuth2 per account)
                           |         |
                    +------v---------v------+
                    |   Email Poller        |
                    |   (Heartbeat-driven)  |
                    |   Ollama: gate check  |
                    |   Gemini: fetch+parse |
                    +-----------+-----------+
                                |
                    +-----------v-----------+
                    |  Classification       |
                    |  Pipeline             |
                    |  (Gemini few-shot)    |
                    |                       |
                    |  7 categories         |
                    |  multi-label          |
                    |  confidence scores    |
                    +-----------+-----------+
                                |
              +-----------------+------------------+
              |                 |                   |
    +---------v------+  +------v-------+  +--------v--------+
    | Action Router  |  | Digest       |  | Learning Memory |
    | (Delegation)   |  | Builder      |  | (Embeddings +   |
    |                |  | (Telegram)   |  |  pattern file)  |
    | comms->dev     |  |              |  |                 |
    | comms->research|  | grouped by:  |  | MEMORY.md       |
    | comms->home    |  |  account     |  | patterns/*.md   |
    | comms->prod    |  |  priority    |  | vector index    |
    +-------+--------+  +------+-------+  +-----------------+
            |                  |
    +-------v--------+  +-----v--------+
    | Draft Engine   |  | Telegram     |
    | (Gmail Drafts  |  | Delivery     |
    |  API)          |  | (approval    |
    |                |  |  gates)      |
    | gemini: routine|  |              |
    | claude: nuanced|  +--------------+
    +----------------+
```

### Component Boundaries

| Component | Responsibility | Communicates With | Model |
|-----------|---------------|-------------------|-------|
| **Email Poller** | Detects new emails, fetches content, maintains sync state | Gmail API, Classification Pipeline | ollama/qwen2.5:7b (gate), gemini-3-flash (fetch) |
| **Classification Pipeline** | Categorizes emails into 7 categories with confidence scores | Poller (input), Router + Digest + Memory (output) | gemini-3-flash |
| **Action Router** | Delegates actionable emails to appropriate sibling agents | Classification (input), dev/research/prod/home agents (delegation) | gemini-3-flash (via comms agent) |
| **Digest Builder** | Groups classified emails into Telegram-friendly summaries | Classification (input), Telegram (output) | gemini-3-flash |
| **Draft Engine** | Generates reply drafts and creates them via Gmail Drafts API | Classification (input), Gmail API (output), Telegram (approval) | gemini-3-flash (routine), claude-sonnet-4-6 (nuanced) |
| **Learning Memory** | Stores classification patterns, user corrections, contact prefs | Classification (read/write), Embeddings API (indexing) | text-embedding-3-small (indexing), file I/O (storage) |

---

## Data Flow

### 1. Email Ingestion Flow

```
Heartbeat tick (ollama)
  -> "Any new email?" (cheap gate check: script-level, not LLM)
  -> IF new historyId detected:
       -> Gmail API history.list(startHistoryId) per account
       -> Fetch new message metadata (messages.get, format=METADATA)
       -> For actionable messages, fetch full content (format=FULL)
  -> Pass to Classification Pipeline
```

**Key design decision: Hybrid polling, not Pub/Sub.** Gmail Pub/Sub push requires either a public HTTPS endpoint (incompatible with NemoClaw sandbox behind WSL2/Docker) or a GCP pull subscription (adds GCP project dependency and Cloud Pub/Sub cost). Instead, use Gmail API's `history.list` with stored `historyId` for incremental sync, triggered by the heartbeat scheduler. This gives near-real-time detection without exposing endpoints.

**Polling frequency is priority-aware:**
- Urgent window (business hours): heartbeat every 10-15 minutes
- Normal window (evenings): heartbeat every 30-60 minutes
- Quiet window (night): heartbeat every 3 hours or suspended

### 2. Classification Flow

```
Raw email (sender, subject, body snippet, labels, headers)
  -> Few-shot prompt with 7 categories + examples
  -> Gemini structured output: {
       categories: ["code", "calendar"],  // multi-label
       primary: "code",
       confidence: 0.92,
       priority: "high",
       reasoning: "GitHub PR review request with deadline"
     }
  -> IF confidence < threshold (0.7):
       -> Check Learning Memory for similar patterns
       -> IF match found: boost confidence, apply learned label
       -> IF no match: flag for user confirmation, store result after
```

### 3. Delegation Flow

```
Classified email with category
  -> Action Router maps category to agent:
       code      -> dev agent (via subagent delegation)
       calendar  -> productivity agent
       research  -> research agent
       home      -> home agent
       urgent    -> main agent (escalation) + Telegram alert
       routine   -> Draft Engine (auto-draft "got it" style)
       spam      -> Digest Builder (batch for bulk approval)
  -> Delegation uses OpenClaw subagent.delegate() pattern
  -> Delegated agent receives: email summary, category, priority, action needed
  -> Result flows back to comms agent -> Telegram notification
```

### 4. Draft Generation Flow

```
Email requiring response
  -> Template match? (receipts, confirmations, RSVPs)
       -> YES: fill template, create Gmail draft via drafts.create
       -> NO: AI-generated draft
            -> Routine/simple: gemini-3-flash
            -> Nuanced/complex: claude-sonnet-4-6 (fallback model)
  -> Draft created as actual Gmail draft (not Telegram text)
  -> Telegram notification: "[Account] Draft ready for [Subject] - review in Gmail"
  -> User approves/edits in Gmail, sends manually
```

### 5. Learning Loop Flow

```
User corrects a classification via Telegram
  -> Store correction in memory/email-patterns/YYYY-MM-DD.md
  -> Embed the email (subject + snippet) via text-embedding-3-small
  -> Store embedding + correct label in vector index
  -> On future emails: similarity search against pattern store
  -> High-similarity matches override or boost LLM classification
```

---

## Patterns to Follow

### Pattern 1: Two-Tier Heartbeat (Cheap Check First)

**What:** Separate the "is there anything new?" check from the "classify and process" step. The heartbeat's gate check uses a script-level comparison (stored historyId vs current), not an LLM call. Only when new emails exist does the system invoke Gemini for classification.

**When:** Every heartbeat tick.

**Why:** At 30-minute intervals, 48 heartbeats/day. If each invokes Gemini, that is ~72K-144K tokens/day just for "nothing new" responses. The cheap-check-first pattern reduces this to near-zero for quiet periods.

**Implementation:**
```
HEARTBEAT.md (comms agent):
---
## Email Check
- Read /sandbox/state/email-sync.json for last historyId per account
- Call Gmail API users.history.list with startHistoryId
- IF no new history records: HEARTBEAT_OK (silent, no LLM cost)
- IF new records found: fetch messages, run classification pipeline
- Update email-sync.json with latest historyId
```

**Configuration:**
```json
// In openclaw.json5, comms agent heartbeat
"heartbeat": {
  "enabled": true,
  "schedule": [
    { "cron": "*/10 7-18 * * 1-5", "tz": "America/Los_Angeles", "task": "email-check" },
    { "cron": "*/30 18-23 * * *", "tz": "America/Los_Angeles", "task": "email-check" },
    { "cron": "0 */3 0-6 * * *", "tz": "America/Los_Angeles", "task": "email-check" }
  ],
  "model": "ollama/qwen2.5:7b",
  "isolatedSession": true,
  "lightContext": true
}
```

### Pattern 2: Structured Classification Output

**What:** Force the LLM to return JSON with explicit fields rather than free-text classification. Include a `reasoning` field for chain-of-thought before the classification, improving accuracy.

**When:** Every email classification.

**Example prompt structure:**
```
You are an email classifier. Analyze the email below and return JSON.

Categories (may assign multiple):
- code: GitHub notifications, PRs, CI/CD, technical discussions
- calendar: Meeting invites, RSVPs, scheduling
- research: Articles, newsletters, research requests
- home: Smart home, deliveries, utilities, household
- urgent: Time-sensitive, requires immediate attention
- routine: Receipts, confirmations, acknowledgments
- spam: Marketing, promotions, irrelevant

Examples:
[2-3 few-shot examples per category from memory/email-patterns/examples.md]

Email:
From: {sender}
Subject: {subject}
Snippet: {first_500_chars}
Labels: {gmail_labels}

Return:
{
  "categories": ["primary", "secondary"],
  "primary_category": "string",
  "confidence": 0.0-1.0,
  "priority": "high|medium|low",
  "reasoning": "step-by-step justification",
  "suggested_action": "delegate_dev|delegate_prod|draft_reply|archive|digest"
}
```

### Pattern 3: Account Isolation via Separate Sync State

**What:** Maintain completely separate sync state, memory, and digest sections for personal vs work accounts. Never cross-contaminate data between accounts.

**When:** All operations.

**Implementation:**
```
/sandbox/state/
  email-sync-personal.json   # { historyId, lastCheck, watchExpiry }
  email-sync-work.json       # { historyId, lastCheck, watchExpiry }

memory/email-patterns/
  personal/                   # patterns learned from personal email
  work/                       # patterns learned from work email
  examples.md                 # shared few-shot examples (generic)
```

### Pattern 4: Delegation via OpenClaw SubAgent with Context Minimization

**What:** When routing an email to a sibling agent (e.g., code email to dev agent), delegate with a minimal context package -- not the full email, just enough for the target agent to act.

**When:** Any cross-agent delegation.

**Implementation:**
```
Delegation payload to dev agent:
{
  "task": "Review PR notification and summarize for user",
  "context": {
    "from": "github-noreply@github.com",
    "subject": "PR #42: Fix auth middleware",
    "repo": "user/project",
    "pr_number": 42,
    "email_snippet": "first 200 chars",
    "priority": "medium"
  },
  "respond_to": "comms"  // results flow back to comms for Telegram delivery
}
```

The dev agent uses its own GitHub skills to fetch the actual PR details rather than relying on email content, producing a richer summary.

### Pattern 5: Gmail Draft as Source of Truth

**What:** All reply drafts are created as actual Gmail drafts via `users.drafts.create`, not as Telegram message previews. Telegram only receives a notification that a draft exists.

**When:** Any response generation.

**Why:** Gmail drafts preserve formatting, allow user editing with full Gmail UI, and prevent the "copy-paste from Telegram to email" antipattern. The user's workflow becomes: see Telegram notification -> open Gmail -> review/edit draft -> send.

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Pub/Sub Push for a Sandboxed Local System

**What:** Setting up Google Cloud Pub/Sub with push subscriptions for real-time email notifications.

**Why bad:** Requires a publicly reachable HTTPS endpoint, which conflicts with NemoClaw's sandboxed, firewalled architecture. Even pull subscriptions add GCP project complexity and cost for marginal latency improvement over polling.

**Instead:** Use heartbeat-driven `history.list` polling. With 10-minute intervals during business hours, worst-case email detection latency is 10 minutes -- acceptable for a personal assistant.

### Anti-Pattern 2: Full Email Body in Classification Prompt

**What:** Sending the entire email body (potentially thousands of tokens) to the classification LLM.

**Why bad:** Burns Gemini free tier quota unnecessarily. Most classification can be done from sender, subject, first 500 characters, and Gmail labels. Full body parsing should only happen for draft generation, not classification.

**Instead:** Use metadata + snippet for classification. Fetch full body only when generating a reply draft.

### Anti-Pattern 3: Storing Email Content in Long-Term Memory

**What:** Persisting full email bodies in MEMORY.md or memory/*.md files.

**Why bad:** Violates AGENTS.md privacy rules. Email content is ephemeral context, not durable knowledge. Also bloats memory files, increasing token cost on every session bootstrap.

**Instead:** Store only classification patterns (sender -> category mappings), user corrections, and contact preferences. Never store email bodies.

### Anti-Pattern 4: LLM-Based Gate Check on Every Heartbeat

**What:** Using Gemini or any cloud LLM just to check "is there new email?"

**Why bad:** At 48+ heartbeats/day across 2 accounts, this wastes ~100K-200K tokens/day on a question that can be answered by a single API call comparing historyIds.

**Instead:** Script-level historyId comparison (current vs stored). Only invoke LLM when there are actual new messages to classify.

### Anti-Pattern 5: Auto-Archiving Without Explicit Approval Pattern

**What:** Automatically archiving emails classified as spam/noise without user confirmation.

**Why bad:** Violates the SOUL.md "never auto-send" principle extended to destructive inbox actions. Misclassification risk means important emails could be silently buried.

**Instead:** Batch spam/noise into a Telegram digest with "Approve archive all?" confirmation. Build trust over time; potentially relax to auto-archive for patterns confirmed 5+ times.

---

## Detailed Component Specifications

### Email Poller Component

**Sync State File (per account):**
```json
{
  "account": "personal",
  "historyId": "9876543210",
  "lastCheckTimestamp": "2026-03-31T14:30:00Z",
  "lastMessageId": "msg_abc123",
  "consecutiveErrors": 0,
  "fullSyncRequired": false
}
```

**Error Recovery:**
- HTTP 404 from history.list (expired historyId) -> trigger full sync: `messages.list` to get current state, store new historyId
- HTTP 429 (rate limit) -> exponential backoff (2s, 4s, 8s, max 5 min), report to Telegram if sustained
- OAuth token expiry -> OpenClaw's built-in token refresh handles this via `oauth2.googleapis.com`
- Consecutive errors > 3 -> alert user via Telegram, pause polling for that account

**Gmail API Quota Awareness:**
- Gmail API quota: 250 units/second per user (history.list = 2 units, messages.get = 5 units)
- At 10-minute polling with ~5-10 new messages/check: ~52 units/check, well within limits
- Full sync (initial or recovery): batch requests, max 100 messages per batch, throttle to stay under quota

### Classification Pipeline Component

**Category Definitions:**

| Category | Signals | Action |
|----------|---------|--------|
| `code` | GitHub domains, PR/issue keywords, CI notifications, technical terms | Delegate to dev agent |
| `calendar` | Calendar invite MIME type, scheduling keywords, RSVP | Delegate to productivity agent |
| `research` | Newsletter senders, article links, research-related subjects | Delegate to research agent |
| `home` | Smart home vendors, delivery tracking, utility companies | Delegate to home agent |
| `urgent` | Keywords (ASAP, urgent, deadline), known VIP senders, time-sensitive phrases | Escalate to main + immediate Telegram alert |
| `routine` | Receipts, order confirmations, shipping updates, automated acknowledgments | Auto-draft "got it" or template response |
| `spam` | Marketing domains, unsubscribe headers, promotional labels | Batch into digest for bulk archive approval |

**Multi-Label Resolution:**
When an email matches multiple categories (e.g., a GitHub calendar invite is both `code` and `calendar`), the primary category determines routing. Secondary categories are included in the Telegram notification for user awareness. Priority is: urgent > code > calendar > home > research > routine > spam.

**Confidence Threshold Strategy:**
- >= 0.85: Act on classification automatically
- 0.70 - 0.84: Act but flag in Telegram as "classified as X, correct?"
- < 0.70: Ask user via Telegram before acting, store correction in learning memory

### Action Router Component

**Delegation Mapping:**
```
Classification -> Agent   -> Skill Used        -> Expected Output
code           -> dev     -> github             -> PR summary, issue brief
calendar       -> prod    -> google-calendar    -> Conflict check, RSVP draft
research       -> research-> browser, file-ops  -> Topic brief
home           -> home    -> home-assistant     -> Status check, action suggestion
urgent         -> main    -> (orchestration)    -> Immediate Telegram alert
routine        -> comms   -> gmail (self)       -> Template draft
spam           -> comms   -> gmail (self)       -> Batch digest entry
```

**Queue Behavior for Unavailable Agents:**
When a target agent is unavailable (e.g., Ollama down for home agent), the comms agent:
1. Stores the delegation request in `/sandbox/state/delegation-queue.json`
2. Notifies user via Telegram: "Home agent unavailable, queued: [summary]"
3. Retries on next heartbeat (checks queue before new email)
4. After 3 failed retries, escalates to main agent

### Learning Memory Component

**Storage Layout:**
```
/sandbox/comms-workspace/
  memory/
    email-patterns/
      examples.md           # Few-shot examples (curated, ~20 total)
      personal/
        sender-patterns.md  # sender -> typical category mappings
        corrections.md      # user corrections with timestamps
      work/
        sender-patterns.md
        corrections.md
    MEMORY.md               # General comms preferences, contact prefs
```

**Pattern Storage Format (sender-patterns.md):**
```markdown
## Sender Patterns

| Sender Pattern | Primary Category | Confidence | Last Confirmed |
|---------------|-----------------|------------|----------------|
| *@github.com | code | 0.99 | 2026-03-30 |
| noreply@google.com (calendar) | calendar | 0.95 | 2026-03-29 |
| newsletter@* | research | 0.80 | 2026-03-28 |
```

**Embedding-Augmented Classification:**
For ambiguous emails where sender pattern matching fails:
1. Embed the email (subject + first 200 chars) via text-embedding-3-small
2. Search existing correction embeddings for similar past emails
3. If cosine similarity > 0.85 with a corrected email, apply that correction's label
4. This creates a "learned taste" that improves over time without explicit rule-writing

**Memory Budget:**
- sender-patterns.md: ~50-100 entries per account, grows slowly
- corrections.md: append-only, roll over monthly (keep last 3 months)
- Embedding index: ~500 entries before pruning old/low-value entries
- Total token cost for memory bootstrap: ~2K-4K tokens (acceptable with lightContext)

---

## Gmail API Integration Architecture

### OAuth2 Setup (Two Accounts)

Each Gmail account requires its own OAuth2 refresh token. Both use the same Google Cloud Console project but separate user authorizations.

**Required Scopes:**
```
https://www.googleapis.com/auth/gmail.readonly    # Read inbox, messages
https://www.googleapis.com/auth/gmail.compose      # Create drafts (note: also grants send)
https://www.googleapis.com/auth/gmail.labels       # Read/manage labels
https://www.googleapis.com/auth/calendar.readonly  # Calendar conflict checks for RSVPs
```

**Scope caveat:** `gmail.compose` grants both draft creation AND send capability. Since the system constraint requires Telegram approval before sending, the send capability must be gated at the application level (comms agent SOUL.md constraint), not the OAuth scope level. There is no Gmail API scope for "drafts only, no send."

**Token Storage:**
```
~/.openclaw/.env:
  GMAIL_PERSONAL_REFRESH_TOKEN=...
  GMAIL_WORK_REFRESH_TOKEN=...
  GOOGLE_CLIENT_ID=...
  GOOGLE_CLIENT_SECRET=...
```

### API Call Patterns

| Operation | Endpoint | Units | Frequency |
|-----------|----------|-------|-----------|
| Check for new mail | `history.list` | 2 | Every heartbeat |
| Fetch message metadata | `messages.get(format=METADATA)` | 5 | Per new message |
| Fetch full message | `messages.get(format=FULL)` | 5 | Only for draft generation |
| Create draft | `drafts.create` | 10 | Per reply needed |
| List labels | `labels.list` | 1 | Once at startup, cached |
| Modify labels (archive) | `messages.modify` | 5 | Per approved archive |

---

## Scalability Considerations

| Concern | At 10 emails/day | At 50 emails/day | At 200+ emails/day |
|---------|------------------|-------------------|---------------------|
| Classification tokens | ~15K/day (Gemini free) | ~75K/day (Gemini free) | ~300K/day (may hit free tier) |
| Heartbeat cost | ~2K tokens/day | ~2K tokens/day | ~2K tokens/day (unchanged) |
| Draft generation | ~5K tokens/day | ~25K tokens/day | ~100K tokens/day |
| Gmail API quota | ~100 units/day | ~500 units/day | ~2000 units/day (well under 250/sec) |
| Learning memory size | Negligible | ~200 patterns | ~500+ patterns (prune monthly) |
| Telegram notifications | 2-3/day | 5-10/day (use digests) | Digest-only (batch every 30min) |

At 200+ emails/day, switch from per-email Telegram notifications to batched digests to avoid notification fatigue. Classification should remain on Gemini free tier (1K requests/day limit = ~200 classify + fetch + draft cycles).

---

## Suggested Build Order

Dependencies flow top-down. Each layer requires the one above it.

```
Phase 1: Gmail OAuth + Polling Foundation
  |
  +-- Gmail OAuth2 for both accounts (prerequisite for everything)
  +-- Sync state management (historyId tracking)
  +-- Heartbeat configuration for comms agent
  +-- Basic email fetch (messages.list, messages.get)
  |
Phase 2: Classification Pipeline
  |
  +-- 7-category classifier prompt with structured output
  +-- Multi-label support
  +-- Confidence scoring
  +-- Few-shot examples file (memory/email-patterns/examples.md)
  |
Phase 3: Telegram Delivery + Digests
  |
  +-- Per-email Telegram notifications (grouped by account + priority)
  +-- Spam/noise digest builder
  +-- Bulk approval workflow for noise
  |
Phase 4: Draft Engine
  |
  +-- Template drafts (routine acknowledgments, RSVP)
  +-- AI-generated drafts (Gemini for routine, Claude for nuanced)
  +-- Gmail Drafts API integration (drafts.create)
  +-- Telegram approval notification
  |
Phase 5: Agent Delegation
  |
  +-- @mention / subagent delegation to dev, research, prod, home
  +-- Delegation queue for unavailable agents
  +-- Result aggregation back to comms
  |
Phase 6: Learning Memory
  |
  +-- User correction storage (patterns/*.md)
  +-- Sender-pattern matching
  +-- Embedding-based similarity for ambiguous emails
  +-- Confidence boosting from historical patterns
```

**Build order rationale:**
- **Phase 1 first** because nothing works without Gmail API access and email data
- **Phase 2 before Phase 3** because digests need classified emails to group
- **Phase 3 before Phase 4** because drafts need the user to see what emails exist (via Telegram) before deciding which need replies
- **Phase 4 before Phase 5** because self-contained drafting (comms agent alone) is simpler and more testable than cross-agent delegation
- **Phase 5 before Phase 6** because delegation patterns reveal which classifications need learning (the user corrections from Phase 5 feed Phase 6)
- **Phase 6 last** because the system works without learning (just less accurately); learning is an optimization, not a requirement

---

## Sources

- [Gmail API Push Notifications Guide](https://developers.google.com/workspace/gmail/api/guides/push) - HIGH confidence
- [Gmail API Sync Guide](https://developers.google.com/workspace/gmail/api/guides/sync) - HIGH confidence
- [Gmail API Scopes](https://developers.google.com/workspace/gmail/api/auth/scopes) - HIGH confidence
- [Gmail API users.drafts.create](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.drafts/create) - HIGH confidence
- [OpenClaw Heartbeat Documentation](https://docs.openclaw.ai/gateway/heartbeat) - HIGH confidence
- [OpenClaw Multi-Agent Routing](https://docs.openclaw.ai/concepts/multi-agent) - HIGH confidence
- [OpenClaw Memory Overview](https://docs.openclaw.ai/concepts/memory) - HIGH confidence
- [LangChain Email Assistant Architecture](https://deepwiki.com/langchain-ai/agents-from-scratch/2-email-assistant-core-architecture) - MEDIUM confidence
- [OpenClaw Heartbeat Proactive Pattern](https://openclawsetup.info/en/blog/openclaw-heartbeat-proactive-agents) - MEDIUM confidence
- [Cheap Checks First Pattern](https://dev.to/damogallagher/heartbeats-in-openclaw-cheap-checks-first-models-only-when-you-need-them-4bfi) - MEDIUM confidence
- [LLM Classification Best Practices](https://www.nyckel.com/blog/llms-for-classification-best-practices-and-benchmarks/) - MEDIUM confidence
