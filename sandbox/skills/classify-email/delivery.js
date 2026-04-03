'use strict';

const fs = require('fs');
const path = require('path');
const {
  formatDigest,
  formatUrgentNotification,
  formatEmptyState,
  formatErrorState,
  formatDraftNotification,
  formatUrgentDraftNotification,
  buildDraftApprovalKeyboard,
  formatDelegationResult,
  formatDelegationNudge,
  escapeHtml
} = require('./digest-formatter');
const {
  CONFIDENCE_THRESHOLDS,
  DRAFT_CATEGORIES,
  DELEGATION_CATEGORIES,
  DRAFT_TRACKER_PATH
} = require('./types');
const {
  generateDraft,
  generateSmartDraft,
  updateDraftStatus,
  cleanupExpiredDrafts,
  deleteGmailDraft,
  getGmailClient
} = require('./draft-generator');
const {
  delegateToAgent,
  processDelegationQueue,
  checkFollowUps,
  markDelegationComplete
} = require('./delegator');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Sandbox state directory for runtime JSON files. */
const STATE_DIR = '/sandbox/state';

/** Batch digest interval in hours (TGRAM-03: 3-hour batch cycle). */
const BATCH_INTERVAL_HOURS = 3;

/** Digest expiry in hours (UI-SPEC: replies to digests >24h old are expired). */
const DIGEST_EXPIRY_HOURS = 24;

/** Prune digest map entries older than this many hours. */
const DIGEST_MAP_PRUNE_HOURS = 48;

/** Path to the batch buffer state file. */
const BATCH_BUFFER_PATH = path.join(STATE_DIR, 'batch-buffer.json');

/** Path to the digest map state file. */
const DIGEST_MAP_PATH = path.join(STATE_DIR, 'digest-map.json');

// ---------------------------------------------------------------------------
// State file helpers
// ---------------------------------------------------------------------------

/**
 * Load a JSON state file. Returns parsed object.
 * @param {string} filePath - Absolute path to JSON file.
 * @returns {object} Parsed JSON.
 */
function loadState(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

/**
 * Save a JSON state file atomically (write + sync).
 * @param {string} filePath - Absolute path to JSON file.
 * @param {object} data - Object to serialize.
 */
function saveState(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

// ---------------------------------------------------------------------------
// Batch buffer management
// ---------------------------------------------------------------------------

/**
 * Add a classified email to the batch buffer for its account.
 *
 * @param {object} classifiedEmail - Classified email object from classifyPipeline.
 */
function addToBatchBuffer(classifiedEmail) {
  const buffer = loadState(BATCH_BUFFER_PATH);
  const account = classifiedEmail.account;

  if (!buffer[account]) {
    buffer[account] = { emails: [], last_digest_sent: null };
  }

  buffer[account].emails.push({
    threadId: classifiedEmail.threadId,
    messageId: classifiedEmail.messageId,
    sender: classifiedEmail.sender,
    subject: classifiedEmail.subject,
    snippet: classifiedEmail.snippet,
    classification: {
      categories: classifiedEmail.categories,
      reasoning: classifiedEmail.reasoning,
      recommended_action: classifiedEmail.recommended_action,
      is_urgent: classifiedEmail.is_urgent,
      confidenceTier: classifiedEmail.confidenceTier
    },
    is_unknown_sender: classifiedEmail.is_unknown_sender,
    account: classifiedEmail.account,
    received_at: new Date().toISOString()
  });

  saveState(BATCH_BUFFER_PATH, buffer);
}

/**
 * Check whether a digest should be sent for the given account.
 * Returns true if there are buffered emails AND the batch interval has elapsed.
 *
 * @param {string} account - 'personal' or 'work'.
 * @returns {boolean} True if digest should be sent.
 */
function shouldSendDigest(account) {
  const buffer = loadState(BATCH_BUFFER_PATH);
  const acctBuf = buffer[account];

  if (!acctBuf || acctBuf.emails.length === 0) {
    return false;
  }

  if (acctBuf.last_digest_sent === null) {
    return true;
  }

  const lastSent = new Date(acctBuf.last_digest_sent).getTime();
  const now = Date.now();
  const hoursSince = (now - lastSent) / (1000 * 60 * 60);

  return hoursSince >= BATCH_INTERVAL_HOURS;
}

// ---------------------------------------------------------------------------
// Digest map management
// ---------------------------------------------------------------------------

/**
 * Prune digest map entries older than DIGEST_MAP_PRUNE_HOURS.
 *
 * @param {object} digestMap - The digest map object.
 * @returns {object} Pruned digest map.
 */
function pruneDigestMap(digestMap) {
  const now = Date.now();
  const cutoff = DIGEST_MAP_PRUNE_HOURS * 60 * 60 * 1000;

  for (const msgId of Object.keys(digestMap.digests)) {
    const entry = digestMap.digests[msgId];
    const sentAt = new Date(entry.sent_at).getTime();
    if (now - sentAt > cutoff) {
      delete digestMap.digests[msgId];
    }
  }

  return digestMap;
}

/**
 * Store a digest mapping entry (number -> email metadata).
 *
 * @param {string} telegramMsgId - First Telegram message ID of the digest.
 * @param {object} mapping - Number-to-email mapping object.
 */
function storeDigestMapping(telegramMsgId, mapping) {
  const digestMap = pruneDigestMap(loadState(DIGEST_MAP_PATH));

  digestMap.digests[telegramMsgId] = {
    sent_at: new Date().toISOString(),
    mapping: mapping
  };

  saveState(DIGEST_MAP_PATH, digestMap);
}

// ---------------------------------------------------------------------------
// Digest sending
// ---------------------------------------------------------------------------

/**
 * Reconstruct a classified-email-like object from a buffered email,
 * suitable for passing to formatDigest.
 *
 * @param {object} buffered - Buffered email from batch-buffer.json.
 * @returns {object} Object matching classifyPipeline output shape.
 */
function bufferedToClassified(buffered) {
  return {
    categories: buffered.classification.categories,
    reasoning: buffered.classification.reasoning,
    recommended_action: buffered.classification.recommended_action,
    is_urgent: buffered.classification.is_urgent,
    confidenceTier: buffered.classification.confidenceTier,
    is_unknown_sender: buffered.is_unknown_sender,
    account: buffered.account,
    sender: buffered.sender,
    subject: buffered.subject,
    snippet: buffered.snippet,
    threadId: buffered.threadId,
    messageId: buffered.messageId
  };
}

/**
 * Send the digest for a specific account via Telegram.
 *
 * @param {string} account - 'personal' or 'work'.
 * @param {function} telegramSendFn - async (text, parseMode) => telegramMessageId
 * @returns {Promise<number>} Number of emails delivered.
 */
async function sendDigest(account, telegramSendFn) {
  const buffer = loadState(BATCH_BUFFER_PATH);
  const acctBuf = buffer[account];

  if (!acctBuf || acctBuf.emails.length === 0) {
    return 0;
  }

  // Convert buffered emails to classified format for the formatter
  const classifiedEmails = acctBuf.emails.map(bufferedToClassified);
  const emailCount = classifiedEmails.length;

  // Format digest messages
  const messages = formatDigest(classifiedEmails, account);

  // Send each message chunk and collect Telegram message IDs
  const telegramMsgIds = [];
  for (const msg of messages) {
    const msgId = await telegramSendFn(msg, 'HTML');
    telegramMsgIds.push(msgId);
  }

  // Build number-to-email mapping
  // Sort same way as formatDigest does (urgent first, then confidence desc)
  const sorted = [...classifiedEmails].sort((a, b) => {
    if (a.is_urgent && !b.is_urgent) return -1;
    if (!a.is_urgent && b.is_urgent) return 1;
    return b.categories[0].confidence - a.categories[0].confidence;
  });

  const mapping = {};
  for (let i = 0; i < sorted.length; i++) {
    mapping[String(i + 1)] = {
      threadId: sorted[i].threadId,
      messageId: sorted[i].messageId,
      account: sorted[i].account
    };
  }

  // Store mapping keyed by first Telegram message ID
  if (telegramMsgIds.length > 0) {
    storeDigestMapping(String(telegramMsgIds[0]), mapping);
  }

  // Clear buffer for this account
  buffer[account].emails = [];
  buffer[account].last_digest_sent = new Date().toISOString();
  saveState(BATCH_BUFFER_PATH, buffer);

  return emailCount;
}

// ---------------------------------------------------------------------------
// Urgent notification
// ---------------------------------------------------------------------------

/**
 * Send an urgent standalone notification via Telegram.
 *
 * @param {object} classifiedEmail - Single classified email with delivery='immediate'.
 * @param {function} telegramSendFn - async (text, parseMode) => telegramMessageId
 * @returns {Promise<string|number>} Telegram message ID.
 */
async function sendUrgentNotification(classifiedEmail, telegramSendFn) {
  const message = formatUrgentNotification(classifiedEmail);
  const telegramMsgId = await telegramSendFn(message, 'HTML');

  // Store single-entry mapping for reply handling
  const mapping = {
    '1': {
      threadId: classifiedEmail.threadId,
      messageId: classifiedEmail.messageId,
      account: classifiedEmail.account
    }
  };

  storeDigestMapping(String(telegramMsgId), mapping);

  return telegramMsgId;
}

// ---------------------------------------------------------------------------
// Reply handler
// ---------------------------------------------------------------------------

/**
 * Handle a user's numbered reply to a digest or urgent notification.
 *
 * @param {string} telegramMsgId - Telegram message ID being replied to.
 * @param {string} replyText - The user's reply text.
 * @returns {object} Result object with success/error info.
 */
function handleDigestReply(telegramMsgId, replyText) {
  const digestMap = pruneDigestMap(loadState(DIGEST_MAP_PATH));
  saveState(DIGEST_MAP_PATH, digestMap);

  const entry = digestMap.digests[String(telegramMsgId)];

  if (!entry) {
    return { error: 'no_mapping', message: 'Could not find the referenced digest.' };
  }

  // Check expiry
  const sentAt = new Date(entry.sent_at).getTime();
  const now = Date.now();
  const hoursSince = (now - sentAt) / (1000 * 60 * 60);

  if (hoursSince > DIGEST_EXPIRY_HOURS) {
    return { error: 'expired', message: 'This digest has expired. Check the latest digest for current emails.' };
  }

  // Parse number from reply text (first integer in string)
  const match = replyText.match(/(\d+)/);
  if (!match) {
    return { error: 'non_numeric', message: null };
  }

  const number = parseInt(match[1], 10);
  const mappingKeys = Object.keys(entry.mapping).map(Number);
  const maxNumber = Math.max(...mappingKeys);

  if (!entry.mapping[String(number)]) {
    return {
      error: 'out_of_range',
      message: `No email #${number} in the last digest. Valid range: 1-${maxNumber}.`
    };
  }

  return {
    success: true,
    email: entry.mapping[String(number)]
  };
}

// ---------------------------------------------------------------------------
// Main processing pipeline
// ---------------------------------------------------------------------------

/**
 * Process classified emails: route urgent to immediate, non-urgent to batch.
 * After processing, check if any account digests should be sent.
 *
 * @param {object} classifiedResults - Output from classifyPipeline: { classified: [...], failed: [...] }
 * @param {function} telegramSendFn - async (text, parseMode, replyMarkup?) => telegramMessageId
 * @param {function} [sessionSpawnFn] - async ({ agentId, task, label, runTimeoutSeconds }) => { status, runId, childSessionKey }
 * @returns {Promise<object>} Summary: { urgent_sent, buffered, failed, digests_sent, drafts_created, delegations }
 */
async function processClassifiedEmails(classifiedResults, telegramSendFn, sessionSpawnFn) {
  let urgentSent = 0;
  let buffered = 0;
  const failedCount = classifiedResults.failed ? classifiedResults.failed.length : 0;
  const draftResults = [];
  const delegationResults = [];

  // Process each classified email
  for (const email of classifiedResults.classified) {
    if (email.delivery === 'immediate') {
      await sendUrgentNotification(email, telegramSendFn);
      urgentSent++;
    } else {
      addToBatchBuffer(email);
      buffered++;
    }
  }

  // -----------------------------------------------------------------------
  // Stage 3b: Draft generation (D-03, D-16)
  // -----------------------------------------------------------------------
  for (const email of classifiedResults.classified) {
    const primaryCategory = email.categories[0].category;

    // Auto-draft for routine and calendar (D-03)
    if (['routine', 'calendar'].includes(primaryCategory)) {
      const draftResult = await generateDraft(email);
      if (draftResult.created || draftResult.updated) {
        if (email.delivery === 'immediate') {
          const msg = formatUrgentDraftNotification(email, draftResult);
          const kb = buildDraftApprovalKeyboard(draftResult.draftId, email.threadId, email.account);
          await telegramSendFn(msg, 'HTML', kb);
        }
        draftResults.push(draftResult);
      }
    }

    // Auto smart draft for urgent (D-04)
    if (primaryCategory === 'urgent') {
      const draftResult = await generateSmartDraft(email);
      if (draftResult.created || draftResult.updated) {
        const msg = formatUrgentDraftNotification(email, draftResult);
        const kb = buildDraftApprovalKeyboard(draftResult.draftId, email.threadId, email.account);
        await telegramSendFn(msg, 'HTML', kb);
        draftResults.push(draftResult);
      }
    }
  }

  // -----------------------------------------------------------------------
  // Stage 3c: Delegation (D-06, D-07)
  // -----------------------------------------------------------------------
  if (sessionSpawnFn) {
    for (const email of classifiedResults.classified) {
      const primaryCategory = email.categories[0].category;
      if (DELEGATION_CATEGORIES.includes(primaryCategory)) {
        const delegResult = await delegateToAgent(email, sessionSpawnFn);
        if (delegResult.queued) {
          await telegramSendFn(
            `@${delegResult.agentId} unavailable — queued "${escapeHtml(email.subject)}". Will retry in 15m.`,
            'HTML'
          );
        }
        delegationResults.push(delegResult);
      }
    }
  }

  // Log warnings for failed emails (retried next heartbeat cycle)
  if (failedCount > 0) {
    console.warn(`[delivery] ${failedCount} emails failed classification, will retry next cycle`);
  }

  // Check if digests should be sent -- work first per D-12
  const digestsSent = [];

  if (shouldSendDigest('work')) {
    await sendDigest('work', telegramSendFn);
    digestsSent.push('work');
  }

  if (shouldSendDigest('personal')) {
    await sendDigest('personal', telegramSendFn);
    digestsSent.push('personal');
  }

  return {
    urgent_sent: urgentSent,
    buffered: buffered,
    failed: failedCount,
    digests_sent: digestsSent,
    drafts_created: draftResults.length,
    delegations: delegationResults.length,
    draftResults,
    delegationResults
  };
}

// ---------------------------------------------------------------------------
// Callback query handler (Telegram inline keyboard actions)
// ---------------------------------------------------------------------------

/**
 * Handle a Telegram callback query from inline keyboard button press.
 * Actions: da (approve & send), dd (discard), de (quick edit), ds (snooze).
 *
 * @param {string} callbackData - Callback data string from Telegram (e.g. "da:abc123def456").
 * @param {function} telegramSendFn - async (text, parseMode) => telegramMessageId
 * @returns {Promise<object>} Result with success/error info.
 */
async function handleCallbackQuery(callbackData, telegramSendFn) {
  const parts = callbackData.split(':');
  const action = parts[0];
  const shortKey = parts[1];

  // Load draft tracker to resolve shortKey to full draft info
  const tracker = loadState(DRAFT_TRACKER_PATH);
  const threadId = Object.keys(tracker.drafts).find(k => tracker.drafts[k].short_key === shortKey);
  const entry = threadId ? tracker.drafts[threadId] : null;

  if (!entry) {
    return { error: 'draft_not_found', message: 'Draft not found or already processed.' };
  }

  switch (action) {
    case 'da': {
      // Approve & Send
      const gmail = getGmailClient(entry.account);
      await gmail.users.drafts.send({ userId: 'me', requestBody: { id: entry.draftId } });
      updateDraftStatus(threadId, 'approved');
      await telegramSendFn(`Draft sent for "${escapeHtml(entry.subject)}" (${entry.account}).`, 'HTML');
      return { success: true, action: 'approved' };
    }

    case 'dd': {
      // Discard
      await deleteGmailDraft(entry.account, entry.draftId);
      updateDraftStatus(threadId, 'discarded');
      await telegramSendFn(`Draft discarded for "${escapeHtml(entry.subject)}".`, 'HTML');
      return { success: true, action: 'discarded' };
    }

    case 'de': {
      // Quick Edit -- set state to awaiting edit text
      updateDraftStatus(threadId, 'editing');
      await telegramSendFn(`Reply with your edited text for "${escapeHtml(entry.subject)}". I'll update the Gmail draft.`, 'HTML');
      return { success: true, action: 'editing', threadId };
    }

    case 'ds': {
      // Snooze
      const duration = parts[2]; // '1', '3', or 't' (tomorrow)
      let snoozeUntil;
      const now = new Date();
      if (duration === 't') {
        snoozeUntil = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 9, 0, 0);
      } else {
        snoozeUntil = new Date(now.getTime() + parseInt(duration, 10) * 60 * 60 * 1000);
      }
      tracker.drafts[threadId].snooze_until = snoozeUntil.toISOString();
      saveState(DRAFT_TRACKER_PATH, tracker);
      const label = duration === 't' ? 'tomorrow 9 AM' : `${duration} hour(s)`;
      await telegramSendFn(`Draft snoozed for "${escapeHtml(entry.subject)}" until ${label}.`, 'HTML');
      return { success: true, action: 'snoozed', until: snoozeUntil.toISOString() };
    }

    default: {
      return { error: 'unknown_action', message: `Unknown action: ${action}` };
    }
  }
}

// ---------------------------------------------------------------------------
// Delegation result handler (DELEG-08 announce-back)
// ---------------------------------------------------------------------------

/**
 * Handle a delegation result when a sub-agent completes.
 *
 * @param {string} runId - The runId from sessions_spawn.
 * @param {*} result - The result from the sub-agent.
 * @param {function} telegramSendFn - async (text, parseMode) => telegramMessageId
 * @returns {Promise<object>} Result with success/error info.
 */
async function handleDelegationResult(runId, result, telegramSendFn) {
  const entry = markDelegationComplete(runId, result);
  if (!entry) {
    console.log(`[delivery] No delegation found for runId: ${runId}`);
    return { error: true, message: 'delegation_not_found' };
  }

  const subject = entry.context ? entry.context.subject : 'Unknown';
  const agentId = entry.target_agent;
  const message = formatDelegationResult(agentId, subject, result);
  await telegramSendFn(message, 'HTML');

  return { success: true, agentId, subject };
}

// ---------------------------------------------------------------------------
// Heartbeat maintenance
// ---------------------------------------------------------------------------

/**
 * Run periodic maintenance tasks: delegation retry queue, follow-ups, draft expiry.
 *
 * @param {function} sessionSpawnFn - async ({ agentId, task, label, runTimeoutSeconds }) => result
 * @param {function} telegramSendFn - async (text, parseMode) => telegramMessageId
 * @returns {Promise<object>} Maintenance results summary.
 */
async function runHeartbeatMaintenance(sessionSpawnFn, telegramSendFn) {
  // 1. Process delegation retry queue
  const queueResult = await processDelegationQueue(sessionSpawnFn, telegramSendFn);

  // 2. Check delegation follow-ups
  const followUpResult = await checkFollowUps(telegramSendFn);

  // 3. Cleanup expired drafts (D-17)
  const expiredSubjects = await cleanupExpiredDrafts();
  for (const subject of expiredSubjects) {
    await telegramSendFn(`Draft expired: "${escapeHtml(subject)}". No action taken.`, 'HTML');
  }

  return { queue: queueResult, followUps: followUpResult, expiredDrafts: expiredSubjects.length };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  addToBatchBuffer,
  shouldSendDigest,
  sendDigest,
  sendUrgentNotification,
  handleDigestReply,
  processClassifiedEmails,
  handleCallbackQuery,
  handleDelegationResult,
  runHeartbeatMaintenance,

  // Exposed for testing
  BATCH_INTERVAL_HOURS,
  DIGEST_EXPIRY_HOURS,
  BATCH_BUFFER_PATH,
  DIGEST_MAP_PATH
};
