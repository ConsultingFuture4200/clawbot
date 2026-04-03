# Phase 3: Drafts & Delegation - Research

**Researched:** 2026-04-02
**Domain:** Gmail Draft API, OpenClaw inter-agent delegation, Telegram inline keyboards
**Confidence:** MEDIUM (delegation subsystem has known OpenClaw bugs requiring workarounds)

## Summary

Phase 3 adds the action layer to the email triage pipeline: draft generation (Gmail Drafts API) and inter-agent delegation (OpenClaw `sessions_spawn`). The existing Phase 2 pipeline (`handleNewEmails` -> spam gate -> classify -> deliver) needs a new stage inserted after classification that routes emails to either draft generation or delegation based on category.

Draft creation is straightforward -- the Gmail API `users.drafts.create` endpoint is well-documented and the project already has `@googleapis/gmail` and `google-auth-library` installed. The main complexity is MIME message construction with proper `In-Reply-To` / `References` headers for threaded replies, and base64url encoding.

Delegation via OpenClaw `sessions_spawn` has significant caveats. There is a known bug (#5813) where `agentToAgent.enabled: true` breaks `sessions_spawn` -- sub-agents appear but never execute. The workaround is adding the spawning agent (comms) to its own `agentToAgent.allow` list. Additionally, a regression in 2026.3.12 (#45868) causes workspace resolution from the parent instead of the target agent; the fix is merged but may not be in the deployed version (project uses 2026.2.x). The planner must verify the deployed OpenClaw version and apply workarounds as needed.

**Primary recommendation:** Build draft generation as a standalone module (`draft-generator.js`) and delegation as a separate module (`delegator.js`), both hooking into `processClassifiedEmails()` in `delivery.js`. Use the existing `telegramSendFn` callback pattern for notifications. Draft-tracker and delegation-queue JSON state files follow the established `sandbox/state/` pattern.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Category-driven draft routing -- email classification category determines draft type and model (routine->Gemini ack, calendar->Gemini RSVP, code/research/home->delegated, urgent->Claude smart draft + delegate to main, spam_noise->nothing)
- **D-02:** Selective drafting -- only emails that need a reply get drafts. Code/research/home emails are delegated, not drafted. Spam gets nothing.
- **D-03:** Auto-create Gmail drafts immediately on classification for routine acks and calendar RSVPs
- **D-04:** Claude smart drafts auto-created only for `urgent` emails. All other categories require user to explicitly request smart draft via Telegram.
- **D-05:** Gemini handles routine acks, template replies, and calendar RSVPs. Claude (claude-sonnet-4-6) handles smart drafts for urgent and on-demand. ~2-3 auto smart drafts/day from urgent emails.
- **D-06:** Always use `sessions_spawn` (async, non-blocking) for all delegations
- **D-07:** Delegation routing map: code->dev, calendar->productivity, research->research, home->home, urgent->main
- **D-08:** Context packaging: metadata + classification only (sender, subject, snippet, classification result, confidence, recommended action). Target agent fetches full email body via Gmail API if needed.
- **D-09:** Queue + notify when target agent unavailable. Item goes into `delegation-queue.json` with retry counter. Max 3 retries, then dead-letter with user notification.
- **D-10:** 2-hour follow-up timeout for delegated items. If no result after 2 hours, Telegram nudge.
- **D-11:** `agentToAgent` must be enabled in comms agent config with allow list: `["dev", "research", "productivity", "home", "main"]`
- **D-12:** Inline keyboards for draft approval -- Approve / Edit in Gmail / Quick Edit / Discard buttons
- **D-13:** Both edit options: "Edit in Gmail" (deep link) and "Quick edit" (user replies in Telegram, comms updates draft)
- **D-14:** Urgent drafts get separate immediate Telegram messages. Routine/calendar drafts bundle into next periodic digest.
- **D-15:** Snooze option with preset times (1hr / 3hr / tomorrow)
- **D-16:** Drafts created immediately on classification -- proactive
- **D-17:** 48-hour TTL for unclaimed drafts. Auto-deleted from Gmail after 48 hours. Telegram cleanup notification.
- **D-18:** One draft per thread -- `draft-tracker.json` checks threadId before creating. If draft exists, update existing draft.
- **D-19:** Calendar RSVP logic: auto-check Google Calendar for conflicts. Conflict -> suggest decline. Free -> suggest accept.

### Claude's Discretion
- Draft text tone and formatting within SOUL.md constraints ("match formality of recipient")
- Template library structure and specific template patterns
- Delegation message formatting for target agents
- Error handling for Gmail draft creation failures
- Draft update strategy when new emails arrive in same thread (update existing vs. regenerate)

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DRAFT-01 | Comms agent drafts routine acknowledgments ("thanks, got it") | Gmail Drafts API `users.drafts.create`, Gemini generates draft text, MIME encoding pattern |
| DRAFT-02 | Comms agent drafts template replies using predefined patterns | Template library in `sandbox/config/draft-templates.json`, Gemini fills variables |
| DRAFT-03 | Comms agent generates AI-powered smart drafts using Claude for contextual replies | Anthropic `claude-sonnet-4-6` API call, budget-capped, urgent-only auto-trigger |
| DRAFT-04 | Comms agent drafts calendar RSVP responses based on calendar conflicts | Google Calendar `freebusy.query` API, `calendar.readonly` scope already authorized |
| DRAFT-05 | All drafts created as actual Gmail drafts via API (not Telegram-only) | `users.drafts.create` with base64url-encoded MIME message, threadId for threading |
| DRAFT-06 | No draft is sent without explicit user approval via Telegram | Telegram inline keyboard (Approve/Edit/Discard), callback_query handling |
| DRAFT-07 | Drafts clearly label which Gmail account they belong to | Account field in draft-tracker.json, account label in Telegram notification |
| DELEG-01 | Comms agent delegates via @mention syntax | `sessions_spawn` with `agentId` parameter, routing map from classification category |
| DELEG-02 | Code/PR emails route to dev agent with context | `sessions_spawn({ agentId: "dev", task: contextPackage })` |
| DELEG-03 | Calendar emails route to productivity agent | `sessions_spawn({ agentId: "productivity", task: contextPackage })` |
| DELEG-04 | Research/newsletter emails route to research agent | `sessions_spawn({ agentId: "research", task: contextPackage })` |
| DELEG-05 | Home/IoT alerts route to home agent | `sessions_spawn({ agentId: "home", task: contextPackage })` |
| DELEG-06 | Urgent items route to main agent | `sessions_spawn({ agentId: "main", task: contextPackage })` |
| DELEG-07 | Delegation queue holds items when agent unavailable, notifies user | `delegation-queue.json` with retry counter, max 3 retries, dead-letter |
| DELEG-08 | Agent results aggregate back through Telegram | `sessions_spawn` announce-back mechanism delivers to comms channel |
| DELEG-09 | Comms agent tracks delegated items, follows up on timeout | 2-hour follow-up check on heartbeat cycle, Telegram nudge notification |
</phase_requirements>

## Standard Stack

### Core (Already Installed)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@googleapis/gmail` | 16.1.1 | Gmail Drafts API (`users.drafts.create`, `users.drafts.update`, `users.drafts.delete`) | Already installed. Google's official standalone Gmail client. |
| `google-auth-library` | 10.6.2 | OAuth2 token management for multi-account draft creation | Already installed. Handles token refresh automatically. |
| `@google/genai` | (installed) | Gemini 3 Flash for routine draft text generation | Already used in `classifier.js`. Same client reused for draft generation. |
| OpenClaw `sessions_spawn` | Built-in (2026.2.x) | Async non-blocking inter-agent delegation | OpenClaw's native sub-agent tool. No npm install needed. |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Google Calendar API (via `googleapis`) | v3 | `freebusy.query` for RSVP conflict checking | When classifying calendar emails (DRAFT-04) |
| Telegram Bot API | Current | Inline keyboards for draft approval UX | All draft notifications (DRAFT-06) |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Raw MIME construction | `nodemailer` for MIME building | nodemailer adds dependency for one function; raw MIME is ~15 lines of code |
| `sessions_spawn` | HTTP calls to agent endpoints | Non-standard, breaks OpenClaw's session isolation and announce-back |
| JSON state files | SQLite | Over-engineered for 2-account state tracking |

**Installation:**
```bash
# No new packages needed -- all dependencies already installed
# Verify:
node -e "require('@googleapis/gmail'); console.log('gmail OK')"
node -e "require('google-auth-library'); console.log('auth OK')"
node -e "require('@google/genai'); console.log('genai OK')"
```

## Architecture Patterns

### Recommended Project Structure
```
sandbox/skills/classify-email/
  index.js              # Pipeline entry -- add draft/delegation stage
  classifier.js         # (existing) Gemini classification
  delivery.js           # (existing) Telegram delivery -- extend for draft notifications
  digest-formatter.js   # (existing) Format helpers -- extend for draft approval messages
  draft-generator.js    # NEW: Gmail draft creation + model routing
  delegator.js          # NEW: sessions_spawn routing + queue management
  draft-templates.js    # NEW: Template library for routine/template drafts
  types.js              # (existing) Constants -- add draft/delegation constants
  spam-gate.js          # (existing) Unchanged

sandbox/state/
  draft-tracker.json        # NEW: threadId -> draftId mapping with TTL
  delegation-queue.json     # NEW: pending delegations with retry state
  batch-buffer.json         # (existing) Unchanged
  digest-map.json           # (existing) Unchanged
  sender-cache-*.json       # (existing) Unchanged

sandbox/config/
  draft-templates.json      # NEW: Predefined reply templates per category
```

### Pattern 1: Pipeline Extension (Post-Classification Hook)

**What:** Insert draft generation and delegation as a parallel stage after classification, before/alongside Telegram delivery.

**When to use:** Every time `processClassifiedEmails` is called.

**Example:**
```javascript
// In delivery.js -- extend processClassifiedEmails
async function processClassifiedEmails(classifiedResults, telegramSendFn, gmailClient) {
  for (const email of classifiedResults.classified) {
    // Route based on category (D-01)
    const primaryCategory = email.categories[0].category;

    // Draft generation (routine, calendar, urgent)
    if (['routine', 'calendar'].includes(primaryCategory)) {
      await generateDraft(email, gmailClient);  // auto-create
    } else if (primaryCategory === 'urgent') {
      await generateSmartDraft(email, gmailClient);  // Claude
    }

    // Delegation (code, calendar, research, home, urgent)
    if (DELEGATION_CATEGORIES.includes(primaryCategory)) {
      await delegateToAgent(email);
    }

    // Telegram delivery (existing logic)
    if (email.delivery === 'immediate') {
      await sendUrgentNotification(email, telegramSendFn);
    } else {
      addToBatchBuffer(email);
    }
  }
}
```

### Pattern 2: Gmail Draft Creation with Threading

**What:** Create a Gmail draft as a reply to an existing thread with proper MIME headers.

**When to use:** Every draft creation (DRAFT-05).

**Example:**
```javascript
// Source: Gmail API docs + googleapis/google-api-nodejs-client#1938
function buildMimeMessage({ to, from, subject, body, inReplyTo, references }) {
  const headers = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
  ];
  if (inReplyTo) {
    headers.push(`In-Reply-To: ${inReplyTo}`);
    headers.push(`References: ${references || inReplyTo}`);
  }
  const message = headers.join('\r\n') + '\r\n\r\n' + body;
  return Buffer.from(message).toString('base64url');
}

async function createGmailDraft(gmail, auth, { threadId, raw, account }) {
  const response = await gmail.users.drafts.create({
    userId: 'me',
    auth: auth,  // per-account OAuth2Client
    requestBody: {
      message: {
        raw: raw,
        threadId: threadId  // thread the draft into the conversation
      }
    }
  });
  return response.data;  // { id: draftId, message: { id, threadId, labelIds } }
}
```

### Pattern 3: Delegation via sessions_spawn

**What:** Fire-and-forget delegation to sibling agents with context packaging.

**When to use:** Code, calendar, research, home, urgent emails (D-07).

**Example:**
```javascript
// Delegation context package (D-08: metadata + classification only)
function buildDelegationContext(classifiedEmail) {
  return {
    sender: classifiedEmail.sender,
    subject: classifiedEmail.subject,
    snippet: classifiedEmail.snippet,
    account: classifiedEmail.account,
    threadId: classifiedEmail.threadId,
    messageId: classifiedEmail.messageId,
    classification: {
      categories: classifiedEmail.categories,
      confidence: classifiedEmail.categories[0].confidence,
      reasoning: classifiedEmail.reasoning,
      recommended_action: classifiedEmail.recommended_action
    }
  };
}

// sessions_spawn call -- OpenClaw tool invocation
async function delegateToAgent(classifiedEmail) {
  const ROUTING_MAP = {
    code: 'dev',
    calendar: 'productivity',
    research: 'research',
    home: 'home',
    urgent: 'main'
  };

  const primaryCategory = classifiedEmail.categories[0].category;
  const agentId = ROUTING_MAP[primaryCategory];
  if (!agentId) return null;

  const context = buildDelegationContext(classifiedEmail);
  const task = `Email triage delegation:\n${JSON.stringify(context, null, 2)}\n\nPlease review and take appropriate action.`;

  // OpenClaw sessions_spawn (non-blocking)
  const result = await sessions_spawn({
    agentId: agentId,
    task: task,
    label: `email-${classifiedEmail.messageId}`,
    runTimeoutSeconds: 7200  // 2-hour timeout (D-10)
  });

  return result;  // { status: "accepted", runId, childSessionKey }
}
```

### Pattern 4: Telegram Inline Keyboard for Draft Approval

**What:** Attach approval buttons to draft notification messages.

**When to use:** Every draft notification (DRAFT-06).

**Example:**
```javascript
// Telegram inline keyboard structure
function buildDraftApprovalKeyboard(draftId, threadId, account) {
  return {
    inline_keyboard: [
      [
        { text: 'Approve & Send', callback_data: `draft_approve:${draftId}` },
        { text: 'Discard', callback_data: `draft_discard:${draftId}` }
      ],
      [
        { text: 'Edit in Gmail', url: `https://mail.google.com/mail/u/${account === 'work' ? '1' : '0'}/#drafts` },
        { text: 'Quick Edit', callback_data: `draft_edit:${draftId}` }
      ],
      [
        { text: 'Snooze 1hr', callback_data: `draft_snooze:${draftId}:3600` },
        { text: 'Snooze 3hr', callback_data: `draft_snooze:${draftId}:10800` },
        { text: 'Tomorrow', callback_data: `draft_snooze:${draftId}:tomorrow` }
      ]
    ]
  };
}
```

### Anti-Patterns to Avoid
- **Sending drafts without approval:** Every Gmail send MUST go through Telegram approval gate. The draft-generator creates drafts only; a separate approval handler converts draft to sent message.
- **Forwarding full email body to target agents:** D-08 mandates metadata + classification only. Target agents fetch the full body themselves via Gmail API if needed.
- **Using `sessions_send` for delegation:** D-06 locks all delegation to `sessions_spawn` (async). `sessions_send` is synchronous and blocks the comms agent.
- **Creating duplicate drafts:** Always check `draft-tracker.json` for existing threadId entry before creating (D-18).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| MIME message encoding | Custom email parser | Buffer.from(message).toString('base64url') | Node.js built-in, standard pattern |
| OAuth2 token refresh | Custom refresh logic | `google-auth-library` OAuth2Client auto-refresh | Already handles token lifecycle |
| Calendar conflict detection | Custom event comparison | Google Calendar `freebusy.query` API | Handles recurring events, all-day events, multi-calendar |
| Draft deduplication | In-memory tracking | `draft-tracker.json` with threadId key | Survives restarts, consistent with sandbox/state pattern |
| Sub-agent lifecycle | Custom process management | OpenClaw `sessions_spawn` with announce-back | Framework handles isolation, cleanup, result delivery |
| Telegram button handling | Custom message parsing | Telegram `callback_query` with `inline_keyboard` | Native API feature, no regex parsing needed |

**Key insight:** The Gmail API, Google Calendar API, and OpenClaw sub-agent tools handle all the complex state management. Custom code should only do routing logic and MIME construction.

## Common Pitfalls

### Pitfall 1: agentToAgent Breaks sessions_spawn (OpenClaw Bug #5813)
**What goes wrong:** Enabling `agentToAgent.enabled: true` causes sub-agents spawned via `sessions_spawn` to appear in session lists but never execute (stuck at 0 tokens).
**Why it happens:** Routing conflict between the agentToAgent tool and sessions_spawn in OpenClaw.
**How to avoid:** Add the spawning agent (comms) to its own `agentToAgent.allow` list:
```json
"agentToAgent": {
  "enabled": true,
  "allow": ["comms", "dev", "research", "productivity", "home", "main"]
}
```
Note: "comms" must be in its own allow list, not just the target agents.
**Warning signs:** Delegations return `{ status: "accepted" }` but target agent sessions show 0 tokens and no activity.
**Confidence:** HIGH (verified via GitHub issue #5813, workaround confirmed by multiple users)

### Pitfall 2: Workspace Resolution Regression (OpenClaw 2026.3.12)
**What goes wrong:** `sessions_spawn` resolves the target agent's workspace from the parent agent instead of the target, causing the spawned agent to load wrong `SOUL.md`.
**Why it happens:** Security fix in 2026.3.12 collapsed two resolution paths.
**How to avoid:** If upgrading past 2026.2.x, explicitly pass `cwd` parameter in `sessions_spawn` calls. OR stay on 2026.2.x where this regression does not exist.
**Warning signs:** Delegated agents respond with comms agent personality instead of their own.
**Confidence:** HIGH (verified via GitHub issue #45868, fix merged but may not be in stable release)

### Pitfall 3: Gmail Draft Threading Requires MIME Headers
**What goes wrong:** Drafts created without `In-Reply-To` and `References` headers appear as new conversations in Gmail, not threaded replies.
**Why it happens:** Gmail uses both threadId (API-level) AND MIME headers (display-level) for threading. Setting only threadId in the API call is not enough.
**How to avoid:** Always include `In-Reply-To: <original-message-id>` and `References: <original-message-id>` in the MIME headers. Fetch the original message's `Message-ID` header first.
**Warning signs:** Drafts appear in Gmail but not under the original email thread.
**Confidence:** HIGH (verified via googleapis/google-api-nodejs-client#1938)

### Pitfall 4: Telegram callback_data 64-byte Limit
**What goes wrong:** Telegram inline keyboard `callback_data` has a 64-byte limit. Long draft IDs or compound data exceeding this limit cause silent failures.
**Why it happens:** Telegram Bot API hard limit on callback_data field.
**How to avoid:** Use short action prefixes and abbreviated IDs. Store full context in `draft-tracker.json` and reference by short key. Format: `action:shortId` (e.g., `approve:abc123`).
**Warning signs:** Inline keyboard buttons stop working, no callback_query events received.
**Confidence:** HIGH (Telegram Bot API documented limit)

### Pitfall 5: Gmail Draft Quota Budget
**What goes wrong:** Each `drafts.create` costs 10 quota units, `drafts.update` costs 10 units, `drafts.delete` costs 10 units. At ~10 drafts/day + updates + deletes, quota consumption can spike.
**Why it happens:** Draft operations are quota-heavy relative to read operations (2-5 units).
**How to avoid:** Track daily quota usage. Use `drafts.update` (same cost) instead of delete+create when updating existing drafts. Batch draft cleanup during off-peak hours.
**Warning signs:** 429 rate limit errors during draft creation.
**Confidence:** HIGH (Gmail API quota documentation)

### Pitfall 6: OAuth2Client Per-Account Isolation
**What goes wrong:** Using a single OAuth2Client for both Gmail accounts creates a draft in the wrong account.
**Why it happens:** OAuth2Client carries credentials for one user. Mixing accounts means the last-authenticated user gets all drafts.
**How to avoid:** Maintain two separate OAuth2Client instances, one per account. Select based on `classifiedEmail.account` field. Token files already separated: `token-personal.json` and `token-work.json`.
**Warning signs:** Personal email drafts appearing in work account or vice versa.
**Confidence:** HIGH (established pattern from Phase 1 gmail-oauth-helper.cjs)

### Pitfall 7: Draft Expiry Race Condition
**What goes wrong:** 48-hour TTL cleanup deletes a draft the user is actively editing in Gmail.
**Why it happens:** TTL timer starts at creation, not last interaction.
**How to avoid:** Before deleting an expired draft, check if it was modified in Gmail (compare `draft.message.internalDate` or use `drafts.get` to check current state). If modified, extend TTL.
**Warning signs:** User reports losing a draft they were working on.
**Confidence:** MEDIUM (theoretical, but important to plan for)

## Code Examples

### Gmail Draft Creation (Complete)
```javascript
// Source: Gmail API official docs + googleapis npm
const { gmail_v1 } = require('@googleapis/gmail');
const { OAuth2Client } = require('google-auth-library');
const fs = require('fs');
const path = require('path');

const STATE_DIR = '/sandbox/state';

/**
 * Get authenticated Gmail client for a specific account.
 * Reuses token files from Phase 1 oauth helper.
 */
function getGmailClient(account) {
  const tokenPath = path.join(STATE_DIR, `token-${account}.json`);
  const secretPath = '/sandbox/config/client_secret.json';

  const secret = JSON.parse(fs.readFileSync(secretPath, 'utf8'));
  const creds = secret.installed || secret.web;
  const oauth2 = new OAuth2Client(creds.client_id, creds.client_secret);

  const tokens = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
  oauth2.setCredentials(tokens);

  return new gmail_v1.Gmail({ auth: oauth2 });
}

/**
 * Build base64url-encoded MIME message for a reply draft.
 */
function buildReplyMime({ to, from, subject, body, inReplyTo, references }) {
  const lines = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject.startsWith('Re:') ? subject : `Re: ${subject}`}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
  ];
  if (inReplyTo) {
    lines.push(`In-Reply-To: ${inReplyTo}`);
    lines.push(`References: ${references || inReplyTo}`);
  }
  const raw = lines.join('\r\n') + '\r\n\r\n' + body;
  return Buffer.from(raw).toString('base64url');
}

/**
 * Create a Gmail draft as a threaded reply.
 * Returns { draftId, messageId, threadId }.
 */
async function createDraft(account, { threadId, to, from, subject, body, inReplyTo }) {
  const gmail = getGmailClient(account);
  const raw = buildReplyMime({ to, from, subject, body, inReplyTo });

  const response = await gmail.users.drafts.create({
    userId: 'me',
    requestBody: {
      message: { raw, threadId }
    }
  });

  return {
    draftId: response.data.id,
    messageId: response.data.message.id,
    threadId: response.data.message.threadId
  };
}
```

### Google Calendar Conflict Check
```javascript
// Source: Google Calendar API freebusy.query docs
const { calendar_v3 } = require('googleapis').google.calendar;

/**
 * Check if user is free during a proposed event time.
 * Returns { isFree: boolean, conflicts: Array<{ start, end }> }.
 */
async function checkCalendarConflict(account, eventStart, eventEnd) {
  const auth = getOAuth2Client(account);  // reuse from gmail client
  const calendar = new calendar_v3.Calendar({ auth });

  const response = await calendar.freebusy.query({
    requestBody: {
      timeMin: eventStart,  // ISO 8601
      timeMax: eventEnd,    // ISO 8601
      timeZone: 'America/Los_Angeles',  // user's timezone
      items: [{ id: 'primary' }]
    }
  });

  const busy = response.data.calendars.primary.busy || [];
  return {
    isFree: busy.length === 0,
    conflicts: busy
  };
}
```

### Draft Tracker State Management
```javascript
// draft-tracker.json structure:
// {
//   "drafts": {
//     "<threadId>": {
//       "draftId": "<gmail-draft-id>",
//       "account": "personal" | "work",
//       "category": "routine" | "calendar" | "urgent",
//       "subject": "Re: ...",
//       "created_at": "2026-04-02T10:00:00Z",
//       "expires_at": "2026-04-04T10:00:00Z",
//       "status": "pending" | "approved" | "discarded" | "expired",
//       "snooze_until": null | "2026-04-02T13:00:00Z",
//       "telegram_msg_id": "12345"
//     }
//   }
// }

const DRAFT_TTL_HOURS = 48;  // D-17

function trackDraft(threadId, draftInfo) {
  const tracker = loadState(DRAFT_TRACKER_PATH);
  const now = new Date();
  const expires = new Date(now.getTime() + DRAFT_TTL_HOURS * 60 * 60 * 1000);

  tracker.drafts[threadId] = {
    ...draftInfo,
    created_at: now.toISOString(),
    expires_at: expires.toISOString(),
    status: 'pending',
    snooze_until: null
  };

  saveState(DRAFT_TRACKER_PATH, tracker);
}

function hasDraftForThread(threadId) {
  const tracker = loadState(DRAFT_TRACKER_PATH);
  const entry = tracker.drafts[threadId];
  return entry && entry.status === 'pending';
}
```

### Delegation Queue State Management
```javascript
// delegation-queue.json structure:
// {
//   "pending": [
//     {
//       "id": "deleg-<uuid>",
//       "messageId": "<gmail-message-id>",
//       "threadId": "<gmail-thread-id>",
//       "account": "personal" | "work",
//       "target_agent": "dev" | "research" | "productivity" | "home" | "main",
//       "context": { ... },
//       "delegated_at": "2026-04-02T10:00:00Z",
//       "runId": "<openclaw-run-id>",
//       "childSessionKey": "<session-key>",
//       "retry_count": 0,
//       "max_retries": 3,
//       "follow_up_at": "2026-04-02T12:00:00Z",
//       "status": "active" | "completed" | "failed" | "dead_letter"
//     }
//   ],
//   "dead_letter": []
// }

const MAX_RETRIES = 3;           // D-09
const FOLLOW_UP_HOURS = 2;       // D-10
const RETRY_DELAY_MINUTES = 15;  // D-09
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `sessions_send` (sync) | `sessions_spawn` (async) | OpenClaw 2026.1+ | Non-blocking delegation; comms agent not blocked waiting for dev/research |
| Plain text Telegram approval | Inline keyboards with callback_data | Telegram Bot API v7+ | One-tap approval instead of typing commands |
| Email send via SMTP | Gmail Drafts API -> user approves -> send | Gmail API v1 | Drafts editable in Gmail UI before sending |
| Flat prompt classification | Gemini structured JSON output | Gemini 2.0+ | Guaranteed parseable responses, no regex |

**Deprecated/outdated:**
- `sessions_send` for long-running tasks (blocks calling agent; use `sessions_spawn` instead)
- Plain text Telegram commands for approval (inferior UX to inline keyboards)

## Open Questions

1. **OpenClaw version on deployed system**
   - What we know: CLAUDE.md says 2026.2.x, STATE.md confirms this
   - What's unclear: Exact patch version; whether #45868 regression exists
   - Recommendation: Check version at task execution time. If >= 2026.3.12, add `cwd` workaround to `sessions_spawn` calls. If 2026.2.x, no workaround needed.

2. **Telegram inline keyboard support in OpenClaw's Telegram channel binding**
   - What we know: OpenClaw uses Telegram Bot API for messaging. Inline keyboards are a standard Bot API feature.
   - What's unclear: Whether OpenClaw's built-in Telegram channel passes `reply_markup` through to the Bot API, or if we need to use the raw Bot API directly.
   - Recommendation: Test with a simple inline keyboard message during implementation. If OpenClaw's channel does not support `reply_markup`, fall back to the raw Telegram Bot API `sendMessage` with `reply_markup` parameter.

3. **Original Message-ID header retrieval for draft threading**
   - What we know: `messages.get` with `format=metadata` and `metadataHeaders=Message-ID` returns the header. Current pipeline only stores sender, subject, snippet, threadId, messageId.
   - What's unclear: Whether adding a `messages.get` call per draft-worthy email is acceptable quota-wise.
   - Recommendation: Fetch `Message-ID` header lazily only when creating a draft (not for all classified emails). Cost: 5 quota units per draft-worthy email. At ~10 drafts/day = 50 extra units/day -- negligible.

4. **Callback query handler integration point**
   - What we know: Telegram `callback_query` events need a handler to process button clicks.
   - What's unclear: How OpenClaw routes callback_query events to the comms agent. May need a new skill or handler registration.
   - Recommendation: Research during implementation. Likely requires a `handleCallbackQuery` export from the classify-email skill that OpenClaw's Telegram channel binding invokes.

## Project Constraints (from CLAUDE.md)

- **No auto-send:** NEVER send an email without explicit user approval via Telegram (SOUL.md, AGENTS.md, PRD)
- **Account separation:** Personal and work email data never cross without permission
- **Model budget:** Anthropic capped at $30/month -- use Gemini for bulk, Claude only for urgent smart drafts
- **Heartbeat model:** Polling pings use ollama/qwen2.5:7b locally
- **Sandbox egress:** All API calls through allowlisted endpoints (already configured)
- **No self-modification:** Comms agent cannot edit own config, auth, or SOUL.md
- **GPU limitation:** 2x GTX 1070 Ti -- only qwen2.5:7b quantized locally
- **Keys in .env only:** Never in openclaw.json or git
- **Agents cannot modify their own config, auth, or SOUL.md**

## Sources

### Primary (HIGH confidence)
- [Gmail API users.drafts.create](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.drafts/create) -- draft creation endpoint, quota (10 units)
- [Gmail API draft creation guide](https://developers.google.com/workspace/gmail/api/guides/drafts) -- MIME encoding, threadId, RFC 2822 compliance
- [Google Calendar freebusy.query](https://developers.google.com/workspace/calendar/api/v3/reference/freebusy/query) -- conflict detection API
- [OpenClaw Sub-Agents docs](https://docs.openclaw.ai/tools/subagents) -- sessions_spawn parameters, return values, configuration
- [Telegram Bot API](https://core.telegram.org/bots/api) -- inline keyboards, callback_data, sendMessage reply_markup
- [googleapis/google-api-nodejs-client#1938](https://github.com/googleapis/google-api-nodejs-client/issues/1938) -- In-Reply-To/References header issue for draft threading

### Secondary (MEDIUM confidence)
- [OpenClaw Bug #5813](https://github.com/openclaw/openclaw/issues/5813) -- agentToAgent breaks sessions_spawn; workaround verified
- [OpenClaw Bug #45868](https://github.com/openclaw/openclaw/issues/45868) -- workspace resolution regression in 2026.3.12; fix merged
- [OpenClaw Multi-Agent Blog](https://blog.cdnsun.com/multi-agents-in-openclaw-sub-agents-and-telegram/) -- practical sub-agent setup patterns

### Tertiary (LOW confidence)
- Telegram inline keyboard in OpenClaw's channel binding -- not verified whether OpenClaw passes reply_markup through; needs testing during implementation

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries already installed and verified in Phase 1/2
- Architecture (drafts): HIGH -- Gmail Drafts API well-documented, established patterns
- Architecture (delegation): MEDIUM -- OpenClaw sessions_spawn has known bugs requiring workarounds
- Pitfalls: HIGH -- verified via GitHub issues and official docs

**Research date:** 2026-04-02
**Valid until:** 2026-04-16 (OpenClaw releasing rapidly; delegation bugs may get patched)
