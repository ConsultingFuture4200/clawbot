# Requirements: ClawBot Email Triage Agent

**Defined:** 2026-03-31
**Core Value:** Every email that needs attention surfaces in Telegram with the right classification and a draft response ready to approve — nothing falls through the cracks.

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Gmail Foundation

- [x] **GMAIL-01**: User can authenticate both Gmail accounts (personal + work) via OAuth2 with gmail.readonly, gmail.compose, calendar.readonly scopes
- [x] **GMAIL-02**: OAuth consent screen is set to Production mode to avoid 7-day token expiry
- [ ] **GMAIL-03**: Comms agent polls Gmail via `history.list` incremental sync with persisted historyId per account
- [x] **GMAIL-04**: Polling runs on heartbeat schedule with adaptive cadence (faster during business hours, slower nights/weekends)
- [x] **GMAIL-05**: Personal and work account data are structurally separated (separate sessions, separate memory, separate API calls)
- [x] **GMAIL-06**: OAuth token health is monitored with proactive refresh before expiry
- [x] **GMAIL-07**: gmail.googleapis.com is added to sandbox egress policy

### Classification

- [ ] **CLASS-01**: Comms agent classifies each email into 7 categories: code, calendar, research, home, urgent, routine, spam/noise
- [ ] **CLASS-02**: Classification uses Gemini structured JSON output with chain-of-thought reasoning
- [ ] **CLASS-03**: Multi-label support — emails can match multiple categories with confidence scores per label
- [ ] **CLASS-04**: Confidence thresholds: >0.85 auto-act, 0.70-0.84 act-and-confirm, <0.70 ask user
- [ ] **CLASS-05**: Batch classification processes 5-10 emails per prompt to stay within Gemini rate limits
- [ ] **CLASS-06**: Few-shot examples file exists with 14-21 labeled examples for prompt tuning
- [ ] **CLASS-07**: Classification accuracy exceeds 80% on a 50-email test set before moving to delivery phase

### Telegram Delivery

- [ ] **TGRAM-01**: User receives Telegram digest grouped by account (personal/work) and priority
- [ ] **TGRAM-02**: Each digest item shows sender, subject, category, and recommended action
- [ ] **TGRAM-03**: Smart batching: urgent items trigger immediate notification, low-priority batched every 3 hours
- [ ] **TGRAM-04**: User can reply with a number to act on a specific email from the digest
- [ ] **TGRAM-05**: Unknown senders are flagged for review in digest (sender screening)
- [ ] **TGRAM-06**: Digest respects Telegram message length limits (split if needed)

### Draft Generation

- [ ] **DRAFT-01**: Comms agent drafts routine acknowledgments (receipts, confirmations → "thanks, got it")
- [ ] **DRAFT-02**: Comms agent drafts template replies using predefined patterns for common email types
- [ ] **DRAFT-03**: Comms agent generates AI-powered smart drafts using Claude for contextual replies
- [ ] **DRAFT-04**: Comms agent drafts calendar RSVP responses (accept/decline based on calendar conflicts)
- [ ] **DRAFT-05**: All drafts are created as actual Gmail drafts via API (not Telegram-only previews)
- [ ] **DRAFT-06**: No draft is sent without explicit user approval via Telegram
- [ ] **DRAFT-07**: Drafts clearly label which Gmail account they belong to (personal/work)

### Agent Delegation

- [ ] **DELEG-01**: Comms agent delegates classified emails to target agents via @mention syntax (@dev, @productivity, @research, @home, @main)
- [ ] **DELEG-02**: Code/PR emails route to dev agent with relevant context
- [ ] **DELEG-03**: Calendar emails route to productivity agent for scheduling analysis
- [ ] **DELEG-04**: Research/newsletter emails route to research agent for summarization
- [ ] **DELEG-05**: Home/IoT alerts route to home agent for status assessment
- [ ] **DELEG-06**: Urgent items route to main agent for immediate Telegram alert
- [ ] **DELEG-07**: Delegation queue holds items when target agent is unavailable, notifies user
- [ ] **DELEG-08**: Agent results aggregate back through Telegram to user
- [ ] **DELEG-09**: Comms agent tracks delegated items and follows up if no action taken within timeout

### Learning Memory

- [ ] **LEARN-01**: Comms agent stores user classification corrections in a structured memory file
- [ ] **LEARN-02**: Memory file uses per-category structure with size caps to prevent unbounded growth
- [ ] **LEARN-03**: Sender-pattern matching references memory file to boost classification confidence for known senders
- [ ] **LEARN-04**: Embedding-based similarity search (via text-embedding-3-small) finds novel patterns from historical corrections
- [ ] **LEARN-05**: When confidence is below 0.70, agent asks user via Telegram and stores the correction

### Spam/Noise Management

- [ ] **SPAM-01**: Comms agent suggests spam/noise candidates based on pattern detection and presents for bulk approval
- [ ] **SPAM-02**: User can approve/reject noise patterns via Telegram
- [ ] **SPAM-03**: Emails matching user-approved noise patterns are auto-archived
- [ ] **SPAM-04**: Agent detects new potential noise sources and proposes additions to filter list
- [ ] **SPAM-05**: No email is auto-archived without appearing on user-approved filter list

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Advanced Features

- **ADV-01**: Thread-level conversation tracking (beyond single email classification)
- **ADV-02**: Attachment processing and summarization
- **ADV-03**: Cross-account email forwarding with permission flow
- **ADV-04**: Gmail Pub/Sub push notifications (if NemoClaw gains webhook support)
- **ADV-05**: Custom category creation by user
- **ADV-06**: Priority learning from user behavior (which emails get acted on first)

## Out of Scope

| Feature | Reason |
|---------|--------|
| Custom email client UI | Telegram is the sole interface — no web/mobile app |
| Auto-send without approval | Violates SOUL.md safety constraint; never auto-send |
| Attachment handling | Storage/processing complexity; defer to v2 |
| Thread management | Single-email classification is sufficient for v1 |
| Cross-account forwarding | Privacy boundary per AGENTS.md rules |
| Docker Desktop | WSL2 Docker Engine only per project constraints |
| Large local models | Pascal GPUs (GTX 1070 Ti) can't handle >7B quantized |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| GMAIL-01 | Phase 1 | Complete |
| GMAIL-02 | Phase 1 | Complete |
| GMAIL-03 | Phase 1 | Pending |
| GMAIL-04 | Phase 1 | Complete |
| GMAIL-05 | Phase 1 | Complete |
| GMAIL-06 | Phase 1 | Complete |
| GMAIL-07 | Phase 1 | Complete |
| CLASS-01 | Phase 2 | Pending |
| CLASS-02 | Phase 2 | Pending |
| CLASS-03 | Phase 2 | Pending |
| CLASS-04 | Phase 2 | Pending |
| CLASS-05 | Phase 2 | Pending |
| CLASS-06 | Phase 2 | Pending |
| CLASS-07 | Phase 2 | Pending |
| TGRAM-01 | Phase 2 | Pending |
| TGRAM-02 | Phase 2 | Pending |
| TGRAM-03 | Phase 2 | Pending |
| TGRAM-04 | Phase 2 | Pending |
| TGRAM-05 | Phase 2 | Pending |
| TGRAM-06 | Phase 2 | Pending |
| DRAFT-01 | Phase 3 | Pending |
| DRAFT-02 | Phase 3 | Pending |
| DRAFT-03 | Phase 3 | Pending |
| DRAFT-04 | Phase 3 | Pending |
| DRAFT-05 | Phase 3 | Pending |
| DRAFT-06 | Phase 3 | Pending |
| DRAFT-07 | Phase 3 | Pending |
| DELEG-01 | Phase 3 | Pending |
| DELEG-02 | Phase 3 | Pending |
| DELEG-03 | Phase 3 | Pending |
| DELEG-04 | Phase 3 | Pending |
| DELEG-05 | Phase 3 | Pending |
| DELEG-06 | Phase 3 | Pending |
| DELEG-07 | Phase 3 | Pending |
| DELEG-08 | Phase 3 | Pending |
| DELEG-09 | Phase 3 | Pending |
| LEARN-01 | Phase 4 | Pending |
| LEARN-02 | Phase 4 | Pending |
| LEARN-03 | Phase 4 | Pending |
| LEARN-04 | Phase 4 | Pending |
| LEARN-05 | Phase 4 | Pending |
| SPAM-01 | Phase 4 | Pending |
| SPAM-02 | Phase 4 | Pending |
| SPAM-03 | Phase 4 | Pending |
| SPAM-04 | Phase 4 | Pending |
| SPAM-05 | Phase 4 | Pending |

**Coverage:**
- v1 requirements: 46 total
- Mapped to phases: 46
- Unmapped: 0

---
*Requirements defined: 2026-03-31*
*Last updated: 2026-03-31 after roadmap creation*
