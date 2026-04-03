---
phase: 03-drafts-delegation
plan: 01
subsystem: email-drafts
tags: [gmail-api, gemini, claude, mime, oauth2, calendar-api, draft-generation]

# Dependency graph
requires:
  - phase: 02-classification-delivery
    provides: classification pipeline, types.js constants, delivery.js patterns, Telegram delivery
  - phase: 01-gmail-foundation
    provides: OAuth tokens, Gmail API access, google-auth-library
provides:
  - Draft text generation routed by category (Gemini routine/calendar, Claude urgent)
  - Gmail draft creation with MIME threading (In-Reply-To/References headers)
  - Draft tracker with dedup, short_key for Telegram callbacks, TTL expiry
  - Calendar conflict detection via Google Calendar freebusy.query
  - Template library for routine acks, calendar RSVPs, follow-ups
  - Draft update-in-place for existing threads (D-18)
affects: [03-02, 03-03, 03-04, telegram-approval, delegation]

# Tech tracking
tech-stack:
  added: [googleapis]
  patterns: [model-routed-drafting, mime-threading, draft-tracker-state, category-based-routing]

key-files:
  created:
    - sandbox/skills/classify-email/draft-generator.js
    - sandbox/skills/classify-email/draft-templates.js
    - sandbox/config/draft-templates.json
    - sandbox/state/draft-tracker.json
  modified:
    - sandbox/skills/classify-email/types.js
    - package.json
    - package-lock.json

key-decisions:
  - "googleapis package added for Google Calendar freebusy.query (calendar conflict detection)"
  - "Draft text routing: routine->Gemini ack, calendar->template RSVP, urgent->Claude smart draft"
  - "short_key = draftId.slice(0,12) stored in tracker for Telegram callback routing"

patterns-established:
  - "Model routing by category: switch on primary category to select Gemini vs Claude"
  - "MIME threading: buildReplyMime with In-Reply-To/References for Gmail conversation threading"
  - "Draft tracker pattern: JSON state file with dedup by threadId, TTL expiry, short_key"
  - "Update-in-place: existing drafts for a thread are updated via drafts.update, not recreated"

requirements-completed: [DRAFT-01, DRAFT-02, DRAFT-03, DRAFT-04, DRAFT-05, DRAFT-07]

# Metrics
duration: 19min
completed: 2026-04-03
---

# Phase 3 Plan 01: Draft Generation Summary

**Gmail draft engine with MIME threading, Gemini/Claude model routing by category, calendar conflict detection, and draft tracker with dedup and TTL expiry**

## Performance

- **Duration:** 19 min
- **Started:** 2026-04-03T19:28:08Z
- **Completed:** 2026-04-03T19:46:59Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments
- Draft text generation routed to correct model: Gemini for routine acks and calendar RSVPs, Claude for urgent smart drafts
- Gmail draft creation with proper MIME threading (In-Reply-To/References headers ensure drafts appear in the right conversation)
- Draft tracker prevents duplicates per thread, stores short_key for Telegram callback routing, and enforces 48-hour TTL with auto-cleanup
- Calendar conflict detection via Google Calendar freebusy.query for RSVP draft generation
- Existing drafts updated in-place rather than duplicated (D-18 compliance)

## Task Commits

Each task was committed atomically:

1. **Task 1: Add draft/delegation constants to types.js and create draft-templates.js with template library** - `24a7ba7` (feat)
2. **Task 2: Create draft-generator.js with Gmail draft creation, MIME threading, calendar conflict detection, and draft tracking** - `d4c8689` (feat)

## Files Created/Modified
- `sandbox/skills/classify-email/types.js` - Extended with DRAFT_CATEGORIES, DELEGATION_ROUTING, CLAUDE_MODEL, TTL constants, state file paths
- `sandbox/skills/classify-email/draft-templates.js` - Template library: Gemini routine ack, template matching, calendar RSVP, Claude smart draft via Anthropic API
- `sandbox/skills/classify-email/draft-generator.js` - Draft engine: OAuth client, MIME construction, Gmail draft CRUD, calendar conflict check, draft tracker, generateDraft orchestrator
- `sandbox/config/draft-templates.json` - Predefined reply templates for routine ack, calendar accept/decline/tentative, follow-up, info request
- `sandbox/state/draft-tracker.json` - Empty initial draft tracker state
- `package.json` - Added googleapis dependency for Calendar API
- `package-lock.json` - Lock file updated

## Decisions Made
- Added `googleapis` package for Google Calendar freebusy.query access -- `@googleapis/gmail` alone doesn't include Calendar API
- Used pure template approach for calendar RSVPs (no Gemini call) since accept/decline/tentative templates are formulaic
- Draft tracker stores `short_key: draftId.slice(0,12)` for Telegram inline keyboard callback routing (consumed by Plan 03 Tasks 1-2)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Installed googleapis package for Calendar API**
- **Found during:** Task 2 (draft-generator.js verification)
- **Issue:** `googleapis` package (needed for `google.calendar`) was not in package.json -- only `@googleapis/gmail` and `google-auth-library` were listed
- **Fix:** Ran `npm install googleapis` to add the full Google APIs client
- **Files modified:** package.json, package-lock.json
- **Verification:** `require('./sandbox/skills/classify-email/draft-generator.js')` loads without error
- **Committed in:** d4c8689 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Essential dependency for Calendar API access. No scope creep.

## Issues Encountered
None beyond the missing googleapis dependency documented above.

## Known Stubs
None -- all functions are fully implemented with real API calls, no placeholder data.

## User Setup Required
None - no external service configuration required. OAuth tokens and client_secret.json from Phase 1 are reused.

## Next Phase Readiness
- Draft generator ready for integration into the classification pipeline (Plan 03-02: Telegram approval UX)
- `generateDraft` and `generateSmartDraft` can be called from `processClassifiedEmails` or a new pipeline stage
- Draft tracker's `short_key` field is ready for Telegram inline keyboard callback routing
- `cleanupExpiredDrafts` ready to be wired into heartbeat cycle

## Self-Check: PASSED

All 6 created files verified on disk. Both task commits (24a7ba7, d4c8689) verified in git log.

---
*Phase: 03-drafts-delegation*
*Completed: 2026-04-03*
