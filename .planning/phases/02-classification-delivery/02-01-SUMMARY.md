---
phase: 02-classification-delivery
plan: 01
subsystem: classification
tags: [gemini, structured-output, json-schema, few-shot, ollama, email-classification]

# Dependency graph
requires:
  - phase: 01-gmail-foundation
    provides: "Gmail OAuth, @googleapis/gmail, google-auth-library, .env.example with GEMINI_API_KEY"
provides:
  - "Gemini responseSchema for 7-category email classification"
  - "21 few-shot labeled examples covering all 7 categories"
  - "types.js shared module with constants, prompt builders, confidence tier logic"
  - "@google/genai SDK installed and importable"
affects: [02-02, 02-03, 02-04]

# Tech tracking
tech-stack:
  added: ["@google/genai ^1.48.0"]
  patterns: ["Gemini structured JSON output with responseSchema", "few-shot classification prompt engineering", "two-stage pipeline contracts (Ollama spam gate + Gemini classifier)"]

key-files:
  created:
    - sandbox/config/classification-schema.json
    - sandbox/config/classification-examples.json
    - sandbox/skills/classify-email/types.js
  modified:
    - package.json
    - package-lock.json

key-decisions:
  - "Used @google/genai (v1.48.0) not deprecated @google/generative-ai"
  - "21 few-shot examples (3 per category) with multi-label urgent examples demonstrating co-occurrence"
  - "Confidence tiers: >0.85 auto_label, 0.70-0.84 act_and_confirm, <0.70 ask_user"
  - "Schema uses email_index integer for batch correlation (Pitfall 6 mitigation)"

patterns-established:
  - "Classification contracts defined as JSON Schema files loaded at runtime from /sandbox/config/"
  - "Shared constants and prompt builders in types.js, CommonJS exports"
  - "Few-shot examples as static curated JSON, not auto-growing"

requirements-completed: [CLASS-01, CLASS-02, CLASS-03, CLASS-06]

# Metrics
duration: 17min
completed: 2026-04-02
---

# Phase 2 Plan 01: Classification Contracts & Schema Summary

**Gemini responseSchema with 7-category enum, 21 few-shot examples, and shared types module exporting constants, prompt builders, and confidence tier logic**

## Performance

- **Duration:** 17 min
- **Started:** 2026-04-02T15:25:05Z
- **Completed:** 2026-04-02T15:42:25Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Installed @google/genai SDK (v1.48.0) for Gemini structured output, verified CommonJS import
- Created classification-schema.json defining 7-category enum with multi-label, confidence scores, chain-of-thought reasoning, and is_urgent flag
- Created 21 few-shot examples (3 per category) with realistic email metadata, including multi-label urgent examples
- Built types.js shared module with CATEGORIES, CONFIDENCE_THRESHOLDS, BATCH_SIZE, prompt builders, and getConfidenceTier utility

## Task Commits

Each task was committed atomically:

1. **Task 1: Install @google/genai and add GEMINI_API_KEY verification** - `376ca05` (chore)
2. **Task 2: Create classification schema, few-shot examples, and shared types module** - `acfa8fa` (feat)

## Files Created/Modified
- `package.json` - Added @google/genai ^1.48.0 dependency
- `package-lock.json` - Lockfile for reproducible installs
- `sandbox/config/classification-schema.json` - Gemini responseSchema with 7-category enum, multi-label support, CoT reasoning
- `sandbox/config/classification-examples.json` - 21 few-shot labeled examples (3 per category)
- `sandbox/skills/classify-email/types.js` - Shared constants (CATEGORIES, CONFIDENCE_THRESHOLDS, BATCH_SIZE), prompt builders (buildClassificationPrompt, buildSpamGatePrompt), loaders, and getConfidenceTier utility

## Decisions Made
- Used @google/genai (v1.48.0) as the current actively maintained SDK, not the deprecated @google/generative-ai
- Created 21 examples (maximum per D-06 range of 14-21) to maximize few-shot coverage
- Multi-label urgent examples demonstrate co-occurrence (urgent+code, urgent+calendar, urgent-standalone)
- Schema uses email_index integer field for batch correlation, mitigating Pitfall 6 (batch size mismatch)
- File paths in types.js use /sandbox/config/ prefix for sandbox runtime environment

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required. GEMINI_API_KEY already templated in .env.example from Phase 1.

## Next Phase Readiness
- Classification contracts ready for Plan 02-02 (Gemini classifier implementation) to import types.js and use schema/examples
- Plan 02-03 (Ollama spam gate) can use buildSpamGatePrompt from types.js
- Plan 02-04 (Telegram digest) can use CATEGORIES and getConfidenceTier from types.js

## Self-Check: PASSED

All 5 created files verified present on disk. Both task commits (376ca05, acfa8fa) verified in git log.

---
*Phase: 02-classification-delivery*
*Completed: 2026-04-02*
