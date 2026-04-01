# Phase 1: Gmail Foundation - Context

**Gathered:** 2026-03-31
**Status:** Ready for planning

<domain>
## Phase Boundary

Authenticated, persistent Gmail API access for both accounts (personal + work), with heartbeat-driven polling for new emails and strict account separation. This phase delivers the plumbing — no classification, delivery, drafting, or delegation yet.

</domain>

<decisions>
## Implementation Decisions

### Polling Cadence
- **D-01:** Business hours polling every 30 minutes (8 AM - 8 PM PT)
- **D-02:** Overnight polling via two fixed cron jobs: midnight PT and 6 AM PT (not interval-based)
- **D-03:** Timezone is America/Los_Angeles, matching the productivity agent's existing heartbeat config
- **D-04:** Use OpenClaw heartbeat for business-hours interval polling + OpenClaw cron for the two fixed overnight polls

### OAuth Scope Strategy
- **D-05:** Request broad scopes upfront in a single consent screen: gmail.readonly, gmail.compose, gmail.modify, calendar.readonly
- **D-06:** gmail.modify included now to avoid re-auth when Phase 4 adds auto-archiving
- **D-07:** OAuth consent screen set to Production mode (not Testing) to avoid 7-day token expiry

### Failure Notifications
- **D-08:** Silent retry first (3 attempts), then Telegram alert if still failing — avoids noise for transient API blips
- **D-09:** Proactive token health monitoring: warn via Telegram 24 hours before token expiry if refresh attempt fails
- **D-10:** Single Telegram alert per failure episode, not per retry attempt

### Account Identity
- **D-11:** Accounts labeled "personal" and "work" throughout the system (state files, memory paths, Telegram messages, config)
- **D-12:** Work account polled first in each heartbeat cycle; if rate limited, work always gets checked before personal
- **D-13:** Separate state files per account: email-sync-personal.json, email-sync-work.json
- **D-14:** Separate memory directories per account: memory/email-patterns/personal/, memory/email-patterns/work/

### Claude's Discretion
- Exact retry backoff strategy (exponential, linear, etc.)
- gog CLI vs direct googleapis for specific operations — use whichever is simpler per operation
- Sync state file format details beyond historyId and lastCheck
- Heartbeat gate check implementation (ollama pre-check vs direct API poll)
- Error message formatting in Telegram alerts

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Agent Configuration
- `config/openclaw.json5` — Comms agent definition, model strategy, provider configs, productivity agent heartbeat pattern (reference for heartbeat setup)
- `config/openclaw-sandbox.yaml` — Egress policy; Google API endpoints already allowlisted
- `agents/comms/SOUL.md` — Comms agent personality, constraints (never auto-send, account labeling)
- `agents/comms/AGENTS.md` — Memory rules, security rules, tool permissions, fallback behavior

### Environment & Auth
- `.env.example` — Current env var template (needs Gmail OAuth vars added)

### Project Docs
- `prd-openclaw-nemoclaw.md` — Original PRD with model strategy, agent definitions, anti-patterns
- `.planning/REQUIREMENTS.md` — GMAIL-01 through GMAIL-07 acceptance criteria
- `.planning/ROADMAP.md` — Phase 1 success criteria and dependency chain

### External References (from STACK.md in CLAUDE.md)
- Gmail API `history.list` — incremental sync primitive, 2 quota units per call
- OpenClaw heartbeat + cron docs — scheduling patterns for interval vs fixed-time
- gog CLI (OpenClaw skill) — Gmail operations, multi-account via `gog auth add`
- Google OAuth2 for Desktop apps — user-credential OAuth flow for headless agents

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `config/openclaw.json5` productivity agent heartbeat config — direct pattern to copy for comms agent heartbeat setup
- `config/openclaw-sandbox.yaml` — egress rules already allow www.googleapis.com:443, oauth2.googleapis.com:443, accounts.google.com:443
- Comms agent already has `skills: ["gmail", "google-calendar"]` configured

### Established Patterns
- Heartbeat scheduling: productivity agent uses cron-based heartbeat with `ollama/qwen2.5:7b` as the heartbeat model
- Environment variables: all API keys in `.env`, loaded by OpenClaw gateway — Gmail OAuth credentials should follow this pattern
- Agent config: JSON5 format with model, fallback, soul, skills, and optional heartbeat sections

### Integration Points
- `openclaw.json5` comms agent section needs heartbeat config added
- `.env.example` needs Gmail OAuth client ID and client secret vars
- New state files at `/sandbox/state/email-sync-personal.json` and `/sandbox/state/email-sync-work.json`
- New memory directories at `memory/email-patterns/personal/` and `memory/email-patterns/work/`

</code_context>

<specifics>
## Specific Ideas

- Overnight polls are cron-based at specific times (12 AM and 6 AM PT), not interval-based — user prefers predictable overnight check-ins over periodic polling
- Work account takes priority in every polling cycle — reflects user's preference for professional responsiveness
- 30-minute business hours interval is deliberately conservative on API quota

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 01-gmail-foundation*
*Context gathered: 2026-03-31*
