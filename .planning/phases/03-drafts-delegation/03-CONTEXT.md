# Phase 3: Drafts & Delegation - Context

**Gathered:** 2026-04-02
**Status:** Ready for planning

<domain>
## Phase Boundary

Comms agent generates draft replies for classified emails and delegates specialized items to sibling agents (dev, research, productivity, home, main), with all outbound actions gated by Telegram approval. This phase delivers the action layer — classification and delivery are already working from Phase 2.

</domain>

<decisions>
## Implementation Decisions

### Draft Tiers & Model Routing
- **D-01:** Category-driven draft routing — email classification category determines draft type and model:
  - `routine` → Gemini ack draft ("thanks, got it")
  - `calendar` → Gemini RSVP draft with calendar conflict check
  - `code` → delegated to dev agent (no auto-draft unless user requests)
  - `research` → delegated to research agent (no auto-draft unless user requests)
  - `home` → delegated to home agent (no auto-draft unless user requests)
  - `urgent` → Claude smart draft auto-created + delegated to main agent
  - `spam_noise` → no draft, no delegation
- **D-02:** Selective drafting — only emails that need a reply get drafts. Code/research/home emails are delegated to sibling agents, not drafted. Spam gets nothing.
- **D-03:** Auto-create Gmail drafts immediately on classification for routine acks and calendar RSVPs. User sees "Draft ready" with approve/edit/discard options.
- **D-04:** Claude smart drafts auto-created only for `urgent` emails. All other categories require user to explicitly request a smart draft via Telegram.
- **D-05:** Gemini handles routine acks, template replies, and calendar RSVPs. Claude (claude-sonnet-4-6) handles smart drafts for urgent and on-demand requests. Budget: ~2-3 auto smart drafts/day from urgent emails.

### Delegation Routing
- **D-06:** Always use `sessions_spawn` (async, non-blocking) for all delegations. Fire-and-forget — results announced back to comms agent's channel.
- **D-07:** Delegation routing map:
  - `code` → dev agent (context: PR info, repo, branch)
  - `calendar` → productivity agent (context: event details, conflicts)
  - `research` → research agent (context: topic, source)
  - `home` → home agent (context: alert type, device)
  - `urgent` → main agent (context: full classification result)
- **D-08:** Context packaging: metadata + classification only (sender, subject, snippet, classification result, confidence, recommended action). Target agent fetches full email body via Gmail API if needed. No full email forwarding — respects AGENTS.md privacy constraint.
- **D-09:** Queue + notify when target agent unavailable. Item goes into `delegation-queue.json` with retry counter. Telegram alert: "agent unavailable — queued [subject]. Will retry in 15m." Max 3 retries, then dead-letter with user notification.
- **D-10:** 2-hour follow-up timeout for delegated items. Comms checks queue every heartbeat. If no result after 2 hours, Telegram: "[agent] hasn't responded to [subject] — nudge or take over?"
- **D-11:** `agentToAgent` must be enabled in comms agent config with allow list: `["dev", "research", "productivity", "home", "main"]`

### Telegram Approval UX
- **D-12:** Inline keyboards for draft approval — each draft notification gets Approve / Edit in Gmail / Quick Edit / Discard buttons.
- **D-13:** Both edit options offered: "Edit in Gmail" (deep link to draft in Gmail web UI) and "Quick edit" (user replies with revised text in Telegram, comms updates Gmail draft).
- **D-14:** Draft notification delivery: urgent drafts get separate immediate Telegram messages. Routine/calendar drafts bundle into the next periodic digest.
- **D-15:** Snooze option available with preset times (1hr / 3hr / tomorrow). Draft stays in Gmail, reminder resurfaces in Telegram.

### Draft Lifecycle & State
- **D-16:** Drafts created immediately on classification — proactive, draft is waiting when user gets to it.
- **D-17:** 48-hour TTL for unclaimed drafts. Auto-deleted from Gmail after 48 hours if not approved/discarded. Telegram notification on cleanup: "Draft for [subject] expired."
- **D-18:** One draft per thread — `draft-tracker.json` checks threadId before creating. If draft exists for that thread, update existing draft rather than creating duplicate.
- **D-19:** Calendar RSVP logic: auto-check Google Calendar for conflicts (calendar.readonly scope already authorized). If conflict: suggest decline with reason. If free: suggest accept. User approves via Telegram either way.

### Claude's Discretion
- Draft text tone and formatting within the constraints of SOUL.md ("match formality of recipient")
- Template library structure and specific template patterns
- Delegation message formatting for target agents
- Error handling for Gmail draft creation failures
- Draft update strategy when new emails arrive in same thread (update existing vs. regenerate)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Agent Configuration
- `config/openclaw.json5` — Comms agent definition, model strategy, `agentToAgent` config needed, heartbeat/cron config. Also: dev, research, productivity, home, main agent definitions for understanding delegation targets
- `config/openclaw-sandbox.yaml` — Egress policy; all required endpoints already allowlisted
- `agents/comms/SOUL.md` — Comms agent personality, constraints (never auto-send, account labeling, summarize before drafting)
- `agents/comms/AGENTS.md` — Memory rules (never store email content), security rules, tool permissions, fallback behavior
- `agents/dev/SOUL.md` + `agents/dev/AGENTS.md` — Dev agent capabilities for code email delegation
- `agents/research/SOUL.md` + `agents/research/AGENTS.md` — Research agent capabilities
- `agents/productivity/SOUL.md` + `agents/productivity/AGENTS.md` + `agents/productivity/HEARTBEAT.md` — Productivity agent capabilities, calendar access
- `agents/home/SOUL.md` + `agents/home/AGENTS.md` — Home agent capabilities
- `agents/main/SOUL.md` + `agents/main/AGENTS.md` — Main agent capabilities for urgent escalation

### Phase 1 & 2 Foundation
- `.planning/phases/01-gmail-foundation/01-CONTEXT.md` — OAuth scopes (gmail.compose for draft creation), account identity (D-11/D-12), polling cadence
- `.planning/phases/02-classification-delivery/02-CONTEXT.md` — Classification pipeline (D-04), confidence tiers (D-01), Telegram digest format (D-11), sender cache, `telegramSendFn` pattern

### Existing Code
- `sandbox/skills/classify-email/types.js` — CATEGORIES constant, CONFIDENCE_THRESHOLDS, getConfidenceTier(), prompt builders
- `sandbox/skills/classify-email/index.js` — `handleNewEmails()` pipeline entry point — drafts and delegation hook into this pipeline
- `sandbox/skills/classify-email/delivery.js` — Telegram digest formatting, `processClassifiedEmails()`, `handleDigestReply()`
- `sandbox/skills/classify-email/digest-formatter.js` — Digest message formatting utilities
- `sandbox/state/draft-tracker.json` — Draft state file (to be created)
- `sandbox/state/delegation-queue.json` — Delegation queue state file (to be created)
- `scripts/gmail-oauth-helper.cjs` — OAuth token management reference

### Project Docs
- `prd-openclaw-nemoclaw.md` — Original PRD: anti-patterns (never auto-send, agents can't modify own config), model strategy, agent definitions
- `.planning/REQUIREMENTS.md` — DRAFT-01 through DRAFT-07, DELEG-01 through DELEG-09 acceptance criteria
- `.planning/ROADMAP.md` — Phase 3 success criteria

### External References
- OpenClaw `sessions_spawn` docs — async sub-agent delegation, non-blocking
- OpenClaw `agentToAgent` config — enable inter-agent communication with allow list
- Gmail Drafts API (`users.drafts.create`) — 10 quota units per call
- Google Calendar API (read events for RSVP conflict checking)
- Telegram Bot API inline keyboards — button-based approval UX

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `classify-email/types.js` — CATEGORIES enum, confidence thresholds, model constants — reuse for routing decisions
- `classify-email/index.js` — `handleNewEmails()` pipeline — draft/delegation hooks into stage 3 (after classify, before/during deliver)
- `classify-email/delivery.js` — `processClassifiedEmails()` handles digest formatting — extend for draft notifications and inline keyboards
- `classify-email/digest-formatter.js` — Telegram message formatting utilities — extend for draft approval messages
- `gmail-oauth-helper.cjs` — OAuth token management — reference for Gmail API auth in draft creation
- `@googleapis/gmail` and `google-auth-library` npm packages already installed

### Established Patterns
- Pipeline architecture: spam-gate → classifier → delivery (add draft-generator and delegator as parallel stage after classifier)
- `telegramSendFn` callback pattern — draft notifications should use the same pattern for testability
- Account separation: per-account state files (`sender-cache-personal.json`, `sender-cache-work.json`) — draft-tracker and delegation-queue should follow same pattern or use account field
- JSON state files in `sandbox/state/` — consistent with existing `batch-buffer.json`, `digest-map.json`
- Heartbeat-driven processing — delegation follow-up checks run on the same heartbeat cycle

### Integration Points
- `handleNewEmails()` pipeline in `index.js` — add draft generation and delegation as new stages after classification
- `delivery.js` — extend `processClassifiedEmails()` to include draft creation and delegation dispatch alongside digest delivery
- `openclaw.json5` — add `agentToAgent.enabled: true` with allow list to comms agent config
- New skill files: `draft-generator.js` (draft creation + Gmail API), `delegator.js` (sessions_spawn routing + queue)
- New state files: `draft-tracker.json` (threadId → draftId map), `delegation-queue.json` (pending delegations)

</code_context>

<specifics>
## Specific Ideas

- Urgent emails are the only category that get both auto-drafting (Claude) AND delegation (to main agent) — they're the highest-priority items
- "Edit in Gmail" deep link + "Quick edit" in Telegram gives user flexibility without forcing one workflow
- Snooze with preset times (1hr/3hr/tomorrow) for "I'll deal with this later" without losing track
- Delegation context is intentionally lean (metadata + classification) — target agents fetch full body themselves, respecting account separation
- Draft expiry notifications ("Draft for [subject] expired") keep user aware without being blocking

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 03-drafts-delegation*
*Context gathered: 2026-04-02*
