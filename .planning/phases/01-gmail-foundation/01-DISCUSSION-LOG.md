# Phase 1: Gmail Foundation - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-03-31
**Phase:** 01-gmail-foundation
**Areas discussed:** Polling cadence, OAuth scope strategy, Failure notifications, Account identity

---

## Polling Cadence

### Business Hours Interval

| Option | Description | Selected |
|--------|-------------|----------|
| Every 5 minutes | Near-realtime, ~240 polls/day per account during business hours | |
| Every 10 minutes | Good balance, ~100 polls/day, matches STACK.md suggestion | |
| Every 15 minutes | Conservative, lower quota usage | |

**User's choice:** Every 30 minutes (free-text — more conservative than any presented option)
**Notes:** User deliberately chose a very quota-conservative interval.

### Business Hours Window

| Option | Description | Selected |
|--------|-------------|----------|
| 9 AM - 6 PM | Standard business day | |
| 8 AM - 8 PM | Extended hours | ✓ |
| 7 AM - 10 PM | Most of waking hours | |

**User's choice:** 8 AM - 8 PM
**Notes:** None

### Timezone

| Option | Description | Selected |
|--------|-------------|----------|
| America/Los_Angeles (PT) | Matches productivity agent's existing heartbeat timezone | ✓ |
| America/New_York (ET) | Eastern time | |
| UTC | Timezone-neutral | |

**User's choice:** America/Los_Angeles (PT)
**Notes:** Consistency with existing productivity agent config.

### Off-Hours Polling

| Option | Description | Selected |
|--------|-------------|----------|
| Every 3 hours | Catches overnight emails a couple of times | |
| Every hour | More responsive at night | |
| Don't poll overnight | Zero overnight polling | |

**User's choice:** Two fixed cron jobs at 12 AM and 6 AM PT (free-text — cron-based, not interval-based)
**Notes:** User prefers predictable fixed-time overnight checks over interval polling.

---

## OAuth Scope Strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Broad upfront | gmail.readonly + gmail.compose + gmail.modify + calendar.readonly. One consent screen. | ✓ |
| Narrow now, expand later | gmail.readonly + gmail.compose + calendar.readonly only. Re-auth needed for Phase 4. | |
| Full access | Full Gmail scope (mail.google.com). Maximum flexibility, riskier if tokens leak. | |

**User's choice:** Broad upfront
**Notes:** Avoids re-auth when Phase 4 adds auto-archiving.

---

## Failure Notifications

### General Failure Handling

| Option | Description | Selected |
|--------|-------------|----------|
| Silent retry, then notify | Retry 3 times silently, then Telegram alert | ✓ |
| Notify immediately | Any failure triggers Telegram alert right away | |
| Silent retry only | Keep retrying silently, no alerts | |

**User's choice:** Silent retry, then notify
**Notes:** None

### Token Health Monitoring

| Option | Description | Selected |
|--------|-------------|----------|
| Proactive warning | Warn via Telegram 24h before expiry if refresh fails | ✓ |
| Reactive only | Only alert when refresh actually fails | |

**User's choice:** Proactive warning
**Notes:** Aligns with GMAIL-06 requirement for proactive token refresh monitoring.

---

## Account Identity

### Labeling

| Option | Description | Selected |
|--------|-------------|----------|
| "personal" / "work" | Short, clear, consistent with SOUL.md and AGENTS.md | ✓ |
| By email address | Unambiguous but verbose | |
| Custom nicknames | User-chosen labels | |

**User's choice:** "personal" / "work"
**Notes:** Matches existing terminology in SOUL.md and AGENTS.md.

### Priority

| Option | Description | Selected |
|--------|-------------|----------|
| Equal priority | Both accounts polled in same cycle, no preference | |
| Work first | Work polled first; if rate limited, work always checked first | ✓ |
| Personal first | Personal polled first | |

**User's choice:** Work first
**Notes:** Reflects user's preference for professional responsiveness.

---

## Claude's Discretion

- Retry backoff strategy
- gog CLI vs direct googleapis per operation
- Sync state file format details
- Heartbeat gate check implementation
- Error message formatting

## Deferred Ideas

None — discussion stayed within phase scope
