---
phase: 01-gmail-foundation
plan: 01
subsystem: infra
tags: [gmail-api, egress-policy, heartbeat, cron, sandbox, oauth]

# Dependency graph
requires: []
provides:
  - "gmail.googleapis.com:443 egress rule in sandbox policy"
  - "Comms agent heartbeat config (30m interval, 8AM-8PM PT)"
  - "Comms agent overnight cron (midnight + 6AM PT)"
  - "Gmail OAuth env var template (.env.example)"
  - "HEARTBEAT.md polling checklist with work-first priority"
affects: [01-02-PLAN, 01-03-PLAN, 02-classification]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "heartbeat + cron dual scheduling (interval for business hours, fixed cron for overnight)"
    - "work-first account priority with rate-limit skip"
    - "tiered error escalation (silent retry -> alert -> urgent)"

key-files:
  created:
    - agents/comms/HEARTBEAT.md
  modified:
    - config/openclaw-sandbox.yaml
    - config/openclaw.json5
    - .env.example

key-decisions:
  - "gmail.googleapis.com added separately from www.googleapis.com (googleapis npm uses different root URL)"
  - "30m heartbeat interval during business hours, 2 overnight crons at midnight and 6AM PT"
  - "Work account polled first; personal skipped if work rate-limited"

patterns-established:
  - "Heartbeat polling checklist pattern: HEARTBEAT.md as agent instruction set"
  - "Account separation: separate state files, memory dirs, polling order"
  - "Error escalation: 3 silent retries, then single Telegram alert per episode"

requirements-completed: [GMAIL-04, GMAIL-05, GMAIL-07]

# Metrics
duration: 2min
completed: 2026-04-01
---

# Phase 01 Plan 01: Sandbox Egress & Polling Config Summary

**Gmail egress rule, comms heartbeat/cron scheduling, OAuth env template, and HEARTBEAT.md polling checklist with work-first priority and tiered error escalation**

## Performance

- **Duration:** 2 min
- **Started:** 2026-04-01T16:39:14Z
- **Completed:** 2026-04-01T16:41:39Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Sandbox egress policy now allows gmail.googleapis.com:443 (required for googleapis npm and gog CLI)
- Comms agent configured with 30-minute heartbeat during business hours + 2 overnight cron jobs
- HEARTBEAT.md defines the complete polling checklist: work-first priority, token health monitoring, error escalation, account separation
- .env.example documents Gmail OAuth client ID/secret with Production mode warning

## Task Commits

Each task was committed atomically:

1. **Task 1: Update sandbox egress policy and environment template** - `016dd9b` (feat)
2. **Task 2: Configure comms agent heartbeat, cron, and create HEARTBEAT.md** - `12ee3d4` (feat)

## Files Created/Modified
- `config/openclaw-sandbox.yaml` - Added gmail.googleapis.com:443 egress rule
- `.env.example` - Added Gmail OAuth2 section with client ID/secret vars and setup instructions
- `config/openclaw.json5` - Added heartbeat and cron config to comms agent
- `agents/comms/HEARTBEAT.md` - Email polling checklist with work-first priority, token health, error escalation

## Decisions Made
- Added gmail.googleapis.com as a separate egress entry (googleapis npm rootUrl differs from www.googleapis.com)
- Used 30-minute heartbeat interval during 8AM-8PM PT for business hours polling
- Added two overnight cron entries (midnight and 6AM PT) instead of reduced-frequency heartbeat
- Work account always polled first; personal account skipped if work is rate-limited (D-12)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required. OAuth setup will be handled in Plan 02.

## Next Phase Readiness
- Egress policy ready for Gmail API calls (Plan 02 OAuth authentication)
- Heartbeat and cron config ready for activation once OAuth is wired up (Plan 03 verification)
- HEARTBEAT.md provides the polling behavior specification that Plan 03 will test end-to-end

## Self-Check: PASSED

- All 4 created/modified files verified on disk
- Both task commits (016dd9b, 12ee3d4) verified in git log

---
*Phase: 01-gmail-foundation*
*Completed: 2026-04-01*
