---
phase: 01-gmail-foundation
plan: 02
subsystem: auth
tags: [gmail-api, oauth2, google-auth-library, googleapis-gmail, gcp-console]

# Dependency graph
requires:
  - phase: 01-01
    provides: "Gmail egress rules in sandbox policy, OAuth env var template"
provides:
  - "OAuth2 authentication for both Gmail accounts (personal + work)"
  - "Gmail API access verified via messages.list and history.list"
  - "Sync state files initialized with historyId per account"
  - "Memory directories for account-separated email patterns"
  - "gmail-oauth-helper.cjs reusable OAuth helper for direct API calls"
affects: [01-03-PLAN, 02-classification]

# Tech tracking
tech-stack:
  added:
    - "google-auth-library@10.6.2 (OAuth2 token management)"
    - "@googleapis/gmail@16.1.1 (Gmail API client)"
  patterns:
    - "Direct google-auth-library OAuth flow instead of gog CLI (avoids credential conflicts)"
    - "Reusable gmail-oauth-helper.cjs for token acquisition and Gmail API verification"
    - "Per-account sync state JSON files with historyId tracking"

key-files:
  created:
    - scripts/10-gmail-oauth-setup.sh
    - scripts/11-verify-gmail-auth.sh
    - scripts/gmail-oauth-helper.cjs
    - package.json
  modified: []

key-decisions:
  - "Replaced gog CLI with direct google-auth-library + @googleapis/gmail (gog used Odoo OAuth credentials causing 403)"
  - "Created gmail-oauth-helper.cjs as a standalone Node.js OAuth helper for headless token acquisition"
  - "client_secret.json corrected from odoo-sync project to clawbot-492101 GCP project"

patterns-established:
  - "Direct Gmail API via google-auth-library: preferred over gog CLI for custom OAuth flows"
  - "Helper script pattern: reusable .cjs scripts for operations needing Node.js runtime"

requirements-completed: [GMAIL-01, GMAIL-02, GMAIL-06]

# Metrics
duration: ~25min
completed: 2026-04-01
---

# Phase 01 Plan 02: Gmail OAuth Setup Summary

**Gmail OAuth2 authentication for both accounts using direct google-auth-library, replacing gog CLI which had Odoo credential conflicts**

## Performance

- **Duration:** ~25 min (including human checkpoint for OAuth consent)
- **Started:** 2026-04-01
- **Completed:** 2026-04-01
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Both Gmail accounts (personal + work) authenticated via OAuth2 with correct scopes (gmail.readonly, gmail.compose, gmail.modify, calendar.readonly)
- OAuth consent screen confirmed in Production mode (tokens persist beyond 7 days)
- Gmail API access verified: messages.list and history.list working for both accounts
- Sync state files initialized with current historyId per account
- Memory directories created for account-separated email patterns

## Task Commits

Each task was committed atomically:

1. **Task 1: Create Gmail OAuth setup and verification scripts** - `41c73e4` (feat)
2. **Task 2: Complete Gmail OAuth setup (human checkpoint)** - verified by user (human-action)

## Files Created/Modified
- `scripts/10-gmail-oauth-setup.sh` - OAuth setup automation with GCP project guidance and account auth flow
- `scripts/11-verify-gmail-auth.sh` - Verification of Gmail API access, history.list, state files, and memory dirs
- `scripts/gmail-oauth-helper.cjs` - Reusable Node.js helper for OAuth2 token acquisition and Gmail API verification
- `package.json` - Created with google-auth-library and @googleapis/gmail dependencies
- `config/client_secret.json` - Corrected OAuth credentials (clawbot-492101 project)

## Decisions Made
- Replaced gog CLI with direct google-auth-library + @googleapis/gmail because gog was using Odoo's OAuth credentials, causing 403 errors on Gmail API calls
- Created gmail-oauth-helper.cjs as a standalone helper rather than modifying gog internals -- cleaner separation of concerns
- Corrected client_secret.json from odoo-sync project to clawbot-492101 GCP project credentials

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Replaced gog CLI with direct google-auth-library**
- **Found during:** Task 1 / Task 2 (OAuth setup and verification)
- **Issue:** gog CLI used Odoo's OAuth credentials internally, causing 403 errors when attempting Gmail API access. The gog skill's bundled credentials were for a different GCP project (odoo-sync) and could not be overridden cleanly.
- **Fix:** Rewrote scripts to use google-auth-library for OAuth2 token management and @googleapis/gmail for API calls. Created gmail-oauth-helper.cjs as a reusable helper.
- **Files modified:** scripts/10-gmail-oauth-setup.sh, scripts/11-verify-gmail-auth.sh, scripts/gmail-oauth-helper.cjs, package.json
- **Verification:** Both accounts successfully authenticated; 11-verify-gmail-auth.sh passes all checks
- **Committed in:** 41c73e4 (Task 1 commit) + user-verified (Task 2)

**2. [Rule 3 - Blocking] Corrected client_secret.json credentials**
- **Found during:** Task 2 (human checkpoint)
- **Issue:** client_secret.json contained credentials from the odoo-sync GCP project instead of clawbot-492101
- **Fix:** User replaced with correct credentials from the clawbot-492101 GCP project
- **Files modified:** config/client_secret.json
- **Verification:** OAuth flow completed successfully with correct project credentials

**3. [Rule 3 - Blocking] Added npm dependencies**
- **Found during:** Task 1
- **Issue:** google-auth-library and @googleapis/gmail not installed; required for direct API approach
- **Fix:** Created package.json and installed dependencies
- **Files modified:** package.json, package-lock.json
- **Verification:** gmail-oauth-helper.cjs runs successfully with installed packages

---

**Total deviations:** 3 auto-fixed (all Rule 3 - blocking)
**Impact on plan:** All deviations were necessary to work around gog CLI credential conflicts. The direct API approach is actually more robust and gives better control over OAuth flows. No scope creep.

## Issues Encountered
- gog CLI's internal OAuth credentials were tied to an Odoo project, making it unsuitable for custom GCP project OAuth flows. This is a known limitation when the gog skill has pre-configured credentials that conflict with user-specific GCP projects.

## User Setup Required
User completed all setup during Task 2 checkpoint:
- GCP project created (clawbot-492101)
- Gmail API and Google Calendar API enabled
- OAuth consent screen set to Production mode
- OAuth 2.0 Client ID created (Desktop app type)
- client_secret.json downloaded and placed in config/
- Both Gmail accounts authorized via browser OAuth consent

## Next Phase Readiness
- OAuth tokens active and verified for both accounts -- ready for Plan 03 polling integration
- gmail-oauth-helper.cjs available for reuse in polling scripts and custom skill code
- Sync state files initialized with historyId -- Plan 03 can start incremental sync immediately
- google-auth-library and @googleapis/gmail available as project dependencies

## Self-Check: PASSED

- All 5 created files verified on disk
- Task 1 commit (41c73e4) verified in git log

---
*Phase: 01-gmail-foundation*
*Completed: 2026-04-01*
