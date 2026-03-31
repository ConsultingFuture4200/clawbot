# Domain Pitfalls

**Domain:** Email triage AI agent (Gmail + multi-agent routing + Telegram interface)
**Project:** ClawBot Email Triage Agent
**Researched:** 2026-03-31

---

## Critical Pitfalls

Mistakes that cause broken functionality, data loss, or require architectural rework.

### Pitfall 1: OAuth Refresh Token Expires Silently (The "Testing Mode" Trap)

**What goes wrong:** Google Cloud projects with OAuth consent screen set to "External" and publishing status "Testing" issue refresh tokens that expire after 7 days. Since Gmail scopes (read, compose, send) are NOT in the exempt subset (name/email/profile only), every token will die weekly. The agent silently stops reading email with no error until the next poll attempt fails.

**Why it happens:** Developers set up OAuth in testing mode to avoid Google's verification process and never move to production. For personal projects it feels unnecessary to submit for review.

**Consequences:** Email triage stops working every 7 days. User must manually re-authenticate through the browser OAuth flow each time. For two accounts, this means re-auth twice per week. The system appears "always broken."

**Prevention:**
- Move the OAuth consent screen to "Production" status immediately during setup, even for personal use.
- For personal-only apps with external user type, Google allows unverified production apps for personal use (you and a handful of known users can click through the "unverified app" warning).
- Alternatively, if you have Google Workspace, use "Internal" user type (no verification needed, no token expiry). Personal Gmail accounts cannot use Internal.
- Implement token health monitoring: on every Gmail API call, catch `invalid_grant` errors and immediately send a Telegram alert with a re-auth link.

**Detection:** Token refresh fails with `invalid_grant` error. Agent stops surfacing new emails. Telegram goes silent on email digests.

**Phase relevance:** Phase 1 (OAuth setup). This MUST be resolved before any email polling code is written.

**Confidence:** HIGH -- verified via Google OAuth documentation and multiple developer community reports.

---

### Pitfall 2: Gmail Watch (Pub/Sub) Expires Every 7 Days with No Warning

**What goes wrong:** Gmail's `users.watch()` method registers push notifications via Cloud Pub/Sub, but the watch expires after exactly 7 days. There is no automatic renewal. There is no expiration warning. It just stops. The agent receives no more email notifications and falls back to polling -- or, if polling was removed in favor of push, stops entirely.

**Why it happens:** Developers assume `watch()` is a one-time setup. The 7-day expiration is documented but easy to miss, and Google provides no renewal mechanism or pre-expiration callback.

**Consequences:** Email notifications stop silently after 7 days. If the system relies solely on push notifications, no emails are processed. Even with polling fallback, there's a gap window.

**Prevention:**
- Call `users.watch()` on a daily cron (Google's own recommendation). Calling watch before expiration simply extends it -- there is no penalty for early renewal.
- Implement a "polling safety net": even with Pub/Sub push active, run a low-frequency poll (every 15-30 minutes) using `history.list` as a catch-all for missed notifications.
- Monitor the watch expiration timestamp returned by the API and alert if renewal fails.
- The `watch()` call costs 100 quota units -- at once per day per account, that is 200 units/day total (trivial against the daily budget).

**Detection:** No new email notifications arrive via Pub/Sub. The polling safety net catches emails that push missed. Monitor "last notification received" timestamp and alert if gap exceeds 30 minutes during business hours.

**Phase relevance:** Phase 2 (push notification setup) or whenever Pub/Sub is wired up.

**Confidence:** HIGH -- verified via official Gmail API documentation (`users.watch` reference).

---

### Pitfall 3: Gemini Free Tier Rate Limits Are Far Lower Than PRD Assumes

**What goes wrong:** The PRD states Gemini free tier allows "60 req/min, 1K req/day." Current data (as of early 2026) shows the actual free tier limits for Gemini 3 Flash are approximately 10-15 RPM and 250 RPD. Google reduced free tier quotas by 50-92% in late 2025 and limits now vary per model and are only viewable in AI Studio. Classifying a batch of 30 emails could burn through 12% of the daily quota in a single burst.

**Why it happens:** Rate limits change without notice. The PRD was written with older or optimistic numbers. Google does not guarantee free tier limits and can reduce them at any time.

**Consequences:** Hitting rate limits during email triage causes 429 errors. If the agent retries aggressively, it burns even more quota. Emails back up unclassified. The Anthropic fallback at $30/month gets consumed rapidly if Gemini throttles frequently.

**Prevention:**
- Verify actual limits in AI Studio for the exact model being used BEFORE designing the classification pipeline.
- Design for 10 RPM / 250 RPD as the floor (worst-case free tier).
- Batch email classification: instead of one API call per email, batch 5-10 emails into a single prompt ("classify these emails"). This divides quota consumption by 5-10x.
- Implement exponential backoff with jitter on 429 errors. Never retry immediately.
- Use Ollama (qwen2.5:7b) for obvious spam/noise pre-filtering before sending to Gemini. A local model can handle "is this clearly spam?" at zero API cost.
- Consider Gemini Tier 1 (pay-as-you-go) as insurance: $0.50/M input tokens is extremely cheap and provides 150-300 RPM.

**Detection:** Monitor 429 error rate. Track daily Gemini API call count against known limits. Alert when hitting 80% of daily quota.

**Phase relevance:** Phase 1 (classification design). The classification architecture must account for this from day one.

**Confidence:** HIGH -- verified via Google AI developer documentation and multiple third-party reports on 2025-2026 quota reductions.

---

### Pitfall 4: Classification Cascade -- One Misclassification Poisons Downstream Agents

**What goes wrong:** The comms agent classifies an email as "code" and delegates to the dev agent. The dev agent, receiving a non-code email, hallucinates a code-related response. The user sees a bizarre reply draft. Worse: the misclassification is stored in learning memory as a "correct" pattern, training future classifications to repeat the same mistake. Research on multi-agent LLM systems confirms that agents "accept flawed input uncritically as a valid premise" and errors "cascade down the dependency chain, with each agent building upon the faulty foundation."

**Why it happens:** LLM classification is probabilistic, not deterministic. Ambiguous emails (e.g., a GitHub notification about a calendar integration) legitimately span multiple categories. Without confidence thresholds, every classification gets treated as certain.

**Consequences:** Wrong agent produces wrong draft. User loses trust in the system. Learning memory stores bad patterns, causing systematic drift toward incorrect classifications. Recovery requires manually auditing and cleaning the memory file.

**Prevention:**
- Require a confidence score with every classification. If below threshold (e.g., 0.7), route to a "needs-human-triage" category and ask the user via Telegram.
- Never auto-store classifications in learning memory. Only store patterns the user explicitly confirms.
- Implement a "delegation receipt": when comms delegates to another agent, include the original email context and the classification reasoning. The receiving agent can challenge the classification.
- Cap delegation depth to 1 (comms -> one agent, never comms -> dev -> research). Circular delegation is architecturally impossible if depth is limited.
- Weekly memory audit: display the last 50 learned patterns for user review.

**Detection:** Track delegation-to-correction ratio. If the user frequently overrides classifications for a category, the classifier is drifting. Monitor for agents producing nonsensical outputs (response relevance scoring).

**Phase relevance:** Phase 2 (classification pipeline) and Phase 3 (learning memory). Must be designed in Phase 2 but monitored continuously.

**Confidence:** HIGH -- verified via multi-agent hallucination research (MDPI, arxiv) and general LLM reliability literature.

---

### Pitfall 5: Account Data Cross-Contamination Between Personal and Work Gmail

**What goes wrong:** Email content from the work account leaks into personal account context (or vice versa) through shared LLM conversation context, shared memory files, or combined prompt batching. A draft reply to a personal email contains work-context jargon, or a professional reply references personal correspondence. Microsoft Copilot had a documented vulnerability where it accessed confidential emails across security boundaries.

**Why it happens:** The comms agent uses a single LLM session. Both accounts' emails pass through the same model context window. Gemini's 1M context window makes it easy to accidentally retain cross-account content. Memory files may not enforce account boundaries.

**Consequences:** Privacy violation. Professional embarrassment if work content appears in personal replies. Potential compliance issues if work email contains sensitive business data. Violates AGENTS.md rule: "Keep personal and work account data strictly separated."

**Prevention:**
- Process each account in separate LLM calls. Never batch personal and work emails into the same classification prompt.
- Use separate memory files per account: `memory/comms-personal.md` and `memory/comms-work.md`. Never write to a shared memory file.
- Clear or isolate conversation context between account processing. If OpenClaw supports session scoping, use separate sessions per account.
- In Telegram digests, visually separate accounts with clear headers and never interleave messages from different accounts.
- Add a pre-send check: before creating a Gmail draft, verify the "from" account matches the account the email was received on.

**Detection:** Audit drafts for account mismatch (draft created in wrong account). Grep memory files for content that should only exist in the other account. User reports of "weird" context in replies.

**Phase relevance:** Phase 1 (architecture design). Account separation must be a structural constraint, not a behavioral suggestion to the LLM.

**Confidence:** HIGH -- this is a known pattern in multi-account AI assistants, confirmed by Microsoft Copilot incident reports.

---

### Pitfall 6: OAuth Token Revocation on Password Change (Unrecoverable Without Re-Auth)

**What goes wrong:** If the user changes their Google password on either Gmail account, all OAuth refresh tokens that include Gmail scopes are immediately and permanently revoked. There is no recovery mechanism -- the token is dead. The agent silently stops accessing that account's email.

**Why it happens:** Google's security policy automatically revokes tokens when passwords change. This is by design and not configurable. Many users change passwords periodically or after security alerts.

**Consequences:** Email triage for the affected account stops completely. If there is no alerting, the user does not know it stopped. Could be hours or days before anyone notices.

**Prevention:**
- Implement a "canary check" on every heartbeat: before doing any email work, call `getProfile` (1 quota unit) to verify the token is alive. If it returns `invalid_grant`, immediately notify via Telegram with re-auth instructions.
- Store a "last successful auth" timestamp per account. Alert if no successful API call in the last heartbeat cycle.
- Document the re-auth procedure so it takes less than 2 minutes when needed.
- Consider Google's incremental authorization to request minimal scopes first and add Gmail scopes separately -- though this does not prevent revocation, it limits the blast radius.

**Detection:** Any Gmail API call returns `invalid_grant`. The canary check catches this before the user notices missing emails.

**Phase relevance:** Phase 2 (OAuth wiring). Build the canary check into the first heartbeat implementation.

**Confidence:** HIGH -- verified via Google OAuth documentation and Google Cloud blog on token revocation.

---

## Moderate Pitfalls

Mistakes that degrade quality, waste resources, or require significant rework.

### Pitfall 7: Notification Fatigue Kills Adoption

**What goes wrong:** The agent sends a Telegram notification for every email. User receives 50+ notifications per day. Within a week, they mute the bot or stop reading notifications entirely. The system becomes "furniture" -- present but ignored. Microsoft removed email triage features from Outlook iOS/Android in February 2026 specifically because of user feedback about notification overload.

**Prevention:**
- Default to digest mode: batch notifications by time window (morning/afternoon/evening) and priority tier.
- Only break out of digest for emails classified as "urgent."
- Allow user to configure quiet hours (no notifications between 10pm-7am except urgent).
- Group notifications by account, then by category, in a single Telegram message.
- Track "notification open rate" -- if the user stops responding to digests, reduce frequency or ask them to reconfigure.

**Detection:** User stops interacting with email digests. Draft approval rate drops. Bot is muted.

**Phase relevance:** Phase 2 (notification design). The digest format should be designed before any notifications ship.

---

### Pitfall 8: Gmail API Quota Blowout from Naive Polling

**What goes wrong:** Polling two accounts every 60 seconds using `messages.list` (5 units) + `messages.get` per new message (5 units each) burns through quota rapidly. If each poll fetches message details for 5 new emails, that is 30 units per poll per account, 60 units total, 86,400 units/day. Add classification-related re-reads and draft creation (10 units each), and you approach the per-user rate limit.

**Prevention:**
- Use `history.list` (2 units) instead of `messages.list` (5 units) for incremental sync. This is 60% cheaper and returns only changes since last sync.
- Store the `historyId` from the last successful sync and use it as `startHistoryId` for the next partial sync.
- Implement smart polling intervals: urgent checks every 2-5 minutes, routine every 15-30 minutes, low-priority every 1-3 hours.
- Use Pub/Sub push notifications as the primary trigger (eliminates most polling) with polling as a safety net only.
- Batch `messages.get` calls using Gmail's batch endpoint (up to 100 per batch).

**Detection:** Monitor quota unit consumption per day. Alert at 80% of per-user-per-minute rate limit (200 out of 250 units/second).

**Phase relevance:** Phase 1 (polling architecture). Choose push vs. poll strategy before writing any Gmail integration code.

---

### Pitfall 9: Draft Collision and Orphaned Drafts

**What goes wrong:** The agent creates a Gmail draft for an email. The user does not approve it via Telegram. A new email arrives in the same thread. The agent creates another draft. Now there are two drafts for the same thread -- the user sees the old stale draft and the new one. Worse: if the user edits a draft in Gmail directly while the agent is updating it, the agent's `drafts.update` (15 units) overwrites their edits because Gmail draft messages are immutable -- updates replace the entire message.

**Prevention:**
- Track draft IDs in the agent's memory. Before creating a new draft, check if an existing draft exists for the same thread. If so, update the existing draft (or delete + recreate) rather than creating a duplicate.
- Implement draft expiry: if a draft is not approved within 24 hours, auto-delete it and notify the user that the draft was cleaned up.
- Never call `drafts.update` without first doing `drafts.get` to check if the content has been modified by the user since last agent touch. If it has, do NOT overwrite -- alert the user instead.
- Store a "last_agent_modified" timestamp with each tracked draft.

**Detection:** Multiple drafts for the same thread in the agent's draft tracker. Drafts older than 24 hours still pending approval.

**Phase relevance:** Phase 2 (draft creation). Draft lifecycle management must be designed alongside draft creation.

---

### Pitfall 10: Learning Memory Corruption and Unbounded Growth

**What goes wrong:** The comms agent stores classification patterns in a markdown memory file. Over months, the file grows to thousands of entries. Some entries contradict each other (e.g., "newsletters from Substack are routine" vs. "newsletters from Substack are research"). The LLM receives all patterns in its context window, gets confused by contradictions, and classification quality degrades rather than improves. The memory file becomes so large it consumes a significant portion of Gemini's context budget.

**Prevention:**
- Cap the memory file to a fixed number of recent patterns (e.g., 200). Oldest entries roll off.
- Implement conflict detection: before storing a new pattern, check if it contradicts an existing one. If so, replace the old pattern rather than adding both.
- Separate memory by category: `patterns-code.md`, `patterns-calendar.md`, etc. This keeps individual files small and scoped.
- Version the memory file with timestamps. Enable rollback if classification quality drops after a batch of new patterns.
- Run a monthly "memory compaction" that deduplicates and merges similar patterns.

**Detection:** Memory file exceeds size threshold. Classification accuracy drops after adding new patterns. Contradictory patterns detected during compaction.

**Phase relevance:** Phase 3 (learning memory). Design the memory schema before storing any patterns.

---

### Pitfall 11: Pub/Sub Requires a Google Cloud Billing Account

**What goes wrong:** Setting up Gmail push notifications via Cloud Pub/Sub requires a Google Cloud project with the Pub/Sub API enabled. While Pub/Sub has a generous free tier (10GB messages/month), Google requires a billing account to be attached to the project. Developers who expect a fully-free setup are surprised by this requirement. Additionally, the Pub/Sub topic must be in the SAME GCP project as the OAuth client, and the `gmail-api-push@system.gserviceaccount.com` service account must be granted Publisher role on the topic.

**Prevention:**
- Set up a GCP billing account during Phase 1 (free tier covers this use case -- zero actual cost).
- Ensure the GCP project used for OAuth is the same one used for Pub/Sub.
- Document the IAM permission grant step explicitly: it is the most commonly missed step.
- Alternative: skip Pub/Sub entirely and use polling-only. For a personal assistant checking two accounts, polling via `history.list` every 2-5 minutes is perfectly adequate and avoids the entire Pub/Sub setup complexity. Cost: ~576 `history.list` calls/day at 2 units each = 1,152 quota units (well within limits).

**Detection:** `watch()` call fails with permissions error. Pub/Sub subscription shows zero message deliveries.

**Phase relevance:** Phase 1 (infrastructure decision). Decide push vs. poll before writing integration code.

---

### Pitfall 12: Delegation Queue Stalls When Target Agent Is Down

**What goes wrong:** The comms agent classifies an email as "code" and delegates to the dev agent. The dev agent is down (Codex quota exhausted, Gemini fallback also failing, or the agent crashed). The delegation sits in a queue indefinitely. No one processes the email. No one notifies the user.

**Prevention:**
- Implement a delegation timeout: if the target agent does not acknowledge within 5 minutes, escalate back to comms with a "delegation failed" status and notify the user via Telegram.
- Always include the original email summary in the delegation payload so the user can act on it manually.
- Pre-check agent health before delegating: if the dev agent's primary and fallback models are both reporting errors, skip delegation and present the email directly to the user with classification context.
- Implement a dead-letter queue: failed delegations go here for user review, rather than silently dropping.

**Detection:** Delegation queue length growing. Delegations older than the timeout threshold. User not notified of pending items.

**Phase relevance:** Phase 2 (delegation system). Must be designed alongside the delegation routing.

---

## Minor Pitfalls

Issues that cause friction but are easily recoverable.

### Pitfall 13: History ID Gaps Cause Missed Emails

**What goes wrong:** The `history.list` API returns changes since a given `historyId`. If the stored `historyId` becomes stale (e.g., after a long downtime, agent restart without persisting state, or history ID rollover), the API returns an HTTP 404 error. The agent must fall back to a full sync, which is expensive and may re-process already-handled emails.

**Prevention:**
- Persist the `historyId` to disk (not just in-memory) after every successful sync.
- If `history.list` returns 404, perform a full sync (messages.list with a date filter for the last 48 hours) and store the new historyId.
- On agent startup, always verify the stored historyId is still valid before entering the normal sync loop.

**Detection:** `history.list` returns 404. Full sync triggered unexpectedly.

**Phase relevance:** Phase 2 (sync implementation).

---

### Pitfall 14: Thread vs. Message Confusion in Classification

**What goes wrong:** Gmail groups messages into threads. The agent classifies a single message, but the user sees the thread. A thread might start as "routine" but become "urgent" when a new reply arrives. If the agent only classifies the latest message, it may miss thread-level context. If it classifies the whole thread, it re-processes old messages.

**Prevention:**
- Classify at the message level (as specified in PROJECT.md for v1) but track thread IDs.
- When a new message arrives in a previously-classified thread, include the previous classification as context ("this thread was previously classified as 'routine'").
- Allow re-classification: if a new message changes the thread's urgency, update the classification and notify the user.

**Detection:** User complains about stale classifications on active threads.

**Phase relevance:** Phase 2 (classification design). Thread awareness is cheap to add even in a message-level classifier.

---

### Pitfall 15: Telegram Message Length Limits for Digests

**What goes wrong:** Telegram messages have a 4096-character limit. A digest with 20+ emails easily exceeds this. The agent's message gets truncated or the API call fails with an error.

**Prevention:**
- Split digests into multiple messages if they exceed 4000 characters.
- Use compact formatting: subject + sender + classification tag, one line per email.
- Include a "full details" option: "Reply 3 to see full email #3."
- Paginate: "Showing 1-10 of 23 emails. Reply 'more' for next page."

**Detection:** Telegram API returns message-too-long error. Digest appears truncated.

**Phase relevance:** Phase 2 (Telegram digest formatting).

---

### Pitfall 16: Clock Skew Between Heartbeat Scheduling and Email Urgency

**What goes wrong:** The heartbeat runs on a cron schedule (e.g., every 30 minutes). An urgent email arrives 1 minute after the last heartbeat. The user does not see it for 29 minutes. For "urgent" classification to have meaning, the detection latency must be much shorter than the heartbeat interval.

**Prevention:**
- Use Pub/Sub for real-time urgent email detection (near-instant notification).
- If using polling only, run a fast-poll (every 2 minutes) lightweight check that ONLY looks for unread messages with certain sender patterns or subject keywords, using `history.list` (2 units). Save the full classification for the regular heartbeat.
- Implement tiered polling: urgent senders/keywords trigger immediate classification; everything else waits for the next scheduled heartbeat.

**Detection:** User reports delayed notification for urgent emails. Time gap between email receipt and Telegram notification exceeds SLA.

**Phase relevance:** Phase 2 (polling schedule design).

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation | Pitfall # |
|-------------|---------------|------------|-----------|
| OAuth setup | Testing mode 7-day token expiry | Move to Production status immediately | 1 |
| OAuth setup | Password change revokes tokens | Canary health check on every heartbeat | 6 |
| Infrastructure | Pub/Sub billing requirement | Decide push vs. poll early; set up billing if push | 11 |
| Classification design | Gemini rate limits much lower than assumed | Batch classifications; verify limits in AI Studio | 3 |
| Classification pipeline | Misclassification cascades through agents | Confidence thresholds + human triage fallback | 4 |
| Account handling | Cross-contamination between personal/work | Structural separation: separate sessions, memory files, API calls | 5 |
| Notification design | Notification fatigue | Digest-first, interrupt only for urgent | 7 |
| Polling architecture | Quota blowout from naive polling | Use history.list + smart intervals + optional Pub/Sub | 8 |
| Draft management | Orphaned/duplicate drafts | Track draft IDs, implement expiry + collision detection | 9 |
| Learning memory | Memory corruption and unbounded growth | Capped size, conflict detection, per-category files | 10 |
| Delegation system | Queue stalls when target agent down | Timeout + dead-letter queue + user notification | 12 |
| Sync implementation | History ID gaps cause missed emails | Persist historyId to disk, graceful full-sync fallback | 13 |
| Digest formatting | Telegram message length limits | Split messages, compact format, pagination | 15 |
| Urgency detection | Heartbeat too slow for urgent emails | Tiered polling or Pub/Sub for real-time urgent detection | 16 |

---

## Sources

### Official Documentation (HIGH confidence)
- [Gmail API Usage Limits](https://developers.google.com/workspace/gmail/api/reference/quota) -- quota units per method
- [Gmail API Push Notifications](https://developers.google.com/workspace/gmail/api/guides/push) -- watch expiry, Pub/Sub setup
- [Gmail API Synchronization](https://developers.google.com/workspace/gmail/api/guides/sync) -- history.list partial sync
- [Gmail API Draft Guide](https://developers.google.com/workspace/gmail/api/guides/drafts) -- draft immutability, label restrictions
- [Gmail API Error Handling](https://developers.google.com/workspace/gmail/api/guides/handle-errors) -- error codes and retry
- [Google OAuth 2.0 Documentation](https://developers.google.com/identity/protocols/oauth2) -- token limits, testing mode expiry
- [Gmail API Authentication Troubleshooting](https://developers.google.com/gmail/api/troubleshoot-authentication-authorization)
- [Gemini API Rate Limits](https://ai.google.dev/gemini-api/docs/rate-limits) -- current free tier limits
- [OpenClaw Gmail Pub/Sub](https://docs.openclaw.ai/automation/gmail-pubsub) -- OpenClaw-specific setup
- [OpenClaw Heartbeats](https://docs.openclaw.ai/gateway/heartbeat) -- heartbeat configuration

### Verified Third-Party Sources (MEDIUM confidence)
- [Google OAuth invalid_grant Analysis (Nango)](https://nango.dev/blog/google-oauth-invalid-grant-token-has-been-expired-or-revoked) -- comprehensive token failure modes
- [Google Token Revocation Policy (Google Cloud Blog)](https://cloud.google.com/blog/products/application-development/increased-account-security-via-oauth-2-0-token-revocation) -- password change revocation
- [Gmail Push Notification Bug Workaround (Hiver Engineering)](https://medium.com/hiver-engineering/gmail-apis-push-notifications-bug-and-how-we-worked-around-it-at-hiver-a0a114df47b4) -- historyId reliability issues
- [Multi-Agent Coordination Strategies (Galileo AI)](https://galileo.ai/blog/multi-agent-coordination-strategies) -- delegation loop prevention
- [LLM Agent Hallucination Survey (arxiv)](https://arxiv.org/html/2509.18970v1) -- cascading errors in multi-agent systems

### Community/Research Sources (LOW confidence -- verify before relying on)
- [Gemini Free Tier Limits 2026 (LaoZhang Blog)](https://blog.laozhang.ai/en/posts/gemini-api-free-tier) -- reports of 50-92% quota reductions
- [Microsoft Copilot Email Data Leak (Cybernews)](https://cybernews.com/security/microsoft-copilot-confidential-email-data-leak/) -- cross-account data leakage precedent
