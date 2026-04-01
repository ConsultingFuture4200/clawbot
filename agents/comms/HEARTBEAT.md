# Comms Agent — Email Polling Checklist

## Trigger

This checklist executes on every heartbeat (every 30 minutes, 8 AM-8 PM PT) and on each overnight cron trigger (midnight PT, 6 AM PT).

## Polling Steps

### 1. Work Account First (D-12: work always gets priority)

- Read state: `/sandbox/state/email-sync-work.json`
- Run: `gog gmail history --account WORK_EMAIL --since {historyId}`
- If **success**: update `historyId`, `lastSuccessfulSync`, reset `consecutiveErrors` to 0
- If **404** (stale historyId): full sync fallback — `gog gmail messages search "in:inbox newer_than:1d" --max 50 --account WORK_EMAIL` — store new historyId from response
- If **error** (network, auth, rate limit): increment `consecutiveErrors`, store error in `lastError`
- If **rate limited**: set `rateLimited: true` in state — skip personal account this cycle
- Write updated state to `/sandbox/state/email-sync-work.json`

### 2. Personal Account Second

- **Skip if** work account was rate-limited this cycle (D-12: work gets priority)
- Read state: `/sandbox/state/email-sync-personal.json`
- Run: `gog gmail history --account PERSONAL_EMAIL --since {historyId}`
- Same success/404/error handling as work account
- Write updated state to `/sandbox/state/email-sync-personal.json`

### 3. Token Health Check (D-09)

For each account:
- Verify OAuth token is refreshable (gog handles auto-refresh)
- If refresh fails with `invalid_grant`: token is revoked or expired
  - Record `tokenHealthy: false` and `tokenLastRefreshFailed` timestamp in state file
  - If this is the first failure: silent (D-08: retry first)
  - If failing for 3+ consecutive heartbeats: send ONE Telegram alert (D-10)
    - Message: "[account] Gmail OAuth token refresh failing. Re-authentication may be needed. Check GCP Console."
  - If failing for 24+ hours: escalate alert (D-09)
    - Message: "URGENT: [account] Gmail token has been failing for 24h+. Re-auth required to restore email polling."

### 4. Error Escalation (D-08, D-10)

- If either account has `consecutiveErrors >= 3`:
  - Send ONE Telegram alert per failure episode (D-10: not per retry)
  - Message: "[account] email sync has failed {consecutiveErrors} times. Last error: {lastError}"
  - Do NOT re-alert until error count crosses next threshold (6, 9, etc.) or a successful sync resets the counter
- On successful sync: reset `consecutiveErrors` to 0, clear `lastError`

### 5. Report

- If new messages found: log message count per account (Phase 2 will classify these)
- If nothing needs attention: HEARTBEAT_OK
- If any errors: log error summary

## State File Format

Each account has a state file at `/sandbox/state/email-sync-{account}.json`:

```json
{
  "account": "personal",
  "email": "user@gmail.com",
  "historyId": null,
  "lastSuccessfulSync": null,
  "lastAttempt": null,
  "lastError": null,
  "consecutiveErrors": 0,
  "tokenHealthy": true,
  "tokenLastRefreshed": null,
  "tokenLastRefreshFailed": null
}
```

## Account Separation (D-11, D-14)

- NEVER mix account data in the same API call or state file
- Each account has its own gog auth profile, state file, and memory directory
- Memory paths: `memory/email-patterns/personal/`, `memory/email-patterns/work/`
- State paths: `/sandbox/state/email-sync-personal.json`, `/sandbox/state/email-sync-work.json`
