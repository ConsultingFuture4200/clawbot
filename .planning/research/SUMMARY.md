# Research Summary: ClawBot Email Triage Agent

**Domain:** Email triage + classification within a multi-agent AI system (OpenClaw / NemoClaw)
**Researched:** 2026-03-31
**Overall confidence:** HIGH

---

## Executive Summary

The ClawBot email triage agent has a clear, well-constrained path forward. The existing OpenClaw infrastructure already provides 80% of what is needed: the comms agent skeleton exists with Gmail and Google Calendar skills configured, the sandbox egress policy already allows all required Google API endpoints, the heartbeat scheduler is proven (productivity agent uses it for daily briefings), and the inter-agent delegation protocol (`sessions_spawn` / `sessions_send`) is a stable, documented feature of OpenClaw 2026.2+.

The primary technical challenge is not "can we do this?" but "how do we do this efficiently within the constraints?" The key constraints are: (1) Gemini free tier rate limits may be lower than the PRD assumes (potentially 10-15 RPM / 250 RPD vs the stated 60 RPM / 1K RPD), requiring batch classification and local pre-filtering; (2) the NemoClaw sandbox cannot receive inbound webhooks, ruling out Gmail Pub/Sub push notifications and making polling via `history.list` the correct architecture; (3) the $30/month Anthropic budget means Claude is reserved strictly for nuanced draft generation, not classification.

The stack recommendation is deliberately conservative: use OpenClaw's built-in gog CLI for Gmail operations, Gemini structured JSON output for classification, OpenClaw markdown memory for learning patterns, and OpenClaw `sessions_spawn` for agent delegation. The only external npm dependencies are `@googleapis/gmail` (for `history.list` incremental sync) and `google-auth-library` (for multi-account token management). No databases, no message queues, no external services beyond what is already configured.

The competitive analysis reveals that ClawBot's multi-agent delegation is a genuine differentiator -- no commercial email triage tool (SaneBox, Superhuman, Shortwave, Hey.com) routes emails to specialized AI agents. The approval-gate-on-everything constraint, while born from safety requirements, aligns with the "consent-based email" philosophy that Hey.com charges $99/year for. The cost structure ($0 for classification via Gemini free tier, ~$2.70/month for Claude drafts) is dramatically cheaper than any commercial alternative.

---

## Key Findings

**Stack:** Use OpenClaw's built-in gog CLI + Gemini structured JSON output + `sessions_spawn` delegation + markdown memory. Only two npm packages needed beyond what is installed: `@googleapis/gmail@16.1.1` and `google-auth-library@10.6.2`.

**Architecture:** Five components (Poller, Classifier, Router, Draft Engine, Learning Memory) connected through the existing comms agent. Heartbeat-driven polling replaces Pub/Sub push. Two-tier model usage: ollama for gate checks, Gemini for classification, Claude for nuanced drafts.

**Critical pitfall:** Google OAuth consent screen in "Testing" mode causes 7-day token expiry on Gmail scopes. Must set to "Production" status during Phase 1 setup, or the system will break weekly. This is the single most common failure mode reported by developers building Gmail integrations.

---

## Implications for Roadmap

Based on research, suggested phase structure:

### Phase 1: Gmail OAuth + Polling Foundation
- **Rationale:** Root dependency -- nothing works without authenticated API access and email data flowing
- **Addresses:** Gmail OAuth for both accounts, email polling/ingestion, heartbeat configuration, sync state management
- **Avoids:** Testing-mode token expiry trap (Pitfall #1), account data cross-contamination (Pitfall #5)
- **Exit gate:** Both accounts authenticated, `history.list` returning new messages, historyId persisted to disk, heartbeat triggering on schedule

### Phase 2: Classification Pipeline
- **Rationale:** Classification is the core intelligence; all downstream features depend on accurate categorization
- **Addresses:** 7-category classifier with structured JSON output, multi-label support, confidence scoring, few-shot examples file
- **Avoids:** Gemini rate limit blowout (Pitfall #3), classification cascade errors (Pitfall #4)
- **Exit gate:** Classification accuracy above 80% on a 50-email test set, structured JSON responses parsing reliably, batch classification working within rate limits

### Phase 3: Telegram Delivery + Drafts
- **Rationale:** User-facing output -- classification without notification is useless
- **Addresses:** Telegram digests (grouped by account + priority), spam/noise batching, template draft replies, Gmail Drafts API integration, approval gate
- **Avoids:** Notification fatigue (Pitfall #7), Telegram message length overflow (Pitfall #15), orphaned drafts (Pitfall #9)
- **Exit gate:** User receives structured digests, approves/rejects actions via Telegram, drafts appear in Gmail, no auto-send violations

### Phase 4: Agent Delegation
- **Rationale:** The killer differentiator, but requires stable classification and notification before adding cross-agent complexity
- **Addresses:** `sessions_spawn` delegation to dev/research/productivity/home agents, delegation queue with timeout, result aggregation
- **Avoids:** Delegation queue stalls (Pitfall #12), cascading misclassification (Pitfall #4)
- **Exit gate:** Code emails routed to dev agent and summarized, calendar emails checked against productivity agent, failed delegations surface to user with timeout

### Phase 5: Learning Memory
- **Rationale:** Optimization layer -- system works without it but improves with it. Corrections from Phases 2-4 provide the training data
- **Addresses:** User correction storage, sender-pattern matching, embedding-based similarity search, confidence boosting
- **Avoids:** Memory corruption and unbounded growth (Pitfall #10)
- **Exit gate:** Classification accuracy improvement measurable (compare before/after correction), memory files capped and de-duplicated, no contradictory patterns

### Phase 6: Polish + Adaptive Behavior
- **Rationale:** Refinement after core system is stable and generating real usage data
- **Addresses:** Adaptive polling cadence, sender screening, bulk action workflows, calendar RSVP drafts, account-aware routing
- **Avoids:** Over-engineering early; these features need real usage data to design correctly
- **Exit gate:** Polling frequency tuned to actual email volume, new sender triage reduces misclassification rate

**Phase ordering rationale:**
- Phase 1 before everything because OAuth + data flow is the root dependency
- Phase 2 before Phase 3 because digests need classified emails to format meaningfully
- Phase 3 before Phase 4 because the user must see and interact with classified emails before delegation adds value (and the user's corrections feed Phase 5)
- Phase 4 before Phase 5 because delegation reveals which classifications need improvement (the correction data from delegation failures is the best training signal)
- Phase 5 before Phase 6 because learning memory should be working before adaptive behavior is tuned (adaptive cadence needs classification confidence data from the learning system)

**Research flags for phases:**
- Phase 1: Needs careful verification of Google OAuth consent screen behavior (Testing vs Production status). Validate actual Gemini free tier limits in AI Studio before designing classification batch sizes. LOW risk of needing additional research -- Gmail API is very well-documented.
- Phase 2: May need deeper research if Gemini structured output has edge cases with multi-label classification. Test with real email data early.
- Phase 3: Standard patterns, unlikely to need research. Telegram Bot API is well-understood.
- Phase 4: May need research into OpenClaw `sessions_spawn` behavior under load -- what happens when multiple delegations fire simultaneously? Are sub-agent sessions truly isolated?
- Phase 5: Embedding-based similarity search for email patterns is a less-documented pattern. May need experimentation to find the right similarity threshold.
- Phase 6: Standard optimization work. No research expected.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All recommended technologies are official, well-documented, and already partially deployed. Version numbers verified against npm registry and official releases. |
| Features | HIGH | Comprehensive competitive analysis against 5 commercial tools. Feature landscape is well-understood. Table stakes are clearly defined. |
| Architecture | HIGH | Architecture follows established OpenClaw patterns (heartbeat, sessions_spawn, markdown memory). Gmail API integration patterns are industry-standard. |
| Pitfalls | HIGH | 16 pitfalls identified with verified sources. Critical pitfalls (OAuth expiry, rate limits, cross-contamination) are well-documented failure modes. |
| Gemini rate limits | MEDIUM | The PRD's stated limits may be stale. Actual free tier limits should be verified in AI Studio during Phase 1. Budget calculations use conservative (floor) estimates. |
| OpenClaw agentToAgent | MEDIUM | Documentation confirms the feature exists and is stable, but real-world behavior under concurrent delegation load is less documented. Test early in Phase 4. |

---

## Gaps to Address

- **Actual Gemini free tier limits:** Verify in Google AI Studio during Phase 1 setup. The PRD states 60 RPM / 1K RPD, but third-party reports suggest limits may be 10-15 RPM / 250 RPD. Budget calculations in STACK.md use the conservative floor.

- **NemoClaw inbound webhook support:** Network policy documentation focuses exclusively on egress. It is unclear whether the sandbox can receive inbound HTTP on the OpenClaw gateway port (18789). If it can, Gmail Pub/Sub push becomes viable as a future optimization. If it cannot, polling is the permanent architecture. Verify during Phase 1.

- **gog CLI `history.list` support:** The gog SKILL.md documents `gog gmail search` and `gog gmail messages search` but does not explicitly list `history.list`. If gog does not support incremental sync via historyId, custom skill code using `@googleapis/gmail` will be needed for the polling component. Verify during Phase 1.

- **OpenClaw `sessions_spawn` concurrency:** Documentation confirms sub-agent spawning works, but behavior when multiple spawns fire simultaneously (e.g., 5 emails delegated in one heartbeat cycle) is not explicitly documented. Test during Phase 4 development.

- **Google OAuth unverified production apps:** The recommendation to set consent screen to "Production" status avoids the 7-day token expiry, but unverified production apps show a scary "Google hasn't verified this app" warning. For personal use this is fine (you click through), but verify the flow works correctly with both Gmail accounts during Phase 1.

---

## Sources

All sources are documented with confidence levels in the individual research files:
- `STACK.md` -- 20+ sources covering npm packages, official API docs, OpenClaw documentation
- `ARCHITECTURE.md` -- 11 sources covering system design patterns and API integration
- `FEATURES.md` -- 12 sources covering competitor analysis and feature landscape
- `PITFALLS.md` -- 16 sources covering failure modes, official documentation, and incident reports

---
*Research summary for: ClawBot Email Triage Agent*
*Researched: 2026-03-31*
