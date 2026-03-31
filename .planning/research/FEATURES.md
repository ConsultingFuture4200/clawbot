# Feature Research

**Domain:** Email triage / inbox management for personal multi-agent AI assistant
**Researched:** 2026-03-31
**Confidence:** HIGH

## Feature Landscape

### Table Stakes (Users Expect These)

Features that any email triage system must have. Missing these means the system is not worth using over raw Gmail.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Email polling/ingestion** | System must receive email to do anything; every product starts here | MEDIUM | Gmail API push via Pub/Sub preferred over polling. watch() must renew every 7 days. Personal accounts can use push but setup requires GCP Pub/Sub topic. Fallback to smart polling (historyId-based sync) is simpler and adequate for personal use. |
| **Priority classification** | Gmail, SaneBox, Superhuman, Shortwave all do this. Users expect important email surfaced above noise. | MEDIUM | The 7-category system in PROJECT.md (code, calendar, research, home, urgent, routine, spam/noise) is well-designed. All competitors classify into 3-7 buckets. Multi-label support (an email can be both "code" and "urgent") differentiates from SaneBox's single-folder model. |
| **Spam/noise filtering** | Gmail already does spam; triage must handle the gray area: newsletters, marketing, receipts that Gmail considers "not spam" but user considers noise | LOW | SaneBox's @SaneBlackHole pattern is the gold standard: drag-to-kill means never hear from that sender again. Hey.com's Screener is the opinionated version. For ClawBot: suggest-and-confirm bulk approval is the right pattern given the no-auto-send constraint. |
| **Telegram notification digest** | Telegram is the sole user interface. Without structured digests, the system is just forwarding email to another channel. | MEDIUM | Best practice from notification research: batch into 2-3 digests per day for non-urgent (e.g., 9AM, 2PM, 6PM), immediate notification only for truly urgent. 35% higher engagement with digests vs individual alerts per Braze research. Group by account (personal/work) and priority tier. |
| **Draft reply generation** | Superhuman, Shortwave, alfred_ all offer AI-drafted replies. In 2026, an AI email system without draft generation feels incomplete. | MEDIUM | Must create actual Gmail API drafts (not Telegram previews) so user can edit in Gmail with full formatting. Ghostwriter-style voice matching (Shortwave) is aspirational but v2. For v1, template-based drafts for routine categories + AI-generated for others. |
| **Multi-account support** | Every paid tier of SaneBox, Superhuman, Shortwave supports multiple accounts. ClawBot has 2 Gmail accounts (personal + work). | MEDIUM | Strict account separation per AGENTS.md. Never cross-contaminate data between personal and work. Digests must clearly label which account each email belongs to. |
| **Approval gate on all outbound actions** | ClawBot-specific table stake from SOUL.md. Without this, the system violates its own safety constraints. Not optional. | LOW | Every send, archive, label, or delete requires explicit Telegram confirmation. This is actually a feature advantage: users trust the system more because it never acts without permission. Hey.com's philosophy of "consent-based email" aligns with this. |
| **Learning from corrections** | SaneBox reaches 98%+ accuracy in 1-2 weeks by learning from user corrections. Gmail Priority Inbox adapts to behavior. Users expect classification to improve. | HIGH | Memory file pattern: when user reclassifies an email, store the correction as a (sender, subject_pattern, correct_category) tuple. Gemini can use this as few-shot context. This is the single highest-value feedback loop. |

### Differentiators (Competitive Advantage)

Features that make ClawBot's email triage genuinely better than using SaneBox + Gmail. These align with the core value: "Every email that needs attention surfaces in Telegram with the right classification and a draft response ready to approve."

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Multi-agent delegation** | No commercial product routes emails to specialized AI agents. SaneBox sorts into folders. Superhuman labels. ClawBot routes a GitHub issue email to the dev agent, a calendar invite to the productivity agent, a home security alert to the home agent. This is the killer feature. | HIGH | Uses existing @mention syntax for inter-agent delegation (comms -> dev, research, productivity, home, main). Requires delegation queue with user notification when target agent is unavailable. No competitor has this because no competitor is a multi-agent system. |
| **Context-aware smart drafts** | Beyond template replies: the comms agent has access to the full agent ecosystem's context. A reply to a meeting invite can check the productivity agent's calendar awareness. A reply about a code review can reference the dev agent's project context. | HIGH | v1 should start with simple template drafts for routine categories and escalate to Claude for nuanced drafts. v2 can incorporate cross-agent context. Budget constraint: use Gemini for classification, reserve Claude ($30/mo cap) for complex draft generation only. |
| **Adaptive polling cadence** | Most tools poll on fixed intervals or require push setup. ClawBot's smart schedule (urgent = immediate, low-priority = every 3 hours) respects both responsiveness and resource constraints. | MEDIUM | Implemented as tiered heartbeat: ollama/qwen2.5:7b handles the polling pings locally (never burns cloud quota). Classification of urgency can use sender reputation + subject line heuristics before full LLM classification. BatchedInbox research shows 2-3 batch windows per day is optimal for non-urgent. |
| **Account-aware routing rules** | Personal email gets different treatment than work email. A receipt from Amazon (personal) gets Paper Trail treatment. A receipt from a vendor (work) might need expense tracking. Same email type, different routing based on account context. | MEDIUM | Hey.com's three-bucket model (Imbox/Feed/Paper Trail) applied per-account with different rules. ClawBot can learn that personal account patterns differ from work account patterns in the memory file. |
| **Sender screening (new sender triage)** | Hey.com's Screener concept: first-time senders get special treatment. Rather than auto-classifying unknown senders, surface them for explicit user decision. | LOW | Low complexity because it is just a filter on "sender not in known contacts list." High value because it prevents the classification model from making confident-but-wrong decisions on unfamiliar senders. Ask once, remember forever. |
| **Bulk action workflows** | SaneBox's drag-to-kill, Hey.com's batch screening. For Telegram: present groups of similar emails (e.g., "5 newsletter emails from this week") with a single approve/archive/block action. | MEDIUM | Reduces Telegram interaction friction. Instead of 5 individual approval requests, one grouped action. alfred_ calls this "closing the triage loop." Critical for notification fatigue management. |
| **Thread-aware urgency escalation** | An email thread that was "routine" yesterday becomes "urgent" when the CEO replies. Reclassify based on new participants or sentiment changes in thread replies. | HIGH | Explicitly out of scope for v1 per PROJECT.md ("single email classification only for v1"). Mark as v2 feature. Shortwave and Superhuman both do this with their AI summarization of thread updates. |

### Anti-Features (Commonly Requested, Often Problematic)

Features that seem good but create problems in the ClawBot context.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| **Auto-send replies without approval** | "Why approve every routine 'thanks, got it' reply?" Feels like unnecessary friction. | Violates SOUL.md safety constraint. One wrong auto-send to the wrong person (e.g., replying "thanks, got it" to a sensitive HR email) is catastrophic. Research shows AI email errors become "official" at scale. Trust erosion from even one bad auto-send outweighs the convenience. | Batch approval: group routine acknowledgments and approve them all with one Telegram tap. Friction is low but human remains in the loop. |
| **Full email client UI** | "I should be able to read and reply to email entirely through Telegram." Natural desire for a complete interface. | Telegram is a messaging app, not an email client. Long email bodies render poorly. Formatting is lost. Attachments cannot be handled. Building a full client duplicates Gmail's UI poorly. | Telegram as a triage dashboard + action approval layer. Link to Gmail for reading full emails. Drafts created via Gmail API so user edits in Gmail's native interface. |
| **Attachment processing** | "Parse PDF invoices, extract data from spreadsheets, summarize document attachments." Sounds powerful. | Massive complexity increase. Security risk (malicious attachments in sandbox). GPU-limited system cannot run document AI models locally. Cloud processing of attachments burns budget. | Explicitly out of scope for v1 per PROJECT.md. Mention attachment existence in digest ("has 2 attachments: invoice.pdf, contract.docx") without processing content. |
| **Cross-account forwarding/merging** | "Forward this work email to my personal account" or "merge threads across accounts." | Violates AGENTS.md privacy boundary. Work email data must never cross into personal context and vice versa. Corporate compliance risk. | Keep accounts strictly separated. If user needs to reference both, they see both in the Telegram digest but data stays in its own account silo. |
| **Real-time push notifications for everything** | "Notify me the instant any email arrives." Feels responsive and modern. | Notification fatigue research shows this leads to desensitization and disengagement. Constant interruption destroys focus. SaneBox and BatchedInbox exist precisely because real-time email notification is counterproductive. | Tiered notification: immediate for truly urgent (detection via sender + subject heuristics), batched digest for everything else. User can configure urgency thresholds. |
| **Sentiment analysis with emotional flags** | "Flag angry emails, detect frustrated customers." 2026 trend in commercial tools. | For a personal assistant with 2 email accounts, emotional classification adds complexity without proportional value. Misclassifying tone (sarcasm, dry humor) creates anxiety. "Your mom sounds angry" is a bad notification. | Use urgency detection (needs response soon) rather than emotional tone. Urgency is actionable; sentiment is not. |
| **Complex rule-based filters (IFTTT-style)** | "If sender matches X AND subject contains Y AND sent after 5PM, then classify as Z." Power user appeal. | Rule explosion problem: users create rules, forget them, rules conflict, behavior becomes unpredictable. SaneBox explicitly avoids user-defined rules in favor of ML-based learning. | Learning memory approach: system learns from corrections, not from user-written rules. Simpler, more robust, and the correction patterns are human-readable for debugging. |
| **Calendar RSVP auto-accept** | "If my calendar is free, auto-accept the meeting." Sounds efficient. | Calendar conflicts are not binary. "Free" does not mean "available" -- user might want that time for deep work. Auto-accepting on behalf of user without confirmation violates the approval gate principle. | Draft RSVP responses with calendar conflict analysis shown in Telegram. User approves accept/decline with one tap. |

## Feature Dependencies

```
[Gmail OAuth Setup]
    |
    +-- requires --> [Email Polling/Ingestion]
    |                    |
    |                    +-- requires --> [Priority Classification]
    |                    |                    |
    |                    |                    +-- requires --> [Telegram Digest]
    |                    |                    |
    |                    |                    +-- requires --> [Multi-Agent Delegation]
    |                    |                    |
    |                    |                    +-- enables --> [Learning from Corrections]
    |                    |
    |                    +-- requires --> [Spam/Noise Filtering]
    |                    |                    |
    |                    |                    +-- enables --> [Sender Screening]
    |                    |                    |
    |                    |                    +-- enables --> [Bulk Action Workflows]
    |                    |
    |                    +-- requires --> [Multi-Account Support]
    |                                        |
    |                                        +-- enables --> [Account-Aware Routing]
    |
    +-- requires --> [Draft Reply Generation]
                         |
                         +-- enables --> [Context-Aware Smart Drafts]
                         |
                         +-- requires --> [Approval Gate]

[Adaptive Polling Cadence] -- independent, enhances --> [Email Polling/Ingestion]

[Thread-Aware Urgency Escalation] -- requires --> [Priority Classification]
                                   -- requires --> [Thread tracking (v2)]
```

### Dependency Notes

- **Gmail OAuth Setup is the root dependency:** Nothing works without authenticated API access to both accounts. Must be the very first thing built and validated.
- **Priority Classification requires Email Polling:** Cannot classify what you have not ingested. But classification logic should be designed before polling is built so the data model supports it.
- **Multi-Agent Delegation requires Priority Classification:** Delegation targets are determined by category (code -> dev, calendar -> productivity, etc.). Classification must be working and accurate before delegation adds value.
- **Draft Reply Generation requires Gmail OAuth (compose scope):** Drafts are created via the Gmail API, not generated as text in Telegram. The gmail.compose scope must be authorized alongside gmail.readonly.
- **Learning from Corrections enhances Priority Classification:** This is a feedback loop, not a hard dependency. Classification works without it but improves with it. Can be added incrementally.
- **Context-Aware Smart Drafts require Draft Reply Generation + multi-agent infrastructure:** The complex cross-agent context feature builds on basic draft generation. Do not attempt before basic drafts work reliably.
- **Bulk Action Workflows enhance Spam/Noise Filtering:** Grouping similar items for batch approval is an optimization on top of per-email approval. Build single-email flow first.

## MVP Definition

### Launch With (v1)

Minimum viable product -- what is needed to validate the core value proposition: "Every email that needs attention surfaces in Telegram with the right classification and a draft response ready to approve."

- [ ] **Gmail OAuth for both accounts** -- root dependency; nothing works without it; read + compose + calendar scopes
- [ ] **Email polling via historyId sync** -- simpler than Pub/Sub for personal use; smart interval (check every 5 min for urgent senders, every 30 min otherwise); ollama heartbeat pings
- [ ] **7-category classification with multi-label** -- the core intelligence; Gemini-flash for bulk classification; must reach 80%+ accuracy within first week
- [ ] **Telegram digest grouped by account and priority** -- the user-facing output; 2-3 batches/day for non-urgent, immediate for urgent
- [ ] **Approval gate on all actions** -- safety constraint; every send/archive/label requires Telegram confirmation
- [ ] **Template draft replies for routine categories** -- "thanks, got it" for receipts, "I will review and get back to you" for requests; creates actual Gmail API drafts
- [ ] **Spam/noise suggest-and-confirm** -- present suspected noise, user approves bulk archive; store sender patterns for future auto-suggestion
- [ ] **Basic learning memory** -- store user corrections as (sender, pattern, category) tuples; use as few-shot context for Gemini classification

### Add After Validation (v1.x)

Features to add once core classification and digest are working reliably.

- [ ] **Multi-agent delegation** -- route code emails to dev agent, calendar to productivity agent; requires stable classification accuracy first; trigger: classification accuracy above 90% for 2+ weeks
- [ ] **Sender screening for unknown senders** -- first-time senders get manual triage before auto-classification; trigger: user complains about misclassification of new senders
- [ ] **AI-generated smart drafts (beyond templates)** -- Claude-powered contextual replies for non-routine emails; trigger: template drafts cover less than 60% of emails needing replies
- [ ] **Bulk action workflows** -- group similar emails for batch approval in Telegram; trigger: user is approving more than 10 individual items per digest
- [ ] **Adaptive polling cadence** -- learn per-sender urgency patterns and adjust polling frequency; trigger: polling is either too frequent (wasting resources) or too slow (missing urgent emails)
- [ ] **Calendar RSVP drafts** -- check calendar conflicts, draft accept/decline; trigger: user frequently receives calendar invites and manually checks conflicts
- [ ] **Account-aware routing rules** -- different classification weights per account; trigger: personal and work email have clearly different priority patterns

### Future Consideration (v2+)

Features to defer until the core system proves its value and classification is mature.

- [ ] **Thread-level conversation tracking** -- track full threads, reclassify when new participants join or sentiment shifts; requires significant state management
- [ ] **Context-aware cross-agent smart drafts** -- drafts that incorporate dev agent's project context or productivity agent's calendar state; requires stable multi-agent delegation
- [ ] **Attachment awareness (metadata only)** -- surface attachment filenames and types in digest without processing content; low risk addition when digest format is stable
- [ ] **Ghostwriter voice matching** -- learn user's writing style from sent emails for more natural draft generation; requires significant training data and model fine-tuning or advanced prompting
- [ ] **Quiet hours and schedule-aware notification** -- suppress non-urgent digests during configurable quiet periods; nice-to-have UX polish

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Gmail OAuth setup | HIGH (blocker) | LOW | P1 |
| Email polling/ingestion | HIGH (blocker) | MEDIUM | P1 |
| 7-category classification | HIGH (core value) | MEDIUM | P1 |
| Telegram digest | HIGH (core value) | MEDIUM | P1 |
| Approval gate | HIGH (safety) | LOW | P1 |
| Template draft replies | HIGH (core value) | LOW | P1 |
| Spam/noise filtering | HIGH (daily pain) | LOW | P1 |
| Basic learning memory | MEDIUM (improves over time) | MEDIUM | P1 |
| Multi-agent delegation | HIGH (unique differentiator) | HIGH | P2 |
| Sender screening | MEDIUM (prevents errors) | LOW | P2 |
| AI smart drafts (Claude) | HIGH (saves time) | MEDIUM | P2 |
| Bulk action workflows | MEDIUM (reduces friction) | MEDIUM | P2 |
| Adaptive polling cadence | MEDIUM (resource optimization) | MEDIUM | P2 |
| Calendar RSVP drafts | MEDIUM (common use case) | MEDIUM | P2 |
| Account-aware routing | LOW (optimization) | LOW | P2 |
| Thread conversation tracking | MEDIUM (accuracy improvement) | HIGH | P3 |
| Cross-agent smart drafts | MEDIUM (advanced) | HIGH | P3 |
| Ghostwriter voice matching | LOW (polish) | HIGH | P3 |

**Priority key:**
- P1: Must have for launch -- the system is not useful without these
- P2: Should have, add after core validation -- these make it genuinely better than alternatives
- P3: Nice to have, future consideration -- these are polish and advanced capabilities

## Competitor Feature Analysis

| Feature | SaneBox | Superhuman | Hey.com | Shortwave | Gmail Priority Inbox | ClawBot Approach |
|---------|---------|------------|---------|-----------|---------------------|-----------------|
| **Classification method** | Sender behavior (headers only, no content) | Auto-labels via AI prompts | Manual 3-bucket (Imbox/Feed/Paper Trail) | Content-aware AI | ML on engagement signals | Content-aware 7-category via Gemini with multi-label |
| **Learning mechanism** | Drag-to-folder trains model | User creates custom label prompts | User manually sorts on first encounter | "Organize my inbox" AI suggestions | Implicit from user behavior | Explicit correction memory + implicit from approvals |
| **Draft generation** | None | Auto-drafts (Business plan) | None | Ghostwriter (voice-matched) | Smart Reply (short) | Template drafts (v1) + Claude smart drafts (v2) |
| **Notification approach** | Email summary digest | Split inbox (in-app) | Per-bucket (Imbox notifies, Feed does not) | AI-organized inbox (in-app) | Priority markers in inbox | Telegram digests batched by priority tier |
| **New sender handling** | SaneBlackHole for unwanted | Auto-label/archive | The Screener (explicit yes/no gate) | AI suggestion | Automatic categorization | Sender screening with Telegram approval |
| **Multi-account** | Yes (paid tiers, 2-4 accounts) | Yes (Gmail + Outlook) | No (hey.com addresses only) | Gmail only | One account | 2 Gmail accounts, strictly separated |
| **Delegation/routing** | None | None | None | Tasklet (external tools) | None | Multi-agent routing (dev, research, productivity, home) -- unique |
| **Auto-actions** | Auto-sort to folders | Auto-archive, auto-label | Auto-sort to buckets | AI-suggested actions | Auto-categorize | Never auto-act; all actions require approval |
| **Price** | $7-36/mo | $33/mo (Business) | $99/yr | Free-$100/mo | Free | Self-hosted, API costs only (Gemini free tier + Gmail API free) |
| **Privacy** | Headers only (no content read) | Full content access (cloud) | Full content (cloud) | Full content (cloud) | Full content (Google) | Self-hosted, content processed in local sandbox |

### Key Competitive Insights

1. **No competitor has multi-agent delegation.** This is ClawBot's unique structural advantage -- it is the only system that routes emails to specialized AI agents rather than just sorting into folders or labels.

2. **Privacy advantage is real.** SaneBox markets "headers only" as a privacy feature. ClawBot processes content but does so in a local NemoClaw sandbox, never sending email content to third-party services (Gemini processes the classification prompt, not raw email bodies if designed carefully).

3. **The approval gate is a feature, not a limitation.** Hey.com's Screener philosophy ("consent-based email") resonates with users who want control. ClawBot's "never auto-send" constraint, while born from safety requirements, aligns with a genuine user desire for control over outbound communication.

4. **Digest-via-Telegram is unique.** Every competitor requires opening their app or email client. ClawBot delivers the triage to where the user already is (Telegram), reducing context-switching.

5. **Cost advantage.** SaneBox costs $7-36/mo, Superhuman $33/mo, Shortwave up to $100/mo. ClawBot runs on Gemini free tier + Gmail API (free for personal use) + self-hosted infrastructure. The only recurring cost is the $30/mo Claude cap for smart drafts, which is optional.

## Sources

- [SaneBox Review 2026](https://max-productive.ai/ai-tools/sanebox/) - Feature overview and pricing
- [7 Best AI Email Triage Tools in 2026](https://get-alfred.ai/blog/best-ai-email-triage-tools) - Comprehensive tool comparison
- [Superhuman AI-native email](https://superhuman.com/ai) - Feature set and AI capabilities
- [How HEY works](https://www.hey.com/how-it-works/) - Screener, Imbox, Feed, Paper Trail concepts
- [Shortwave AI Email](https://www.shortwave.com/) - Ghostwriter, Tasklet, AI assistant features
- [Gmail AI Inbox Categorization 2026](https://www.getmailbird.com/gmail-ai-inbox-categorization-guide/) - Google's smart features and CC agent
- [Gmail API Push Notifications](https://developers.google.com/workspace/gmail/api/guides/push) - Pub/Sub vs polling for personal accounts
- [Gmail API Usage Limits](https://developers.google.com/workspace/gmail/api/reference/quota) - Rate limits and quota management
- [Why Gmail API Breaks AI Agents](https://cli.nylas.com/guides/why-gmail-api-breaks-ai-agents) - Common integration pitfalls
- [Digest Notifications Best Practices](https://novu.co/blog/digest-notifications-best-practices-example/) - Batching and frequency research
- [Hidden Risks of AI Email](https://www.futureofbeinghuman.com/p/the-hidden-risks-of-using-ai-for-email) - Auto-reply dangers and trust erosion
- [AgentMail for AI Agents](https://www.eesel.ai/blog/agentmail) - Multi-agent email infrastructure patterns
- [How to Reduce Notification Fatigue](https://www.courier.com/blog/how-to-reduce-notification-fatigue-7-proven-product-strategies) - 35% engagement improvement with digests

---
*Feature research for: Email triage / inbox management (ClawBot comms agent)*
*Researched: 2026-03-31*
