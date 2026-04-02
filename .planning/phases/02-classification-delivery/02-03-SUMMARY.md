---
phase: 02-classification-delivery
plan: 03
subsystem: notification
tags: [telegram, html, digest, batch-buffer, delivery, reply-handler]

# Dependency graph
requires:
  - phase: 02-classification-delivery/02-01
    provides: "Shared constants (CATEGORIES, CONFIDENCE_THRESHOLDS), getConfidenceTier utility"
  - phase: 02-classification-delivery/02-02
    provides: "classifyPipeline output shape with categories, confidence, delivery routing"
provides:
  - "Telegram digest formatter with HTML parse mode and message splitting"
  - "Batch buffer for smart 3-hour batching of non-urgent emails"
  - "Urgent standalone notification for immediate delivery"
  - "Numbered reply handler mapping digest numbers to specific emails"
  - "Digest map with 48-hour auto-pruning"
affects: [03-drafts-delegation, 04-intelligence-layer]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "HTML parse mode for all Telegram messages (not MarkdownV2)"
    - "Message splitting at 4000 chars with continuous numbering"
    - "State files in /sandbox/state/ for batch buffer and digest map"
    - "Work account processed before personal (D-12)"

key-files:
  created:
    - sandbox/skills/classify-email/digest-formatter.js
    - sandbox/skills/classify-email/delivery.js
    - sandbox/state/batch-buffer.json
    - sandbox/state/digest-map.json
  modified: []

key-decisions:
  - "HTML parse mode over MarkdownV2 — only 3 chars to escape vs 19+"
  - "4000 char limit (96 char safety margin from 4096 Telegram limit)"
  - "48-hour digest map pruning to prevent unbounded state growth"
  - "Buffered emails stored with full classification for re-formatting flexibility"

patterns-established:
  - "Telegram message format: account header + numbered entries + footer"
  - "Async telegramSendFn callback pattern for testability (no direct API coupling)"
  - "State file load/save pattern with JSON serialization to /sandbox/state/"

requirements-completed: [TGRAM-01, TGRAM-02, TGRAM-03, TGRAM-04, TGRAM-05, TGRAM-06]

# Metrics
duration: 5min
completed: 2026-04-02
---

# Phase 2 Plan 3: Telegram Digest & Delivery Summary

**HTML digest formatter with 4000-char splitting, 3-hour batch buffer, urgent standalone notifications, and numbered reply handler for email selection**

## Performance

- **Duration:** 5 min
- **Started:** 2026-04-02T16:12:35Z
- **Completed:** 2026-04-02T16:17:06Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Digest formatter produces HTML-formatted Telegram messages with account headers, category tags, and continuous numbering across message splits
- Delivery orchestrator routes urgent emails to immediate standalone notifications and batches non-urgent emails on a 3-hour cycle
- Numbered reply handler resolves user selections back to specific emails via digest-map.json with 24-hour expiry and 48-hour pruning
- All error states (Gemini API, Ollama offline, Gmail API, rate limit) produce user-friendly messages per UI-SPEC

## Task Commits

Each task was committed atomically:

1. **Task 1: Create Telegram digest formatter with HTML parse mode** - `312b85e` (feat)
2. **Task 2: Create delivery orchestrator with batch buffer and reply handler** - `1b1cb81` (feat)

## Files Created/Modified
- `sandbox/skills/classify-email/digest-formatter.js` - HTML message formatting: formatDigest, formatUrgentNotification, formatEmptyState, formatErrorState, escapeHtml
- `sandbox/skills/classify-email/delivery.js` - Batch buffer management, digest sending, urgent notifications, reply handler, processClassifiedEmails pipeline
- `sandbox/state/batch-buffer.json` - Per-account email accumulator with last_digest_sent timestamps
- `sandbox/state/digest-map.json` - Telegram message ID to email number mapping for reply handling

## Decisions Made
- Used async telegramSendFn callback pattern instead of direct Telegram API coupling -- enables unit testing without mock servers
- Stored full classification data in batch buffer (not just references) so digests can be re-formatted without re-classifying
- Digest map keyed by first Telegram message ID of multi-message digests for simple reply lookup

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Known Stubs

None - all functions are fully implemented with real logic.

## Next Phase Readiness
- Delivery pipeline complete: classifyPipeline output can now flow through processClassifiedEmails to reach users via Telegram
- Ready for Phase 3 (Drafts & Delegation) to wire draft creation and agent delegation on top of the reply handler
- Ready for heartbeat integration to trigger periodic shouldSendDigest checks

## Self-Check: PASSED

All 4 created files verified on disk. Both task commits (312b85e, 1b1cb81) verified in git log.

---
*Phase: 02-classification-delivery*
*Completed: 2026-04-02*
