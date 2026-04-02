# Phase 2: Classification & Delivery - Research

**Researched:** 2026-04-02
**Domain:** Email classification (Gemini structured output), local spam pre-filter (Ollama), Telegram digest delivery
**Confidence:** HIGH

## Summary

Phase 2 builds on the Gmail polling foundation from Phase 1 to classify every incoming email into 7 categories using a two-stage pipeline (local Ollama spam gate followed by Gemini structured JSON classification) and deliver results via formatted Telegram digests with smart batching. The technical stack is well-defined: `@google/genai` SDK for Gemini structured output, Ollama REST API with JSON schema for local spam filtering, and OpenClaw's existing Telegram channel for digest delivery.

The primary risk is Gemini free tier rate limits. Current free tier for Flash models allows only 250 RPD (requests per day) and 10 RPM. With batch classification (5 emails per request per D-05), processing 50 emails/day requires only ~10 Gemini requests for classification plus a few for digests, which fits comfortably. However, the 10 RPM limit means classification bursts must be throttled. The local Ollama spam gate (D-04) is critical for staying within quota by filtering obvious spam before it reaches Gemini.

**Primary recommendation:** Implement the two-stage pipeline as a single OpenClaw custom skill that hooks into the existing heartbeat flow. Use `@google/genai` (v1.48.0) for Gemini structured output with JSON Schema enforcement, and Ollama's `/api/chat` endpoint with schema-based structured output for the local spam gate.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Three confidence tiers: >0.85 auto-label, 0.70-0.84 act-and-confirm (silent confirm if ignored), <0.70 ask user (shown with '?' marker and best guess)
- **D-02:** Urgent emails ALWAYS trigger immediate standalone Telegram notification regardless of confidence score
- **D-03:** Mid-confidence (0.70-0.84) items ignored by user are treated as implicitly confirmed
- **D-04:** Two-stage pipeline: local ollama/qwen2.5:7b binary spam gate first, only non-spam to Gemini
- **D-05:** Gemini classifies in batches of 5 emails per prompt call (metadata only: sender, subject, snippet)
- **D-06:** Few-shot examples in static, manually curated classification-examples.json (2-3 per category, 14-21 total)
- **D-07:** Chain-of-thought reasoning logged for debugging; shown in Telegram only for low-confidence (<0.70) items
- **D-08:** "Unknown" = first-time sender never seen in account's email history, via sender cache from history.list
- **D-09:** Unknown senders flagged with visual marker but appear normally with classification
- **D-10:** Sender caches separate per account (personal and work)
- **D-11:** Claude's discretion on digest layout, grouping, numbered selection UX, message splitting

### Claude's Discretion
- Digest layout, grouping strategy, numbered selection UX, and message splitting for long batches
- Must satisfy TGRAM-01 through TGRAM-06

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CLASS-01 | Classify into 7 categories: code, calendar, research, home, urgent, routine, spam/noise | Gemini structured output with responseSchema enforces exact category enum; Ollama handles spam pre-filter |
| CLASS-02 | Use Gemini structured JSON output with chain-of-thought reasoning | `@google/genai` SDK supports `responseMimeType: "application/json"` + `responseSchema`; CoT via explicit reasoning field in schema |
| CLASS-03 | Multi-label support with confidence scores per label | JSON Schema response defines array of {category, confidence} pairs; Gemini returns all applicable labels |
| CLASS-04 | Confidence thresholds: >0.85 auto-act, 0.70-0.84 act-and-confirm, <0.70 ask user | Application logic in classification skill; no special API support needed |
| CLASS-05 | Batch classification 5-10 emails per prompt | Single Gemini request with 5 email metadata items in prompt; response schema returns array of 5 classification results |
| CLASS-06 | Few-shot examples file with 14-21 labeled examples | Static JSON file loaded at classification time; injected into system prompt |
| CLASS-07 | Classification accuracy exceeds 80% on 50-email test set | Test harness runs classification against labeled dataset; measures per-category precision/recall |
| TGRAM-01 | Telegram digest grouped by account and priority | Digest formatter groups by account (personal/work) then sorts by priority within each group |
| TGRAM-02 | Each item shows sender, subject, category, recommended action | Digest template includes all fields from classification result |
| TGRAM-03 | Smart batching: urgent immediate, low-priority every 3 hours | Urgent items bypass batch queue and send immediately; low-priority accumulate in batch buffer |
| TGRAM-04 | User replies with number to act on specific email | Numbered list in digest; reply handler maps number to email threadId |
| TGRAM-05 | Unknown senders flagged for review | Sender cache lookup; missing = unknown; visual marker in digest |
| TGRAM-06 | Digest respects Telegram 4096-char limit | Message splitter breaks digest at logical boundaries (between email entries, not mid-entry) |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@google/genai` | 1.48.0 | Gemini API structured output for email classification | Current actively maintained Google Gen AI SDK for Node.js. Replaces deprecated `@google/generative-ai`. Supports `responseMimeType` + `responseSchema` for guaranteed JSON output. |
| `@googleapis/gmail` | 16.1.1 | Gmail API for message metadata retrieval | Already installed from Phase 1. Used for `messages.get` (metadata format) to feed classifier. |
| `google-auth-library` | 10.6.2 | OAuth2 token management | Already installed from Phase 1. Handles token refresh for Gmail API calls. |

### Supporting
| Library | Purpose | When to Use |
|---------|---------|-------------|
| Ollama REST API (`localhost:11434`) | Local spam pre-filter via qwen2.5:7b | Every heartbeat poll -- binary spam/not-spam before Gemini |
| OpenClaw Telegram channel | Digest delivery, user interaction | All notification output |
| OpenClaw heartbeat/cron | Scheduling classification runs | Existing infrastructure from Phase 1 |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `@google/genai` | `@google/generative-ai` (v0.24.1) | Older SDK, deprecated June 2026. Use `@google/genai` instead. |
| Ollama structured output | Skip local pre-filter, send all to Gemini | Wastes Gemini quota on obvious spam. Ollama is free and fast locally. |
| Batch of 5 per request | Individual email classification | 5x more Gemini API calls, hits 250 RPD free tier limit faster. |

**Installation:**
```bash
npm install @google/genai
```
Note: `@googleapis/gmail` and `google-auth-library` already installed from Phase 1.

## Architecture Patterns

### Recommended Project Structure
```
sandbox/
  state/
    email-sync-personal.json    # (Phase 1) historyId tracking
    email-sync-work.json        # (Phase 1) historyId tracking
    sender-cache-personal.json  # NEW: known senders for personal account
    sender-cache-work.json      # NEW: known senders for work account
    batch-buffer.json           # NEW: low-priority emails awaiting digest
    token-personal.json         # (Phase 1) OAuth tokens
    token-work.json             # (Phase 1) OAuth tokens
config/
  classification-examples.json  # NEW: few-shot examples (14-21 entries)
  classification-schema.json    # NEW: Gemini response schema definition
```

### Pattern 1: Two-Stage Classification Pipeline
**What:** Every new email passes through local Ollama binary spam gate, then non-spam emails are batched (up to 5) and sent to Gemini for full 7-category classification with structured JSON output.
**When to use:** Every heartbeat cycle that detects new emails.
**Flow:**
```
Heartbeat detects new emails (history.list)
  -> Fetch metadata (messages.get, format: metadata)
  -> Stage 1: Ollama spam gate (binary: spam/not-spam)
     - Spam -> log + skip (do NOT auto-archive; Phase 4)
     - Not spam -> add to classification batch
  -> Stage 2: Gemini batch classification (5 emails per request)
     - Structured JSON response with categories + confidence
  -> Post-classification:
     - Check sender cache -> flag unknowns
     - Route by urgency:
       - Urgent (any confidence) -> immediate Telegram notification
       - Others -> add to batch buffer
  -> Batch buffer check:
     - If buffer age >= 3 hours -> format and send digest
     - If manual digest request -> format and send
```

### Pattern 2: Gemini Structured Output with JSON Schema
**What:** Force Gemini to return classification results matching an exact JSON Schema.
**Example:**
```javascript
// Using @google/genai SDK
const { GoogleGenAI } = require("@google/genai");

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const classificationSchema = {
  type: "object",
  properties: {
    classifications: {
      type: "array",
      items: {
        type: "object",
        properties: {
          email_index: { type: "integer" },
          categories: {
            type: "array",
            items: {
              type: "object",
              properties: {
                category: {
                  type: "string",
                  enum: ["code", "calendar", "research", "home", "urgent", "routine", "spam_noise"]
                },
                confidence: { type: "number" }
              },
              required: ["category", "confidence"]
            }
          },
          reasoning: { type: "string" },
          recommended_action: { type: "string" },
          is_urgent: { type: "boolean" }
        },
        required: ["email_index", "categories", "reasoning", "recommended_action", "is_urgent"]
      }
    }
  },
  required: ["classifications"]
};

const response = await ai.models.generateContent({
  model: "gemini-3-flash",
  contents: classificationPrompt,
  config: {
    responseMimeType: "application/json",
    responseSchema: classificationSchema
  }
});

const result = JSON.parse(response.text);
```

### Pattern 3: Ollama Structured Spam Gate
**What:** Use Ollama's JSON schema support for binary spam classification.
**Example:**
```javascript
// Ollama /api/chat with structured output
const response = await fetch("http://127.0.0.1:11434/api/chat", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    model: "qwen2.5:7b",
    messages: [{
      role: "system",
      content: "You are a spam detector. Classify the email as spam or not_spam based on sender and subject."
    }, {
      role: "user",
      content: `Sender: ${sender}\nSubject: ${subject}\nSnippet: ${snippet}`
    }],
    stream: false,
    format: {
      type: "object",
      properties: {
        is_spam: { type: "boolean" },
        reason: { type: "string" }
      },
      required: ["is_spam"]
    }
  })
});

const result = await response.json();
const classification = JSON.parse(result.message.content);
```

### Pattern 4: Telegram Digest Formatting
**What:** Format classification results as numbered Telegram messages with account grouping.
**Example:**
```
*PERSONAL* (3 new)

1. [URGENT] john@example.com
   "Server down alert"
   -> Immediate action needed
2. [Calendar] jane@example.com
   "Meeting tomorrow 3pm"
   -> RSVP needed
3. [Routine] newsletter@tech.com
   "Weekly digest"
   -> Read later

*WORK* (2 new)

4. [Code] github@noreply.com
   "PR #42 review requested"
   -> Review PR
5. [Research] arxiv@cornell.edu - NEW SENDER
   "New paper: LLM agents"
   ? -> Check sender, read abstract
   _Reasoning: First-time sender, academic domain, subject matches research category_

_Reply with a number to act on that email._
```

### Anti-Patterns to Avoid
- **Classifying one email per Gemini request:** Wastes RPD quota. Always batch up to 5 per D-05.
- **Sending full email body to Gemini:** Only metadata (sender, subject, snippet) per D-05. Body is unnecessary for classification and wastes tokens.
- **Storing email content in memory:** Violates AGENTS.md privacy rule. Store only classification patterns and sender metadata.
- **Auto-archiving spam without user approval:** Phase 2 only classifies and flags. Auto-archive is Phase 4 (SPAM-03).
- **Using `@google/generative-ai`:** Deprecated SDK, end-of-life June 2026. Use `@google/genai` instead.
- **Using Claude/Anthropic for classification:** Gemini is the workhorse per model strategy. Claude is reserved for nuanced draft generation (Phase 3).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| JSON schema enforcement | Regex parsing of free-text LLM output | Gemini `responseSchema` + `responseMimeType: "application/json"` | Gemini guarantees valid JSON matching schema. Regex parsing is fragile. |
| Local spam detection | Custom rule-based spam filter | Ollama qwen2.5:7b with structured output | LLM handles novel spam patterns; rules only catch known patterns |
| Telegram message splitting | Manual string slicing at 4096 chars | Split at logical boundaries (between email entries) | Mid-entry splits break formatting and numbered selection |
| OAuth token refresh | Manual token lifecycle management | `google-auth-library` auto-refresh | Library handles refresh transparently; manual refresh is error-prone |
| Sender history lookup | Full Gmail search for each sender | In-memory sender cache built from history.list | Cache is O(1) lookup; Gmail search costs quota and latency |

## Common Pitfalls

### Pitfall 1: Gemini Free Tier Rate Limits
**What goes wrong:** Hitting 250 RPD or 10 RPM limit causes 429 errors and missed classifications.
**Why it happens:** Free tier for Gemini Flash is 250 RPD / 10 RPM / 250K TPM. Even with batching, bursts of new email (e.g., morning inbox) can exhaust RPM.
**How to avoid:** (1) Batch 5 emails per request (D-05) to minimize request count. (2) Add 6+ second delay between Gemini calls to stay under 10 RPM. (3) Ollama spam gate filters obvious spam before Gemini. (4) If hitting limits, queue classification for next heartbeat cycle rather than retrying immediately.
**Warning signs:** 429 responses from Gemini API; classification delays during high-volume periods.

### Pitfall 2: Ollama Model Not Loaded / Cold Start
**What goes wrong:** First Ollama request after idle period takes 10-30 seconds as qwen2.5:7b loads into GPU memory.
**Why it happens:** Ollama unloads idle models after ~5 minutes by default.
**How to avoid:** (1) Accept cold start latency on first heartbeat poll. (2) Optionally set `OLLAMA_KEEP_ALIVE` environment variable to extend model retention. (3) Do not treat slow first response as an error.
**Warning signs:** First classification per heartbeat cycle is significantly slower than subsequent ones.

### Pitfall 3: Telegram 4096 Character Limit
**What goes wrong:** Digest message gets truncated or API returns error for oversized messages.
**Why it happens:** 50 emails with full metadata easily exceeds 4096 UTF-8 characters.
**How to avoid:** (1) Calculate message length before sending. (2) Split at logical boundaries (between email entries, not mid-entry). (3) Keep numbering continuous across split messages. (4) Add "continued..." indicator on split messages.
**Warning signs:** Telegram API 400 errors; truncated digests.

### Pitfall 4: Sender Cache Grows Unbounded
**What goes wrong:** sender-cache-{account}.json grows indefinitely as new senders are seen.
**Why it happens:** Every unique sender email address is stored permanently.
**How to avoid:** (1) Store only sender email + first-seen timestamp + count. (2) Implement periodic cleanup of senders not seen in 90+ days. (3) Cap at ~10K entries with LRU eviction.
**Warning signs:** State file grows to several MB; JSON parse time increases.

### Pitfall 5: history.list 404 After Long Idle
**What goes wrong:** Stored historyId expires (Gmail retains ~30 days), causing 404 on history.list.
**Why it happens:** If system is offline for extended period, historyId becomes stale.
**How to avoid:** Phase 1 already handles this -- fallback to full sync on 404. Classification skill must handle the fallback gracefully (larger batch of emails to classify after full sync).
**Warning signs:** 404 response from history.list; sudden burst of "new" emails.

### Pitfall 6: Batch Size Mismatch Between Prompt and Response
**What goes wrong:** Gemini returns fewer or more classification entries than emails in the batch.
**Why it happens:** Despite structured output, the model might merge similar emails or skip some.
**How to avoid:** (1) Include explicit `email_index` field in schema (0-4 for batch of 5). (2) Validate response array length matches input batch size. (3) If mismatch, re-classify missing emails individually as fallback.
**Warning signs:** Classification count != email batch count; orphaned emails with no classification.

### Pitfall 7: MarkdownV2 Escaping in Telegram
**What goes wrong:** Special characters in email subjects break Telegram MarkdownV2 formatting.
**Why it happens:** MarkdownV2 requires escaping of many characters: `_`, `*`, `[`, `]`, `(`, `)`, `~`, `` ` ``, `>`, `#`, `+`, `-`, `=`, `|`, `{`, `}`, `.`, `!`.
**How to avoid:** (1) Use HTML parse mode instead of MarkdownV2 (simpler escaping). (2) Or sanitize all user-sourced strings (sender, subject) before inserting into template.
**Warning signs:** Telegram API rejects messages; formatting looks broken.

## Code Examples

### Classification Prompt Template
```javascript
// Few-shot prompt for batch classification
function buildClassificationPrompt(emails, fewShotExamples) {
  const systemPrompt = `You are an email classifier for a personal assistant.
Classify each email into one or more categories with confidence scores.

Categories: code, calendar, research, home, urgent, routine, spam_noise

Rules:
- Each email can have multiple categories (multi-label)
- Confidence is 0.0 to 1.0 for each category
- "urgent" can co-occur with any other category
- Include chain-of-thought reasoning for each classification
- Recommend an action for each email

Examples:
${JSON.stringify(fewShotExamples, null, 2)}`;

  const userPrompt = `Classify these ${emails.length} emails:

${emails.map((e, i) => `Email ${i}:
  Sender: ${e.sender}
  Subject: ${e.subject}
  Snippet: ${e.snippet}`).join("\n\n")}`;

  return { systemPrompt, userPrompt };
}
```

### Sender Cache Structure
```javascript
// sender-cache-{account}.json
{
  "senders": {
    "john@example.com": { "first_seen": "2026-04-01T10:00:00Z", "count": 15 },
    "newsletter@tech.com": { "first_seen": "2026-03-15T08:00:00Z", "count": 45 }
  },
  "last_updated": "2026-04-02T10:00:00Z"
}

// Check if sender is unknown
function isUnknownSender(senderEmail, senderCache) {
  return !senderCache.senders[senderEmail];
}

// Update cache after processing
function updateSenderCache(senderEmail, senderCache) {
  if (senderCache.senders[senderEmail]) {
    senderCache.senders[senderEmail].count++;
  } else {
    senderCache.senders[senderEmail] = {
      first_seen: new Date().toISOString(),
      count: 1
    };
  }
  senderCache.last_updated = new Date().toISOString();
}
```

### Batch Buffer for Smart Batching (TGRAM-03)
```javascript
// batch-buffer.json structure
{
  "personal": {
    "emails": [
      {
        "threadId": "abc123",
        "messageId": "msg456",
        "sender": "john@example.com",
        "subject": "Weekly report",
        "classification": { /* classification result */ },
        "is_unknown_sender": false,
        "received_at": "2026-04-02T10:30:00Z"
      }
    ],
    "last_digest_sent": "2026-04-02T09:00:00Z"
  },
  "work": {
    "emails": [],
    "last_digest_sent": "2026-04-02T09:00:00Z"
  }
}

// Decide whether to send digest
function shouldSendDigest(buffer, account) {
  const lastSent = new Date(buffer[account].last_digest_sent);
  const hoursSinceLast = (Date.now() - lastSent.getTime()) / (1000 * 60 * 60);
  return buffer[account].emails.length > 0 && hoursSinceLast >= 3;
}
```

### Digest Message Formatter
```javascript
// Format digest respecting 4096-char Telegram limit
// Uses HTML parse_mode to avoid MarkdownV2 escaping issues
function formatDigest(classifiedEmails, account) {
  const MAX_MSG_LENGTH = 4000; // Leave margin for safety
  const messages = [];
  let current = `<b>${account.toUpperCase()}</b> (${classifiedEmails.length} new)\n\n`;

  classifiedEmails.forEach((email, i) => {
    const globalIndex = i + 1;
    const urgentTag = email.classification.is_urgent ? " URGENT" : "";
    const unknownTag = email.is_unknown_sender ? "\n   NEW SENDER" : "";
    const topCategory = email.classification.categories[0];
    const confidenceMarker = topCategory.confidence < 0.70 ? "? " : "";

    let entry = `${globalIndex}. [${topCategory.category.toUpperCase()}${urgentTag}] ${escapeHtml(email.sender)}\n`;
    entry += `   "${escapeHtml(email.subject)}"\n`;
    entry += `   ${confidenceMarker}-> ${escapeHtml(email.classification.recommended_action)}`;
    if (unknownTag) entry += unknownTag;
    if (topCategory.confidence < 0.70 && email.classification.reasoning) {
      entry += `\n   <i>Reasoning: ${escapeHtml(email.classification.reasoning)}</i>`;
    }
    entry += "\n\n";

    if ((current + entry).length > MAX_MSG_LENGTH) {
      current += "<i>continued...</i>";
      messages.push(current);
      current = `<b>${account.toUpperCase()}</b> (continued)\n\n`;
    }
    current += entry;
  });

  if (classifiedEmails.length > 0) {
    current += "<i>Reply with a number to act on that email.</i>";
    messages.push(current);
  }

  return messages;
}

function escapeHtml(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
```

### Digest-to-Email Mapping (for TGRAM-04 reply handling)
```javascript
// Store mapping when digest is sent
// digest-map.json — keyed by Telegram message ID
{
  "telegram_msg_12345": {
    "sent_at": "2026-04-02T12:00:00Z",
    "mapping": {
      "1": { "threadId": "t1", "messageId": "m1", "account": "personal" },
      "2": { "threadId": "t2", "messageId": "m2", "account": "personal" },
      "3": { "threadId": "t3", "messageId": "m3", "account": "work" }
    }
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `@google/generative-ai` SDK | `@google/genai` SDK (v1.48.0) | 2025-2026 | Old SDK deprecated June 2026. New SDK has same API surface plus Vertex AI support. |
| Free-text classification + regex | Structured JSON output with schema | 2024-2025 | Eliminates parsing errors; guarantees valid JSON response matching schema. |
| Individual email classification | Batch classification (5+ per request) | Best practice | Critical for staying within free tier RPD limits (250/day). |
| Fine-tuned BERT for classification | Few-shot prompting with LLMs | 2024-2025 | 32 few-shot examples match fine-tuned BERT; no training infrastructure needed. |

**Deprecated/outdated:**
- `@google/generative-ai` npm package: Deprecated, end-of-life June 2026. Migrate to `@google/genai`.
- Gemini `generateContent` without schema: Still works but structured output is strictly better for classification.

## Open Questions

1. **Exact Gemini 3 Flash free tier RPD**
   - What we know: Gemini 2.5 Flash free tier is 250 RPD / 10 RPM. Gemini 3 Flash limits are project-specific and must be checked in AI Studio.
   - What's unclear: Whether gemini-3-flash has the same, better, or worse limits than 2.5 Flash on free tier.
   - Recommendation: Check actual limits in AI Studio at implementation time. Design for 250 RPD as worst case. With batching of 5, that allows classifying ~1250 emails/day which is more than sufficient.

2. **OpenClaw Telegram reply handler for numbered selection (TGRAM-04)**
   - What we know: OpenClaw's Telegram channel binding delivers messages. User can reply.
   - What's unclear: Exact mechanism for routing a reply like "3" back to the comms agent's session with context about which digest it refers to.
   - Recommendation: Store digest-to-email mapping in state file keyed by Telegram message ID. When user replies, look up the mapping to resolve which email they selected.

3. **Ollama qwen2.5:7b spam detection accuracy**
   - What we know: qwen2.5:7b runs locally on GTX 1070 Ti. Handles simple binary classification.
   - What's unclear: How accurately it distinguishes spam from legitimate marketing, newsletters, etc.
   - Recommendation: Keep the spam gate intentionally conservative -- only flag obvious spam (phishing, clearly automated junk). Let Gemini handle ambiguous cases. False negatives (spam reaching Gemini) are acceptable; false positives (legitimate email marked spam) are not.

## Project Constraints (from CLAUDE.md)

- **No auto-send**: Every outbound email requires explicit Telegram approval
- **Account separation**: Personal and work email data never cross without permission
- **Model budget**: Anthropic capped at $30/month -- use Gemini for bulk classification
- **Heartbeat model**: Email polling pings use ollama/qwen2.5:7b locally, not cloud
- **Sandbox egress**: All API calls must go through allowlisted endpoints
- **No self-modification**: Comms agent cannot edit its own config, auth, or SOUL.md
- **GPU limitation**: 2x GTX 1070 Ti -- only qwen2.5:7b quantized locally
- **Keys in .env only**: Never in openclaw.json or git
- **Gemini is workhorse**: 70-80% of requests; free tier
- **Codex for code tasks only**: Never for classification
- **Heartbeats on Ollama only**: Never burn cloud quota on polling pings

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Runtime | Yes (Phase 1) | 22+ | -- |
| `@googleapis/gmail` | Email metadata fetch | Yes (Phase 1) | 16.1.1 | -- |
| `google-auth-library` | OAuth token mgmt | Yes (Phase 1) | 10.6.2 | -- |
| `@google/genai` | Gemini structured output | No (needs install) | 1.48.0 | -- |
| Ollama | Local spam pre-filter | Yes (Phase 1 setup) | -- | Skip spam gate, send all to Gemini |
| qwen2.5:7b model | Ollama spam gate | Needs verification | -- | Pull model: `ollama pull qwen2.5:7b` |
| Gemini API key | Classification | Needs .env entry | -- | Cannot proceed without key |
| OpenClaw Telegram channel | Digest delivery | Yes (Phase 1) | -- | -- |
| `generativelanguage.googleapis.com` egress | Gemini API calls | Needs verification in sandbox config | -- | Add to openclaw-sandbox.yaml |

**Missing dependencies with no fallback:**
- `@google/genai` npm package (install required)
- Gemini API key in .env (must be configured)

**Missing dependencies with fallback:**
- Ollama qwen2.5:7b model (pull if not present; fallback: skip spam gate)
- `generativelanguage.googleapis.com` egress rule (add if missing; CLAUDE.md says it should be allowlisted)

## Sources

### Primary (HIGH confidence)
- [Gemini Structured Output docs](https://ai.google.dev/gemini-api/docs/structured-output) - JSON mode, responseSchema, responseMimeType
- [Ollama Structured Outputs docs](https://docs.ollama.com/capabilities/structured-outputs) - JSON schema in format field
- [Ollama API reference](https://github.com/ollama/ollama/blob/main/docs/api.md) - /api/chat endpoint, stream:false
- [@google/genai npm](https://www.npmjs.com/package/@google/genai) - v1.48.0, current active SDK
- [Telegram Bot API](https://core.telegram.org/bots/api) - sendMessage, parse_mode, 4096 char limit
- [@google/generative-ai deprecation](https://ai.google.dev/gemini-api/docs/migrate) - Migration guide to @google/genai

### Secondary (MEDIUM confidence)
- [Gemini API Rate Limits Guide](https://blog.laozhang.ai/en/posts/gemini-api-rate-limits-guide) - Free tier: 250 RPD, 10 RPM for Flash models
- [Gemini API Free Tier analysis](https://blog.laozhang.ai/en/posts/gemini-api-free-tier) - Flash model 250 RPD (reduced from earlier quotas)
- [Google Blog: Structured Outputs](https://blog.google/innovation-and-ai/technology/developers-tools/gemini-api-structured-outputs/) - JSON Schema support, key ordering

### Tertiary (LOW confidence)
- Gemini 3 Flash specific rate limits -- Google now directs to AI Studio for project-specific limits; no public table for 3-series models

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - `@google/genai` v1.48.0 verified via npm registry; Ollama structured output verified via official docs
- Architecture: HIGH - Two-stage pipeline defined by locked decisions (D-04, D-05); patterns are straightforward Node.js
- Pitfalls: HIGH - Rate limits verified via multiple sources; Telegram limits well-documented; Ollama cold start is known behavior

**Research date:** 2026-04-02
**Valid until:** 2026-05-02 (30 days -- Gemini rate limits may change; check AI Studio)
