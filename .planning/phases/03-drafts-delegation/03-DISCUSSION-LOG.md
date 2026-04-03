# Phase 3: Drafts & Delegation - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-02
**Phase:** 03-drafts-delegation
**Areas discussed:** Draft tiers & model routing, Delegation routing logic, Telegram approval UX, Draft lifecycle & state

---

## Draft Tiers & Model Routing

| Option | Description | Selected |
|--------|-------------|----------|
| Category-driven | Routine/spam->Gemini acks, calendar->Gemini RSVP, code/research/home/urgent->Claude smart drafts. Model follows email category automatically. | ✓ |
| Confidence-driven | High-confidence emails get Gemini drafts regardless of category. Low-confidence or complex emails escalate to Claude. | |
| Hybrid: category + complexity | Category sets the draft TYPE, then a complexity heuristic decides Gemini vs Claude within each type. | |

**User's choice:** Category-driven
**Notes:** Clean mapping from existing classification categories to draft types and model selection.

---

| Option | Description | Selected |
|--------|-------------|----------|
| Selective | Only emails needing a reply get drafts. Code/research/home delegated, spam gets nothing. | ✓ |
| Everything except spam | Every non-spam email gets at least a templated draft alongside delegation. | |
| User picks per-digest | No auto-drafting. Drafts only on explicit user request. | |

**User's choice:** Selective
**Notes:** Code/research/home emails are delegated to sibling agents rather than drafted.

---

| Option | Description | Selected |
|--------|-------------|----------|
| Auto-create draft | Draft appears in Gmail immediately. Telegram shows 'Draft ready'. | ✓ |
| Suggest first, draft on request | Telegram shows suggestion, draft only created on tap. | |

**User's choice:** Auto-create draft
**Notes:** Proactive — draft is waiting when user gets to it.

---

| Option | Description | Selected |
|--------|-------------|----------|
| Only on user request | No auto smart-drafts. User taps 'Smart draft' to trigger Claude. | |
| Auto for urgent only | Urgent emails automatically get a Claude smart draft. All other categories wait for user request. | ✓ |
| Auto for all delegatable | Any email classified as code/research/home/urgent gets a Claude draft alongside delegation. | |

**User's choice:** Auto for urgent only
**Notes:** Budget-conscious — ~2-3 auto smart drafts/day. Other categories require explicit request.

---

## Delegation Routing Logic

| Option | Description | Selected |
|--------|-------------|----------|
| Spawn for all | Always use sessions_spawn — non-blocking, isolated sub-sessions. | ✓ |
| Spawn for tasks, send for queries | sessions_spawn for full processing, sessions_send for quick lookups. | |
| You decide | Claude's discretion on spawn vs send. | |

**User's choice:** Spawn for all
**Notes:** Fire-and-forget pattern. Comms shouldn't block waiting for sibling agent responses.

---

| Option | Description | Selected |
|--------|-------------|----------|
| Queue + notify | Item queued with retry counter. Telegram alert on unavailability. Max 3 retries, then dead-letter. | ✓ |
| Immediate user fallback | No queue. Telegram alert asking user to handle it. | |
| Silent queue only | Queue silently, only notify on all retries exhausted. | |

**User's choice:** Queue + notify
**Notes:** User stays informed but doesn't need to act immediately.

---

| Option | Description | Selected |
|--------|-------------|----------|
| Metadata + classification | Send sender, subject, snippet, classification, confidence, recommended action. Target fetches full body if needed. | ✓ |
| Metadata + body excerpt | Metadata plus first 500 chars of email body. | |
| Full email forwarding | Everything including full body. | |

**User's choice:** Metadata + classification
**Notes:** Respects AGENTS.md privacy constraint. Target agent fetches full email via Gmail API itself.

---

| Option | Description | Selected |
|--------|-------------|----------|
| 2 hours | Check every heartbeat. Telegram follow-up after 2 hours of no response. | ✓ |
| 30 minutes | Aggressive follow-up. | |
| Category-dependent | Urgent=30min, code=4hr, research=8hr. | |

**User's choice:** 2 hours
**Notes:** Balanced — not too aggressive, not too slow.

---

## Telegram Approval UX

| Option | Description | Selected |
|--------|-------------|----------|
| Inline keyboards | Approve / Edit / Discard buttons below each draft notification. One-tap action. | ✓ |
| Reply-to-number | Consistent with Phase 2 digest. Text-only. | |
| Hybrid: buttons + reply | Buttons for common actions, reply for edit. | |

**User's choice:** Inline keyboards
**Notes:** Upgrade from Phase 2's reply-to-number for draft-specific actions.

---

| Option | Description | Selected |
|--------|-------------|----------|
| Link to Gmail | Deep link to draft in Gmail web UI. | |
| Edit in Telegram | User types revised text in Telegram. | |
| Both options offered | 'Edit in Gmail' button plus 'Quick edit' reply option. | ✓ |

**User's choice:** Both options offered
**Notes:** Flexibility — Gmail for rich editing, Telegram for quick text changes.

---

| Option | Description | Selected |
|--------|-------------|----------|
| Separate messages | Each draft gets its own Telegram message with inline keyboard. | |
| Bundled in digest | Drafts appear as section within periodic digest. | |
| Urgent=separate, rest=bundled | Urgent drafts immediate, routine/calendar bundle into next digest. | ✓ |

**User's choice:** Urgent=separate, rest=bundled
**Notes:** Consistent with Phase 2's urgent=immediate pattern.

---

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, with preset times | Snooze with 1hr/3hr/tomorrow options. Draft stays in Gmail, reminder resurfaces. | ✓ |
| No snooze | Keep simple: Approve/Edit/Discard. Ignored drafts just sit in Gmail. | |
| You decide | Claude's discretion. | |

**User's choice:** Yes, with preset times
**Notes:** "I'll deal with this later" without losing track of the draft.

---

## Draft Lifecycle & State

| Option | Description | Selected |
|--------|-------------|----------|
| Immediately on classification | Draft created in Gmail as soon as classification completes. Proactive. | ✓ |
| On digest delivery | Drafts created in batch when periodic digest fires. | |
| On user request only | No draft until user explicitly requests. | |

**User's choice:** Immediately on classification
**Notes:** Core value: "draft response ready to approve."

---

| Option | Description | Selected |
|--------|-------------|----------|
| 48 hours | Auto-deleted after 48hr. Telegram notification on cleanup. | ✓ |
| 24 hours | Aggressive cleanup. | |
| Never auto-delete | Drafts stay forever. | |

**User's choice:** 48 hours
**Notes:** Balance between inbox cleanliness and giving user time to act.

---

| Option | Description | Selected |
|--------|-------------|----------|
| One draft per thread | draft-tracker.json checks threadId. Update existing draft if one exists. | ✓ |
| One draft per message | Each email in a thread gets its own draft. | |
| You decide | Claude's discretion. | |

**User's choice:** One draft per thread
**Notes:** Prevents duplicate drafts cluttering Gmail.

---

| Option | Description | Selected |
|--------|-------------|----------|
| Auto-check, suggest action | Read Google Calendar, suggest accept/decline based on conflicts. User approves via Telegram. | ✓ |
| Always show conflicts, user decides | Show calendar context but don't suggest action. | |
| You decide | Claude's discretion. | |

**User's choice:** Auto-check, suggest action
**Notes:** Proactive RSVP assistance leveraging existing calendar.readonly scope.

---

## Claude's Discretion

- Draft text tone and formatting (within SOUL.md constraints)
- Template library structure and specific template patterns
- Delegation message formatting for target agents
- Error handling for Gmail draft creation failures
- Draft update strategy when new emails arrive in same thread

## Deferred Ideas

None — discussion stayed within phase scope
