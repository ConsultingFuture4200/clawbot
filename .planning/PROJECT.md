# ClawBot Email Triage Agent

## What This Is

Gmail integration for ClawBot's comms agent — turning it from a passive drafting tool into an active email triage system that polls both Gmail accounts, classifies incoming email, routes actionable items to the right ClawBot agent, and drafts intelligent replies. All outbound actions gated by Telegram approval.

## Core Value

Every email that needs attention surfaces in Telegram with the right classification and a draft response ready to approve — nothing falls through the cracks.

## Requirements

### Validated

- [x] Gmail OAuth wired up for both accounts (personal + work) with read/compose/calendar scopes — *Validated in Phase 01: Gmail Foundation*
- [x] 7-category classification (code, calendar, research, home, urgent, routine, spam/noise) — *Validated in Phase 02: Classification & Delivery*
- [x] Multi-label support for emails matching multiple categories — *Validated in Phase 02: Classification & Delivery*
- [x] Telegram digest grouped by account and priority — *Validated in Phase 02: Classification & Delivery*

### Active

- [ ] Email polling heartbeat running on smart schedule (urgent = immediate, low-priority = every 3 hours)
- [ ] Learning memory: comms agent asks user for ambiguous classifications, stores patterns in memory file
- [ ] Agent-to-agent delegation via @mention syntax (comms → dev, productivity, research, home, main)
- [ ] Delegation queue with user notification when target agent unavailable
- [ ] Spam/noise filter with suggest-and-confirm bulk approval workflow
- [ ] Auto-archive for approved noise patterns
- [ ] Routine acknowledgment drafts (receipts, confirmations → "thanks, got it")
- [ ] Calendar RSVP drafts (accept/decline based on calendar conflicts)
- [ ] Template reply drafts (predefined patterns for common email types)
- [ ] Smart drafts (AI-generated contextual replies for any email)
- [ ] All drafts created as actual Gmail drafts via API
- [ ] All outbound actions require Telegram approval (never auto-send)

### Out of Scope

- Custom email client UI — Telegram is the interface
- Email sending without approval — violates SOUL.md safety constraint
- Attachment handling/processing — defer to future milestone
- Thread-level conversation management — single email classification only for v1
- Cross-account email forwarding — privacy boundary per AGENTS.md

## Context

**Existing Infrastructure:**
- Comms agent fully configured in openclaw.json5 with gmail + google-calendar skills
- SOUL.md and AGENTS.md define personality, permissions, and safety constraints
- Sandbox egress policy already allows googleapis.com, oauth2.googleapis.com, accounts.google.com
- Productivity agent has a working heartbeat pattern to follow as reference
- 6-agent system operational (main, dev, comms, research, productivity, home)
- Telegram is the sole user channel

**Model Strategy:**
- Primary: gemini-3-flash (bulk classification — free tier, fast)
- Fallback: claude-sonnet-4-6 (nuanced draft writing — $30/mo cap)
- Heartbeat pings: ollama/qwen2.5:7b (local only, never cloud)

**Two Gmail Accounts:**
1. Personal — personal correspondence
2. Work/Business — professional communications
- Accounts must remain strictly separated per AGENTS.md rules

## Constraints

- **No auto-send**: Every outbound email requires explicit Telegram approval (SOUL.md constraint)
- **Account separation**: Personal and work email data never cross without permission
- **Model budget**: Anthropic capped at $30/month — use Gemini for bulk classification
- **Heartbeat model**: Email polling pings use ollama/qwen2.5:7b locally, not cloud
- **Sandbox egress**: All API calls must go through allowlisted endpoints in openclaw-sandbox.yaml
- **No self-modification**: Comms agent cannot edit its own config, auth, or SOUL.md
- **GPU limitation**: 2× GTX 1070 Ti — no large local models, only qwen2.5:7b quantized

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Multi-label classification | Emails often span categories (e.g., GitHub calendar invite) | Implemented Phase 02 — classifier returns array of categories |
| Learning memory for ambiguous emails | Reduces misclassification over time without manual rule-writing | — Pending |
| Smart batching (urgent=immediate, low=3hr) | Balances responsiveness with notification fatigue | Implemented Phase 02 — urgent bypasses batch buffer, low-priority batched every 3hr |
| Gmail API drafts (not Telegram preview) | User can edit drafts in Gmail with full formatting tools | — Pending |
| Suggest + confirm for spam filters | Safe default — no auto-archiving without explicit approval | — Pending |
| Queue + notify for failed delegations | User stays informed when target agents are unavailable | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd:transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-04-02 after Phase 02 completion — classification engine and Telegram delivery layer built*
