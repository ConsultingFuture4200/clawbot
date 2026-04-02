# Phase 2: Classification & Delivery - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-02
**Phase:** 02-classification-delivery
**Areas discussed:** Confidence thresholds, Classification prompt, Unknown sender handling

---

## Confidence Thresholds

### Q1: Auto-act meaning at >0.85 tier (no drafts/delegation in Phase 2)

| Option | Description | Selected |
|--------|-------------|----------|
| Auto-label and archive display | High-confidence emails get labeled in Gmail and appear in next digest with classification. No user prompt needed — just inform. | ✓ |
| Auto-label, suppress from digest | High-confidence routine/spam skip digest entirely. Reduces noise but loses visibility. | |
| Everything in digest, confidence shown | No auto-action. Every email in digest regardless of confidence. | |

**User's choice:** Auto-label and archive display (Recommended)
**Notes:** None

### Q2: Low-confidence (<0.70) clarification method

| Option | Description | Selected |
|--------|-------------|----------|
| Inline in digest with '?' marker | Ambiguous emails in regular digest marked with '?' and best guess. User replies with correct category. | ✓ |
| Separate 'needs your input' message | Low-confidence emails get own dedicated Telegram message outside digest. | |
| Batch at end of digest | All ambiguous emails in 'Needs Review' section at bottom of digest. | |

**User's choice:** Inline in digest with '?' marker (Recommended)
**Notes:** None

### Q3: Mid-confidence (0.70-0.84) confirmation prominence

| Option | Description | Selected |
|--------|-------------|----------|
| Show classification + 'correct?' flag | Email in digest with classification and small flag to confirm or correct. Silent if ignored (treated as confirmed). | ✓ |
| Require explicit confirmation | Mid-confidence items block until user confirms via Telegram. | |
| Treat same as high confidence | 0.70+ all auto-labeled. Only <0.70 gets '?' treatment. Two-tier system. | |

**User's choice:** Show classification + 'correct?' flag (Recommended)
**Notes:** None

### Q4: Urgent email notification behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, always immediate | Any 'urgent' email gets standalone Telegram ping immediately, regardless of confidence. | ✓ |
| Only if confidence >0.70 | Low-confidence urgent goes to next digest instead. Avoids false-alarm fatigue. | |
| Immediate + digest both | Urgent gets immediate ping AND appears in next digest. Belt and suspenders. | |

**User's choice:** Yes, always immediate (Recommended)
**Notes:** None

---

## Classification Prompt

### Q1: Local ollama pre-filter before Gemini

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, binary spam gate | Ollama does quick 'obviously spam?' check locally. Only non-spam to Gemini. Saves cloud quota. | ✓ |
| No pre-filter, send all to Gemini | Every email to Gemini. Simpler pipeline but burns quota on junk. | |
| Ollama classifies everything, Gemini for low-conf | Local classification first for all 7 categories. Gemini only when ollama unsure. | |

**User's choice:** Yes, binary spam gate (Recommended)
**Notes:** None

### Q2: Batch classification grouping

| Option | Description | Selected |
|--------|-------------|----------|
| 5 emails per prompt | Group 5 emails (metadata: sender, subject, snippet) per Gemini call with structured JSON. | ✓ |
| 10 emails per prompt | Larger batches, fewer calls. Risk of accuracy loss on later items. | |
| 1 email per prompt | Individual calls. Most accurate but 5-10x more API calls. | |

**User's choice:** 5 emails per prompt (Recommended)
**Notes:** None

### Q3: Few-shot examples maintenance

| Option | Description | Selected |
|--------|-------------|----------|
| Static JSON file, manually curated | classification-examples.json with 2-3 per category. Updated occasionally by user. | ✓ |
| Auto-growing from corrections | Start with seed set, auto-append user corrections. Risk of drift. | |
| You decide | Claude picks approach during implementation. | |

**User's choice:** Static JSON file, manually curated (Recommended)
**Notes:** None

### Q4: Chain-of-thought reasoning visibility

| Option | Description | Selected |
|--------|-------------|----------|
| Internal only | CoT generated but only category + confidence in digest. Reasoning in logs. | |
| Show reasoning for low-confidence | For <0.70 emails, include one-line reasoning summary in digest. | ✓ |
| Always show reasoning | Every digest item includes brief reasoning line. Transparent but verbose. | |

**User's choice:** Show reasoning for low-confidence
**Notes:** Diverged from recommended — wants transparency where it matters most.

---

## Unknown Sender Handling

### Q1: Definition of 'unknown' sender

| Option | Description | Selected |
|--------|-------------|----------|
| Never seen before in email history | First-time sender, no prior emails from this address. Sender cache from history.list. | ✓ |
| Not in Google Contacts | Check against Contacts list. Requires Contacts API scope. | |
| Not in a manual allowlist | User maintains known-senders.json. Most control, most manual effort. | |

**User's choice:** Never seen before in email history (Recommended)
**Notes:** None

### Q2: Unknown sender digest appearance

| Option | Description | Selected |
|--------|-------------|----------|
| Flag icon + 'New sender' tag | Visual marker in digest but otherwise normal appearance with classification. | ✓ |
| Separate 'New senders' section | Own section in digest, separate from known senders. | |
| Boost to mid-confidence automatically | Unknown sender = confidence penalty, forces review via 'correct?' flag. | |

**User's choice:** Flag icon + 'New sender' tag (Recommended)
**Notes:** None

### Q3: Sender cache account separation

| Option | Description | Selected |
|--------|-------------|----------|
| Separate per account | Independent caches for personal and work. Respects Phase 1 account separation. | ✓ |
| Shared across accounts | One cache for both. Simpler but crosses account boundary. | |
| You decide | Claude picks based on existing account separation rules. | |

**User's choice:** Separate per account (Recommended)
**Notes:** None

---

## Claude's Discretion

- Telegram digest layout, grouping strategy, numbered selection UX, and message splitting (user skipped this area)

## Deferred Ideas

None — discussion stayed within phase scope
