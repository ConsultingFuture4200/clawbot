# Roadmap: ClawBot Email Triage Agent

## Overview

Transform the comms agent from a passive drafting tool into an active email triage system. The journey starts with Gmail API access and polling (the root dependency), builds classification and Telegram delivery (the core loop), adds draft generation and agent delegation (the action layer), and finishes with learning memory and spam management (the intelligence layer). Four phases, each delivering a testable vertical slice.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Gmail Foundation** - OAuth, polling, heartbeat, and account separation for both Gmail accounts
- [ ] **Phase 2: Classification & Delivery** - Classify emails into 7 categories and surface them to user via Telegram digests
- [ ] **Phase 3: Drafts & Delegation** - Generate draft replies and route classified emails to specialized agents
- [ ] **Phase 4: Intelligence Layer** - Learning memory from user corrections and spam/noise management

## Phase Details

### Phase 1: Gmail Foundation
**Goal**: Comms agent has authenticated, persistent access to both Gmail accounts and polls for new emails on a heartbeat schedule
**Depends on**: Nothing (first phase)
**Requirements**: GMAIL-01, GMAIL-02, GMAIL-03, GMAIL-04, GMAIL-05, GMAIL-06, GMAIL-07
**Success Criteria** (what must be TRUE):
  1. User can authenticate both Gmail accounts (personal + work) and tokens persist beyond 7 days
  2. Comms agent detects new emails within the expected heartbeat interval for both accounts
  3. Personal and work email data never appear in the same API session or memory context
  4. OAuth tokens refresh proactively before expiry without user intervention
  5. Sandbox egress policy allows all required Google API endpoints
**Plans**: 3 plans
Plans:
- [x] 01-01-PLAN.md — Sandbox egress policy, heartbeat/cron config, OAuth env template
- [x] 01-02-PLAN.md — Gmail OAuth2 setup and verification for both accounts
- [x] 01-03-PLAN.md — Phase 1 exit criteria verification (26 checks, 7 requirements)

### Phase 2: Classification & Delivery
**Goal**: Every incoming email is classified into categories with confidence scores and surfaced to the user via structured Telegram digests
**Depends on**: Phase 1
**Requirements**: CLASS-01, CLASS-02, CLASS-03, CLASS-04, CLASS-05, CLASS-06, CLASS-07, TGRAM-01, TGRAM-02, TGRAM-03, TGRAM-04, TGRAM-05, TGRAM-06
**Success Criteria** (what must be TRUE):
  1. User receives Telegram digests grouped by account and priority with sender, subject, category, and recommended action per item
  2. Classification accuracy exceeds 80% on a 50-email test set using Gemini structured JSON output
  3. Urgent emails trigger immediate Telegram notification; low-priority emails batch every 3 hours
  4. User can reply with a number in Telegram to select a specific email for action
  5. Unknown senders are flagged for review in the digest
**Plans**: 4 plans
Plans:
- [x] 02-01-PLAN.md — Classification contracts: schema, few-shot examples, types module, @google/genai install
- [x] 02-02-PLAN.md — Two-stage pipeline: Ollama spam gate + Gemini batch classifier + sender cache
- [x] 02-03-PLAN.md — Telegram digest formatting + delivery orchestration + reply handler
- [ ] 02-04-PLAN.md — Pipeline integration, 50-email accuracy test, end-to-end verification
**UI hint**: yes

### Phase 3: Drafts & Delegation
**Goal**: Comms agent generates draft replies for classified emails and delegates specialized items to the appropriate ClawBot agent, with all outbound actions gated by Telegram approval
**Depends on**: Phase 2
**Requirements**: DRAFT-01, DRAFT-02, DRAFT-03, DRAFT-04, DRAFT-05, DRAFT-06, DRAFT-07, DELEG-01, DELEG-02, DELEG-03, DELEG-04, DELEG-05, DELEG-06, DELEG-07, DELEG-08, DELEG-09
**Success Criteria** (what must be TRUE):
  1. User sees draft replies (routine acks, templates, smart drafts, calendar RSVPs) appear as actual Gmail drafts labeled by account
  2. No draft is ever sent without explicit user approval via Telegram
  3. Code/PR emails reach the dev agent, calendar emails reach productivity, research emails reach research, home alerts reach home, urgent items reach main
  4. When a target agent is unavailable, the user is notified via Telegram and the item is queued
  5. Delegation results aggregate back to the user through Telegram
**Plans**: 4 plans
Plans:
- [x] 03-01-PLAN.md — Draft generation: types, templates, MIME threading, Gmail draft creation, calendar conflict detection
- [x] 03-02-PLAN.md — Agent delegation: sessions_spawn routing, queue with retry/dead-letter, follow-up tracking, OpenClaw config
- [x] 03-03-PLAN.md — Pipeline wiring: draft/delegation integration, Telegram inline keyboards, callback handler, heartbeat maintenance
- [ ] 03-04-PLAN.md — Phase 3 verification: 29-check module validation + human sign-off

### Phase 4: Intelligence Layer
**Goal**: The system learns from user corrections to improve classification over time, and spam/noise is managed through a suggest-and-confirm workflow
**Depends on**: Phase 2
**Requirements**: LEARN-01, LEARN-02, LEARN-03, LEARN-04, LEARN-05, SPAM-01, SPAM-02, SPAM-03, SPAM-04, SPAM-05
**Success Criteria** (what must be TRUE):
  1. When user corrects a classification via Telegram, the correction is stored and used to boost future confidence for similar emails
  2. Memory file stays bounded (per-category caps, de-duplication) and does not grow without limit
  3. User can approve or reject suggested spam/noise patterns via Telegram, and approved patterns auto-archive matching emails
  4. No email is auto-archived without appearing on the user-approved filter list
  5. Classification accuracy measurably improves after corrections accumulate (before/after comparison)
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 / 4 (Phase 3 and 4 can run in parallel after Phase 2)

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Gmail Foundation | 3/3 | Complete | 2026-04-01 |
| 2. Classification & Delivery | 3/4 | In Progress|  |
| 3. Drafts & Delegation | 0/4 | Planned    |  |
| 4. Intelligence Layer | 0/? | Not started | - |
