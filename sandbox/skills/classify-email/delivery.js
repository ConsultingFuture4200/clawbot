'use strict';

const fs = require('fs');
const path = require('path');
const {
  formatDigest,
  formatUrgentNotification,
  formatEmptyState,
  formatErrorState
} = require('./digest-formatter');
const { CONFIDENCE_THRESHOLDS } = require('./types');

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
 * @param {function} telegramSendFn - async (text, parseMode) => telegramMessageId
 * @returns {Promise<object>} Summary: { urgent_sent, buffered, failed, digests_sent }
 */
async function processClassifiedEmails(classifiedResults, telegramSendFn) {
  let urgentSent = 0;
  let buffered = 0;
  const failedCount = classifiedResults.failed ? classifiedResults.failed.length : 0;

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
    digests_sent: digestsSent
  };
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

  // Exposed for testing
  BATCH_INTERVAL_HOURS,
  DIGEST_EXPIRY_HOURS,
  BATCH_BUFFER_PATH,
  DIGEST_MAP_PATH
};
