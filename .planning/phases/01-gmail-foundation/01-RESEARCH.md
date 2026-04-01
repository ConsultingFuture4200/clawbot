# Phase 1: Gmail Foundation - Research

**Researched:** 2026-04-01
**Domain:** Gmail API OAuth2, incremental sync, OpenClaw heartbeat/cron scheduling
**Confidence:** HIGH

## Summary

Phase 1 establishes the Gmail plumbing: OAuth2 authentication for two accounts, incremental email sync via `history.list`, heartbeat-driven polling during business hours, cron-based overnight checks, and strict account separation. All technology is already deployed (OpenClaw, NemoClaw, Telegram, Ollama) -- this phase adds Gmail-specific configuration and a small amount of custom skill code.

The critical technical risks are (1) the OAuth consent screen testing-vs-production trap that causes 7-day token expiry, (2) the `gmail.googleapis.com` endpoint that must be added to the sandbox egress policy (the current policy only allows `www.googleapis.com`), and (3) known OpenClaw heartbeat interval bugs that can cause rapid-fire polling if not guarded against. All three have clear mitigations documented below.

**Primary recommendation:** Use gog CLI for most Gmail operations (auth, messages, drafts, labels) and only drop to the `googleapis` npm package for `history.list` incremental sync, which gog supports via `gog gmail history --since <historyId>`. Configure heartbeat with `activeHours` for business-hours polling and two separate cron entries for overnight checks.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Business hours polling every 30 minutes (8 AM - 8 PM PT)
- **D-02:** Overnight polling via two fixed cron jobs: midnight PT and 6 AM PT (not interval-based)
- **D-03:** Timezone is America/Los_Angeles, matching the productivity agent's existing heartbeat config
- **D-04:** Use OpenClaw heartbeat for business-hours interval polling + OpenClaw cron for the two fixed overnight polls
- **D-05:** Request broad scopes upfront in a single consent screen: gmail.readonly, gmail.compose, gmail.modify, calendar.readonly
- **D-06:** gmail.modify included now to avoid re-auth when Phase 4 adds auto-archiving
- **D-07:** OAuth consent screen set to Production mode (not Testing) to avoid 7-day token expiry
- **D-08:** Silent retry first (3 attempts), then Telegram alert if still failing -- avoids noise for transient API blips
- **D-09:** Proactive token health monitoring: warn via Telegram 24 hours before token expiry if refresh attempt fails
- **D-10:** Single Telegram alert per failure episode, not per retry attempt
- **D-11:** Accounts labeled "personal" and "work" throughout the system (state files, memory paths, Telegram messages, config)
- **D-12:** Work account polled first in each heartbeat cycle; if rate limited, work always gets checked before personal
- **D-13:** Separate state files per account: email-sync-personal.json, email-sync-work.json
- **D-14:** Separate memory directories per account: memory/email-patterns/personal/, memory/email-patterns/work/

### Claude's Discretion
- Exact retry backoff strategy (exponential, linear, etc.)
- gog CLI vs direct googleapis for specific operations -- use whichever is simpler per operation
- Sync state file format details beyond historyId and lastCheck
- Heartbeat gate check implementation (ollama pre-check vs direct API poll)
- Error message formatting in Telegram alerts

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| GMAIL-01 | Authenticate both Gmail accounts via OAuth2 with gmail.readonly, gmail.compose, calendar.readonly scopes | gog CLI `gog auth add` handles OAuth flow; D-05/D-06 add gmail.modify; Desktop app type with PKCE; Production mode consent screen |
| GMAIL-02 | OAuth consent screen set to Production mode to avoid 7-day token expiry | Verified: Testing mode expires refresh tokens in 7 days; must create NEW credentials after switching to Production; click through "unverified app" warning |
| GMAIL-03 | Poll Gmail via history.list incremental sync with persisted historyId per account | gog CLI supports `gog gmail history --since <historyId>`; historyId valid ~1 week; 404 triggers full sync fallback; 2 quota units per call |
| GMAIL-04 | Polling on heartbeat schedule with adaptive cadence | Heartbeat `every: "30m"` with `activeHours: {start: "08:00", end: "20:00"}` for business hours; two cron entries for overnight; known heartbeat bugs require monitoring |
| GMAIL-05 | Personal and work account data structurally separated | Separate state files, separate memory dirs, separate gog auth profiles, separate OAuth2Client instances, work polled first per D-12 |
| GMAIL-06 | OAuth token health monitored with proactive refresh before expiry | google-auth-library auto-refreshes access tokens; monitor refresh token validity; Telegram alert if refresh fails per D-09 |
| GMAIL-07 | gmail.googleapis.com added to sandbox egress policy | CRITICAL: Current policy only has www.googleapis.com; the googleapis npm library uses gmail.googleapis.com as rootUrl; must add to openclaw-sandbox.yaml |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

- **Keys in .env only** -- never in openclaw.json or git
- **Heartbeats use Ollama only** -- never burn cloud quota on pings
- **Agents cannot modify their own config, auth, or SOUL.md**
- **Comms agent never auto-sends** -- always requires Telegram confirmation
- **No Docker Desktop** -- use Docker Engine directly in WSL2
- **No large local models** -- Pascal GPUs can't handle it
- **Gemini is the workhorse** -- Codex quota is scarce (5hr/week)
- Anti-patterns: hardcoding API keys, heartbeats on cloud providers, single-provider dependency

## Standard Stack

### Core (Already Deployed)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| OpenClaw | 2026.2.x (latest stable) | Agent framework, heartbeat scheduler, cron | Already deployed and operational |
| NemoClaw / OpenShell | Latest stable | Sandbox, egress policy | Already deployed; egress needs gmail.googleapis.com added |
| Node.js | 22+ | Runtime | Already installed in WSL2 |
| gog CLI | Built-in (openclaw/skills/gog) | Gmail OAuth, messages, drafts, labels, history | OpenClaw's official Google Workspace CLI; already in comms agent skills |

### Supporting (To Install/Configure)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| googleapis (npm) | 171.4.0 | Direct Gmail API access | Only if gog CLI lacks a needed operation (likely not needed for Phase 1) |
| google-auth-library (npm) | 10.6.2 | OAuth2 token management, multi-account | For proactive token health monitoring and refresh logic in custom skill code |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| gog CLI | Raw googleapis npm | gog handles auth, multi-account, JSON output natively; raw API adds code but gives full control over history.list params |
| Heartbeat polling | Gmail Pub/Sub push | Push requires inbound HTTPS endpoint; sandbox doesn't expose ports; polling is adequate for 2 accounts |
| JSON state files | SQLite | JSON files are perfectly adequate for 2 accounts; SQLite adds unnecessary dependency |

**Installation (if needed):**
```bash
# Only if gog CLI cannot handle history.list adequately
cd /sandbox && npm install googleapis@171.4.0 google-auth-library@10.6.2
```

## Architecture Patterns

### Recommended File Structure
```
/sandbox/
  config/
    client_secret.json        # OAuth client credentials (from GCP Console)
  state/
    email-sync-personal.json  # historyId, lastCheck, lastError, consecutiveErrors
    email-sync-work.json      # Same structure, work account
  memory/
    email-patterns/
      personal/               # Per-account memory (Phase 4 uses these)
      work/
agents/
  comms/
    SOUL.md                   # Already exists
    AGENTS.md                 # Already exists
    HEARTBEAT.md              # NEW: heartbeat checklist for email polling
config/
  openclaw.json5              # Comms agent heartbeat config added
  openclaw-sandbox.yaml       # gmail.googleapis.com added to egress
.env.example                  # Gmail OAuth vars added
```

### Pattern 1: Heartbeat + Cron Combined Scheduling
**What:** Use OpenClaw heartbeat with `activeHours` for business-hours interval polling and separate cron entries for overnight fixed-time checks.
**When to use:** When you need different polling cadences for different time windows.
**Example:**
```json5
// In openclaw.json5, comms agent section
"comms": {
  // ... existing config ...
  "heartbeat": {
    "enabled": true,
    "every": "30m",
    "model": "ollama/qwen2.5:7b",  // Local model for gate check
    "activeHours": {
      "start": "08:00",
      "end": "20:00",
      "timezone": "America/Los_Angeles"
    }
  },
  "cron": [
    {
      "cron": "0 0 * * *",
      "tz": "America/Los_Angeles",
      "task": "overnight-email-check-midnight"
    },
    {
      "cron": "0 6 * * *",
      "tz": "America/Los_Angeles",
      "task": "overnight-email-check-morning"
    }
  ]
}
```

### Pattern 2: Sync State File Format
**What:** JSON file tracking per-account sync state with error tracking for retry logic.
**When to use:** Every heartbeat and cron poll reads and writes this file.
**Example:**
```json
{
  "account": "personal",
  "email": "user@gmail.com",
  "historyId": "12345678",
  "lastSuccessfulSync": "2026-04-01T10:30:00Z",
  "lastAttempt": "2026-04-01T11:00:00Z",
  "lastError": null,
  "consecutiveErrors": 0,
  "tokenExpiresAt": "2026-04-01T11:30:00Z",
  "tokenRefreshFailedAt": null
}
```

### Pattern 3: Account-Separated Polling Loop
**What:** Work account polled first in every cycle (D-12), each account uses its own gog auth profile, state file, and error tracking.
**When to use:** Every heartbeat and cron trigger.
**Example:**
```
HEARTBEAT.md checklist:
1. Check work account for new email (gog gmail history --account work@domain.com --since <historyId>)
2. If work rate-limited, skip personal this cycle (D-12: work always gets priority)
3. Check personal account for new email (gog gmail history --account user@gmail.com --since <historyId>)
4. Update state files with new historyId values
5. If any sync failed 3+ consecutive times, send Telegram alert (D-08, D-10)
6. Check token health: if refresh token near expiry, warn via Telegram (D-09)
```

### Pattern 4: Proactive Token Health Monitoring
**What:** On each heartbeat, check token expiry timestamps. If access token expires soon, trigger refresh. If refresh token itself is failing, alert user 24 hours before it becomes critical.
**When to use:** Every polling cycle includes a token health check.
**Example:**
```javascript
// Token health check (simplified)
const tokenInfo = await oauth2Client.getAccessToken();
const expiresAt = oauth2Client.credentials.expiry_date;
const now = Date.now();
const hoursUntilExpiry = (expiresAt - now) / (1000 * 60 * 60);

// Access token: auto-refresh is handled by google-auth-library
// Refresh token: monitor for "invalid_grant" errors
if (lastRefreshError && lastRefreshError.includes("invalid_grant")) {
  // Refresh token revoked or expired -- alert immediately
  sendTelegramAlert("OAuth refresh token for {account} is invalid. Re-auth needed.");
}
```

### Anti-Patterns to Avoid
- **Polling with messages.list instead of history.list:** Costs 5 quota units vs 2, returns all messages instead of just changes, no incremental sync.
- **Sharing OAuth2Client instances between accounts:** Creates data leakage risk; each account MUST have its own client instance.
- **Storing historyId in memory only:** If gateway restarts, you lose sync position and must do full sync. Always persist to disk.
- **Using cloud model for heartbeat gate checks:** Violates CLAUDE.md constraint "Heartbeats use Ollama only."
- **Hardcoding credentials in openclaw.json5:** Keys belong in .env only.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| OAuth2 token refresh | Custom HTTP refresh logic | google-auth-library `OAuth2Client` | Handles token lifecycle, auto-refresh, error classification; edge cases around token revocation are complex |
| Gmail message retrieval | Custom REST client | gog CLI `gog gmail messages` or `googleapis` npm | Auth headers, pagination, quota tracking already handled |
| Cron scheduling | Node.js `setInterval` or `node-cron` | OpenClaw built-in cron + heartbeat | Already integrated with agent lifecycle, model selection, active hours |
| Telegram notifications | Custom Bot API wrapper | OpenClaw Telegram channel binding | Already configured and operational; comms agent just emits messages |
| Retry with backoff | Custom retry loop | Exponential backoff in heartbeat error handling | Keep it in HEARTBEAT.md logic; OpenClaw's retry mechanism handles transient failures |

**Key insight:** Phase 1 is primarily configuration and a HEARTBEAT.md file, not a large codebase. The gog CLI and OpenClaw's heartbeat/cron handle most of the heavy lifting. Custom code is only needed for sync state management and token health monitoring.

## Common Pitfalls

### Pitfall 1: Testing Mode 7-Day Token Expiry
**What goes wrong:** OAuth refresh tokens expire after 7 days, breaking unattended polling.
**Why it happens:** Google Cloud Console consent screen left in "Testing" publishing status. Testing mode enforces 7-day refresh token expiry.
**How to avoid:** Set consent screen to "Production" (D-07). Create NEW OAuth credentials after switching -- old credentials from Testing mode may still expire. Click through the "unverified app" warning during initial consent (safe for personal use with restricted scopes).
**Warning signs:** `invalid_grant` error exactly 7 days after initial authorization.

### Pitfall 2: Missing gmail.googleapis.com in Egress Policy
**What goes wrong:** Gmail API calls fail silently or with connection errors inside the NemoClaw sandbox.
**Why it happens:** The `googleapis` npm library (and gog CLI) makes requests to `gmail.googleapis.com`, not `www.googleapis.com`. The current egress policy only allows `www.googleapis.com`.
**How to avoid:** Add `gmail.googleapis.com:443` to `openclaw-sandbox.yaml` egress allowed list. Also verify that `www.googleapis.com` is still needed (it handles auth scope URLs and some legacy endpoints).
**Warning signs:** API calls work outside sandbox but fail inside; `openshell term` shows blocked requests to gmail.googleapis.com.

### Pitfall 3: Heartbeat Interval Collapse
**What goes wrong:** Heartbeats fire every 1-2 minutes instead of the configured 30-minute interval, burning Ollama resources and potentially triggering rate limits.
**Why it happens:** Known OpenClaw bug (issue #14440, fixed in PR #19745, but regression reported in issue #27807). Heartbeat interval check is bypassed when triggered by non-timer events (exec completions, cron wakes).
**How to avoid:** Ensure OpenClaw is on latest 2026.2.x. Monitor heartbeat frequency during initial deployment using `openshell term`. If interval collapses, restart gateway as temporary fix.
**Warning signs:** Multiple heartbeat log entries within minutes of each other; Ollama inference load higher than expected.

### Pitfall 4: historyId Staleness and Full Sync Fallback
**What goes wrong:** history.list returns 404, forcing a full sync that fetches all messages.
**Why it happens:** historyId is typically valid for at least a week but can become stale in rare cases (a few hours). A gateway restart after extended downtime can trigger this.
**How to avoid:** Handle 404 gracefully: perform a full sync (messages.list, fetch latest messages, store new historyId), log the event, but do NOT alert user (this is expected behavior). Ensure historyId is written to disk after every successful poll.
**Warning signs:** Unexpected spike in quota usage from full sync; "404" in sync state lastError field.

### Pitfall 5: Heartbeat-Cron Collision on Ollama
**What goes wrong:** A cron job and heartbeat fire simultaneously, competing for the local Ollama instance.
**Why it happens:** Known issue (openclaw/openclaw#50773). Heartbeat runner ignores the cron lane when checking if resources are busy.
**How to avoid:** Set `heartbeat.skipWhenBusy: true` in the comms agent config if supported in current version. As a safety net, HEARTBEAT.md should include a check: "If cron job is currently executing, skip this heartbeat cycle."
**Warning signs:** Ollama responses become slow; heartbeat times out; duplicate polling runs.

### Pitfall 6: OAuth Scope Mismatch Between gog and Direct API
**What goes wrong:** gog CLI auth succeeds with requested scopes but direct API calls fail because the stored tokens have different scope sets.
**Why it happens:** gog stores tokens internally at `~/.config/gog/`. If you also create separate OAuth2Client instances with google-auth-library, they use different token stores.
**How to avoid:** For Phase 1, prefer gog CLI for all operations. If direct API access is needed, share the same refresh token from gog's token store or authenticate once with the superset of scopes needed.
**Warning signs:** gog commands work but custom code gets 403 "Insufficient Permission" errors.

### Pitfall 7: Stale Credentials After Testing-to-Production Switch
**What goes wrong:** Even after setting consent screen to Production, tokens still expire in 7 days.
**Why it happens:** OAuth credentials (client_secret.json) created while the app was in Testing mode may be tainted. Multiple sources report needing to create entirely new credentials after the switch.
**How to avoid:** After setting publishing status to Production, create a NEW OAuth client ID and download a fresh client_secret.json. Re-authenticate both accounts with the new credentials. Delete the old ones from GCP Console.
**Warning signs:** `invalid_grant` error ~7 days after auth despite Production status.

## Code Examples

### OAuth2 Setup with gog CLI
```bash
# Source: gog SKILL.md on GitHub
# Step 1: Load client credentials
gog auth credentials /sandbox/config/client_secret.json

# Step 2: Add personal account (opens browser for consent)
gog auth add personaluser@gmail.com --services gmail,calendar

# Step 3: Add work account
gog auth add workuser@domain.com --services gmail,calendar

# Step 4: Verify both accounts
gog auth list
```

### Incremental Sync with gog CLI
```bash
# Source: gog SKILL.md, OpenClaw community docs
# Get history since last known historyId
gog gmail history --account personaluser@gmail.com --since 12345678

# If 404 (stale historyId), fall back to messages.list
gog gmail messages search "in:inbox newer_than:1d" --max 50 --account personaluser@gmail.com
```

### Heartbeat Config in openclaw.json5
```json5
// Source: OpenClaw heartbeat docs, productivity agent pattern in existing config
"comms": {
  "displayName": "Comms",
  "model": "google/gemini-3-flash",
  "fallback": ["anthropic/claude-sonnet-4-6"],
  "soul": "agents/comms/SOUL.md",
  "skills": ["gmail", "google-calendar"],
  "heartbeat": {
    "enabled": true,
    "every": "30m",
    "model": "ollama/qwen2.5:7b",
    "activeHours": {
      "start": "08:00",
      "end": "20:00",
      "timezone": "America/Los_Angeles"
    }
  },
  "cron": [
    {
      "cron": "0 0 * * *",
      "tz": "America/Los_Angeles",
      "task": "overnight-email-check"
    },
    {
      "cron": "0 6 * * *",
      "tz": "America/Los_Angeles",
      "task": "overnight-email-check"
    }
  ]
}
```

### Egress Policy Update
```yaml
# Add to openclaw-sandbox.yaml under egress.allowed
- host: gmail.googleapis.com
  ports: [443]
  comment: Gmail API v1 (googleapis npm rootUrl)
```

### Sync State File Initialization
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
  "tokenLastRefreshed": null
}
```

### .env.example Additions
```bash
# Gmail OAuth2 (Desktop App - from GCP Console)
GMAIL_OAUTH_CLIENT_ID=
GMAIL_OAUTH_CLIENT_SECRET=
# Note: Refresh tokens are stored by gog CLI at ~/.config/gog/
# These env vars are only needed if using direct googleapis npm access
```

### HEARTBEAT.md for Comms Agent
```markdown
# Comms Agent Heartbeat

## Email Polling Checklist

1. **Work account first** (D-12 priority)
   - Read state from /sandbox/state/email-sync-work.json
   - Run: `gog gmail history --account WORK_EMAIL --since {historyId}`
   - If 404: full sync fallback (messages.list, last 24h)
   - Update historyId in state file
   - If new messages found: log count, store message IDs for Phase 2 classification

2. **Personal account second**
   - Skip if work account was rate-limited this cycle
   - Read state from /sandbox/state/email-sync-personal.json
   - Same flow as work account

3. **Token health check**
   - Verify both accounts' tokens are refreshable
   - If refresh fails: increment error counter, send Telegram alert after 3 failures (D-08)
   - If refresh has been failing for >24h: escalate alert (D-09)

4. **Error handling**
   - If 3+ consecutive sync failures for either account: single Telegram alert (D-10)
   - Reset error counter on successful sync

5. **Report**
   - If nothing needs attention: HEARTBEAT_OK
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| messages.list polling | history.list incremental sync | Gmail API v1 (stable) | 60% less quota usage; only returns changes |
| OAuth Testing mode for dev | Production mode even for personal apps | Google policy ~2023 | Testing mode tokens expire in 7 days; Production avoids this |
| www.googleapis.com for all Google APIs | Service-specific endpoints (gmail.googleapis.com) | googleapis npm ~2024 | Must allowlist per-service hostnames in egress policies |
| Single heartbeat interval | activeHours + cron combined | OpenClaw 2026.1+ | Different cadences for different time windows |

**Deprecated/outdated:**
- `www.googleapis.com/gmail/v1/` path: The googleapis npm library now uses `gmail.googleapis.com` as the root URL. Legacy path may still work but is not what the SDK sends.
- OpenClaw heartbeat without `activeHours`: Still works but wastes resources polling overnight when cron is more appropriate.

## Open Questions

1. **Does gog CLI fully support history.list with all needed parameters?**
   - What we know: gog supports `gog gmail history --since <historyId>` per SKILL.md and community docs. It outputs JSON.
   - What's unclear: Whether gog exposes `historyTypes` filter (to get only `messageAdded` events) or `labelId` filter (to filter by INBOX label). If not, may need direct googleapis calls.
   - Recommendation: Try gog CLI first during implementation. If it lacks needed parameters, fall back to googleapis npm for history.list only.

2. **Heartbeat interval regression on 2026.2.x**
   - What we know: The original bug (#14440) was fixed in PR #19745. A regression (#27807) was reported on 2026.2.25 but closed as stale.
   - What's unclear: Whether the regression is fixed in the latest 2026.2.x release.
   - Recommendation: Monitor heartbeat frequency closely during first 24 hours of deployment. Have gateway restart as fallback.

3. **gog token store location inside NemoClaw sandbox**
   - What we know: gog stores tokens at `~/.config/gog/` by default.
   - What's unclear: Whether this path is within the sandbox's `/sandbox/` writable area or if it maps to a different location inside NemoClaw.
   - Recommendation: During setup, verify gog token store is within the sandbox's writable filesystem. May need to configure `GOG_CONFIG_DIR` env var to point to `/sandbox/config/gog/`.

## Environment Availability

> Phase 1 depends on external tools and services. Verified against existing deployment:

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| OpenClaw | Agent framework | Yes | 2026.2.x | -- |
| NemoClaw / OpenShell | Sandbox | Yes | Latest stable | -- |
| Node.js | Runtime | Yes | 22+ | -- |
| Docker Engine (WSL2) | Container runtime | Yes | Deployed | -- |
| Ollama | Heartbeat gate checks | Yes | Running at 127.0.0.1:11434 | -- |
| Telegram Bot | Notifications | Yes | Connected | -- |
| gog CLI | Gmail operations | Yes | Built into OpenClaw skills | googleapis npm package |
| Google Cloud Console | OAuth credentials | Requires setup | -- | -- |
| Gmail API | Email access | Requires OAuth setup | v1 | -- |

**Missing dependencies with no fallback:**
- Google Cloud Console project with OAuth credentials must be created manually (one-time human step)
- Both Gmail accounts must complete OAuth consent flow in a browser (one-time human step per account)

**Missing dependencies with fallback:**
- None -- all runtime dependencies are already deployed

## Sources

### Primary (HIGH confidence)
- [Gmail API REST Reference](https://developers.google.com/workspace/gmail/api/reference/rest) -- Service endpoint is gmail.googleapis.com, REST v1
- [Gmail API Synchronization Guide](https://developers.google.com/workspace/gmail/api/guides/sync) -- history.list incremental sync, historyId handling, 404 fallback
- [Gmail API users.history.list](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.history/list) -- historyTypes: messageAdded, messageDeleted, labelAdded, labelRemoved; 2 quota units per call
- [Google OAuth2 for Desktop Apps](https://developers.google.com/identity/protocols/oauth2/native-app) -- PKCE flow, refresh token mechanics
- [Using OAuth 2.0 to Access Google APIs](https://developers.google.com/identity/protocols/oauth2) -- Token refresh, offline access
- [Choose Gmail API Scopes](https://developers.google.com/workspace/gmail/api/auth/scopes) -- gmail.readonly, gmail.compose, gmail.modify are all restricted scopes
- [Manage App Audience (Consent Screen)](https://support.google.com/cloud/answer/15549945) -- Testing vs Production publishing status
- [OpenClaw Heartbeat Docs](https://docs.openclaw.ai/gateway/heartbeat) -- every, activeHours, model, skipWhenBusy config
- [OpenClaw Cron vs Heartbeat](https://docs.openclaw.ai/automation/cron-vs-heartbeat) -- When to use which
- [gog SKILL.md](https://github.com/openclaw/openclaw/blob/main/skills/gog/SKILL.md) -- gog CLI commands: auth, gmail messages, history, drafts

### Secondary (MEDIUM confidence)
- [OpenClaw Heartbeat Bug #14440](https://github.com/openclaw/openclaw/issues/14440) -- Interval enforcement bypass; fixed in PR #19745
- [OpenClaw Heartbeat-Cron Collision #50773](https://github.com/openclaw/openclaw/issues/50773) -- Cron and heartbeat compete for Ollama; skipWhenBusy recommended
- [OpenClaw Heartbeat Regression #27807](https://github.com/openclaw/openclaw/issues/27807) -- Interval collapse on 2026.2.25; closed as stale
- [Nango Blog: Google OAuth invalid_grant](https://nango.dev/blog/google-oauth-invalid-grant-token-has-been-expired-or-revoked) -- Testing-to-Production credential migration
- [Google AdWords API Forum: Refresh Token Expiry](https://groups.google.com/g/adwords-api/c/EXh0Cjg5auw) -- Confirms need for new credentials after Production switch
- [OpenClaw Sandbox Egress Example](https://axentia.in/blog/openclaw-gogcli-setup-suspensions-rock-solid-fixes) -- Confirms gmail.googleapis.com in egress allow list

### Tertiary (LOW confidence)
- [OpenClaw Heartbeat Optimization Blog](https://hirehal.ai/blog/openclaw-heartbeat-optimization) -- Cost optimization patterns, unverified community source

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- All libraries already deployed or verified in npm registry; gog CLI commands confirmed via SKILL.md
- Architecture: HIGH -- Heartbeat + cron pattern well-documented in OpenClaw docs; sync state pattern is standard
- Pitfalls: HIGH -- OAuth token expiry trap confirmed by multiple sources; egress endpoint verified against Gmail API docs; heartbeat bugs confirmed via GitHub issues
- Open questions: MEDIUM -- gog CLI history.list parameter completeness unverified; heartbeat regression status unclear

**Research date:** 2026-04-01
**Valid until:** 2026-05-01 (stable domain; Gmail API v1 is mature; OpenClaw 2026.2.x is current)
