'use strict';

const fs = require('fs');
const path = require('path');
const { OAuth2Client } = require('google-auth-library');
const { gmail_v1 } = require('@googleapis/gmail');
const { google } = require('googleapis');

const {
  DRAFT_CATEGORIES,
  DRAFT_TTL_HOURS,
  DRAFT_TRACKER_PATH
} = require('./types');

const { getDraftText, generateSmartDraftText } = require('./draft-templates');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Path to OAuth client secret (shared across accounts). */
const CLIENT_SECRET_PATH = '/sandbox/config/client_secret.json';

/** Per-account token file pattern. */
const TOKEN_PATH_PREFIX = '/sandbox/state/token-';

// ---------------------------------------------------------------------------
// State file helpers (reuse pattern from delivery.js)
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
 * Save a JSON state file.
 * @param {string} filePath - Absolute path to JSON file.
 * @param {object} data - Object to serialize.
 */
function saveState(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

// ---------------------------------------------------------------------------
// OAuth / Gmail client
// ---------------------------------------------------------------------------

/**
 * Create an OAuth2Client for the given account, loaded with stored tokens.
 *
 * @param {'personal' | 'work'} account
 * @returns {OAuth2Client} Configured OAuth2 client with credentials set.
 */
function getOAuth2Client(account) {
  const secretRaw = fs.readFileSync(CLIENT_SECRET_PATH, 'utf8');
  const secret = JSON.parse(secretRaw);

  // client_secret.json can have "installed" or "web" key
  const creds = secret.installed || secret.web;
  if (!creds) {
    throw new Error('Invalid client_secret.json: missing "installed" or "web" key');
  }

  const oauth2 = new OAuth2Client(
    creds.client_id,
    creds.client_secret,
    creds.redirect_uris ? creds.redirect_uris[0] : 'urn:ietf:wg:oauth:2.0:oob'
  );

  const tokenPath = `${TOKEN_PATH_PREFIX}${account}.json`;
  const tokenRaw = fs.readFileSync(tokenPath, 'utf8');
  const tokens = JSON.parse(tokenRaw);
  oauth2.setCredentials(tokens);

  return oauth2;
}

/**
 * Create a Gmail API client for the given account.
 *
 * @param {'personal' | 'work'} account
 * @returns {gmail_v1.Gmail} Gmail API client.
 */
function getGmailClient(account) {
  const auth = getOAuth2Client(account);
  return new gmail_v1.Gmail({ auth });
}

// ---------------------------------------------------------------------------
// MIME construction
// ---------------------------------------------------------------------------

/**
 * Build an RFC 2822 MIME message for a reply, encoded as base64url.
 *
 * @param {object} params
 * @param {string} params.to - Recipient email.
 * @param {string} params.from - Sender email.
 * @param {string} params.subject - Original subject (Re: prepended if needed).
 * @param {string} params.body - Plain text body.
 * @param {string} [params.inReplyTo] - Message-ID of the original email.
 * @param {string} [params.references] - References header value.
 * @returns {string} Base64url-encoded MIME message.
 */
function buildReplyMime({ to, from, subject, body, inReplyTo, references }) {
  const reSubject = subject.startsWith('Re: ') ? subject : `Re: ${subject}`;

  const headers = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${reSubject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8'
  ];

  if (inReplyTo) {
    headers.push(`In-Reply-To: ${inReplyTo}`);
    headers.push(`References: ${references || inReplyTo}`);
  }

  const message = headers.join('\r\n') + '\r\n\r\n' + body;
  return Buffer.from(message).toString('base64url');
}

// ---------------------------------------------------------------------------
// Message-ID retrieval
// ---------------------------------------------------------------------------

/**
 * Fetch the original Message-ID and From headers for threading.
 *
 * @param {'personal' | 'work'} account
 * @param {string} messageId - Gmail message ID.
 * @returns {Promise<{ messageIdHeader: string|null, fromHeader: string|null }>}
 */
async function fetchOriginalMessageId(account, messageId) {
  const gmail = getGmailClient(account);

  const res = await gmail.users.messages.get({
    userId: 'me',
    id: messageId,
    format: 'metadata',
    metadataHeaders: ['Message-ID', 'From']
  });

  const headers = res.data.payload && res.data.payload.headers
    ? res.data.payload.headers
    : [];

  let messageIdHeader = null;
  let fromHeader = null;

  for (const h of headers) {
    if (h.name === 'Message-ID') messageIdHeader = h.value;
    if (h.name === 'From') fromHeader = h.value;
  }

  return { messageIdHeader, fromHeader };
}

// ---------------------------------------------------------------------------
// Calendar conflict detection
// ---------------------------------------------------------------------------

/**
 * Check for calendar conflicts during the given time window.
 *
 * @param {'personal' | 'work'} account
 * @param {string} eventStart - ISO 8601 start time.
 * @param {string} eventEnd - ISO 8601 end time.
 * @returns {Promise<{ isFree: boolean|null, conflicts: Array<{ start: string, end: string, summary?: string }> }>}
 */
async function checkCalendarConflict(account, eventStart, eventEnd) {
  // If times are not parseable, return unknown
  if (!eventStart || !eventEnd) {
    return { isFree: null, conflicts: [] };
  }

  try {
    const startDate = new Date(eventStart);
    const endDate = new Date(eventEnd);

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      return { isFree: null, conflicts: [] };
    }

    const auth = getOAuth2Client(account);
    const calendar = google.calendar({ version: 'v3', auth });

    const res = await calendar.freebusy.query({
      requestBody: {
        timeMin: startDate.toISOString(),
        timeMax: endDate.toISOString(),
        timeZone: 'America/Los_Angeles',
        items: [{ id: 'primary' }]
      }
    });

    const busySlots = res.data.calendars &&
      res.data.calendars.primary &&
      res.data.calendars.primary.busy
      ? res.data.calendars.primary.busy
      : [];

    if (busySlots.length === 0) {
      return { isFree: true, conflicts: [] };
    }

    return {
      isFree: false,
      conflicts: busySlots.map(slot => ({
        start: slot.start,
        end: slot.end
      }))
    };
  } catch (err) {
    console.warn(`[draft-generator] Calendar conflict check failed: ${err.message}`);
    return { isFree: null, conflicts: [] };
  }
}

// ---------------------------------------------------------------------------
// Draft creation / update / delete
// ---------------------------------------------------------------------------

/**
 * Create a Gmail draft in the given account.
 *
 * @param {'personal' | 'work'} account
 * @param {object} params
 * @param {string} params.threadId - Gmail thread ID for threading.
 * @param {string} params.raw - Base64url-encoded MIME message.
 * @returns {Promise<{ draftId: string, messageId: string, threadId: string }>}
 */
async function createGmailDraft(account, { threadId, raw }) {
  const gmail = getGmailClient(account);

  const res = await gmail.users.drafts.create({
    userId: 'me',
    requestBody: {
      message: { raw, threadId }
    }
  });

  return {
    draftId: res.data.id,
    messageId: res.data.message.id,
    threadId: res.data.message.threadId
  };
}

/**
 * Update an existing Gmail draft.
 *
 * @param {'personal' | 'work'} account
 * @param {string} draftId - ID of the draft to update.
 * @param {object} params
 * @param {string} params.threadId - Gmail thread ID for threading.
 * @param {string} params.raw - Base64url-encoded MIME message.
 * @returns {Promise<{ draftId: string, messageId: string, threadId: string }>}
 */
async function updateGmailDraft(account, draftId, { threadId, raw }) {
  const gmail = getGmailClient(account);

  const res = await gmail.users.drafts.update({
    userId: 'me',
    id: draftId,
    requestBody: {
      message: { raw, threadId }
    }
  });

  return {
    draftId: res.data.id,
    messageId: res.data.message.id,
    threadId: res.data.message.threadId
  };
}

/**
 * Delete a Gmail draft. Logs but does not throw on 404 (draft already deleted).
 *
 * @param {'personal' | 'work'} account
 * @param {string} draftId - ID of the draft to delete.
 * @returns {Promise<void>}
 */
async function deleteGmailDraft(account, draftId) {
  try {
    const gmail = getGmailClient(account);
    await gmail.users.drafts.delete({
      userId: 'me',
      id: draftId
    });
  } catch (err) {
    if (err.code === 404 || (err.message && err.message.includes('404'))) {
      console.warn(`[draft-generator] Draft ${draftId} already deleted (404)`);
    } else {
      throw err;
    }
  }
}

// ---------------------------------------------------------------------------
// Draft tracker
// ---------------------------------------------------------------------------

/**
 * Check whether a pending draft already exists for the given thread.
 *
 * @param {string} threadId - Gmail thread ID.
 * @returns {boolean}
 */
function hasDraftForThread(threadId) {
  const tracker = loadState(DRAFT_TRACKER_PATH);
  return !!(tracker.drafts[threadId] && tracker.drafts[threadId].status === 'pending');
}

/**
 * Get the existing draft entry for a thread, if it exists and is pending.
 *
 * @param {string} threadId - Gmail thread ID.
 * @returns {object|null} Draft entry or null.
 */
function getDraftForThread(threadId) {
  const tracker = loadState(DRAFT_TRACKER_PATH);
  const entry = tracker.drafts[threadId];
  if (entry && entry.status === 'pending') {
    return entry;
  }
  return null;
}

/**
 * Track a newly created draft.
 *
 * @param {string} threadId - Gmail thread ID.
 * @param {object} draftInfo
 * @param {string} draftInfo.draftId - Gmail draft ID.
 * @param {string} draftInfo.account - 'personal' or 'work'.
 * @param {string} draftInfo.category - Primary classification category.
 * @param {string} draftInfo.subject - Email subject for display.
 */
function trackDraft(threadId, draftInfo) {
  const tracker = loadState(DRAFT_TRACKER_PATH);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + DRAFT_TTL_HOURS * 60 * 60 * 1000);

  tracker.drafts[threadId] = {
    draftId: draftInfo.draftId,
    account: draftInfo.account,
    category: draftInfo.category,
    subject: draftInfo.subject,
    short_key: draftInfo.draftId.slice(0, 12),
    created_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
    status: 'pending',
    snooze_until: null,
    telegram_msg_id: null
  };

  saveState(DRAFT_TRACKER_PATH, tracker);
}

/**
 * Update the status of a tracked draft.
 *
 * @param {string} threadId - Gmail thread ID.
 * @param {string} status - New status value.
 */
function updateDraftStatus(threadId, status) {
  const tracker = loadState(DRAFT_TRACKER_PATH);
  if (tracker.drafts[threadId]) {
    tracker.drafts[threadId].status = status;
    saveState(DRAFT_TRACKER_PATH, tracker);
  }
}

/**
 * Get all expired pending drafts (past TTL and not snoozed).
 *
 * @returns {Array<{ threadId: string, draftId: string, account: string, subject: string }>}
 */
function getExpiredDrafts() {
  const tracker = loadState(DRAFT_TRACKER_PATH);
  const now = Date.now();
  const expired = [];

  for (const [threadId, entry] of Object.entries(tracker.drafts)) {
    if (entry.status !== 'pending') continue;

    const expiresAt = new Date(entry.expires_at).getTime();
    if (expiresAt >= now) continue;

    // If snoozed, check snooze time
    if (entry.snooze_until) {
      const snoozeUntil = new Date(entry.snooze_until).getTime();
      if (snoozeUntil >= now) continue;
    }

    expired.push({
      threadId,
      draftId: entry.draftId,
      account: entry.account,
      subject: entry.subject
    });
  }

  return expired;
}

/**
 * Clean up expired drafts: delete from Gmail and mark as expired.
 *
 * @returns {Promise<string[]>} Array of cleaned-up email subjects.
 */
async function cleanupExpiredDrafts() {
  const expired = getExpiredDrafts();
  const cleanedSubjects = [];

  for (const item of expired) {
    try {
      await deleteGmailDraft(item.account, item.draftId);
    } catch (err) {
      console.warn(`[draft-generator] Failed to delete expired draft ${item.draftId}: ${err.message}`);
    }
    updateDraftStatus(item.threadId, 'expired');
    cleanedSubjects.push(item.subject);
  }

  return cleanedSubjects;
}

// ---------------------------------------------------------------------------
// Date extraction helper
// ---------------------------------------------------------------------------

/**
 * Attempt to extract ISO date-like strings from email snippet for calendar events.
 * Returns null if no dates found.
 *
 * @param {string} text - Email snippet text.
 * @returns {{ start: string, end: string } | null}
 */
function extractEventTimes(text) {
  // Look for ISO date patterns (YYYY-MM-DDTHH:MM)
  const isoPattern = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/g;
  const matches = text.match(isoPattern);

  if (matches && matches.length >= 2) {
    return { start: matches[0], end: matches[1] };
  }

  if (matches && matches.length === 1) {
    // Single date found — assume 1-hour event
    const start = new Date(matches[0]);
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    return { start: matches[0], end: end.toISOString() };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Main orchestrator
// ---------------------------------------------------------------------------

/**
 * Generate a draft for a classified email. Primary entry point (D-03, D-16, D-18).
 *
 * If a draft already exists for the thread, updates it in-place (D-18).
 * Routes to correct model based on category (D-01):
 *   routine -> Gemini ack, calendar -> RSVP with conflict check, urgent -> Claude.
 *
 * @param {object} classifiedEmail - Classified email from pipeline.
 * @returns {Promise<object>} Result object with created/updated/skipped/error status.
 */
async function generateDraft(classifiedEmail) {
  try {
    const { threadId, messageId, account, subject } = classifiedEmail;
    const primaryCategory = classifiedEmail.categories[0].category;

    // D-18: If draft exists for this thread, update rather than create duplicate
    if (hasDraftForThread(threadId)) {
      const existingEntry = getDraftForThread(threadId);

      // Generate new draft text
      let conflictResult = null;
      if (primaryCategory === 'calendar') {
        const times = extractEventTimes(classifiedEmail.snippet || '');
        if (times) {
          conflictResult = await checkCalendarConflict(account, times.start, times.end);
        }
      }

      const draftText = await getDraftText(classifiedEmail, conflictResult);
      if (!draftText) {
        return { skipped: true, reason: 'no_draft_text_on_update' };
      }

      // Fetch original message headers for threading
      const { messageIdHeader, fromHeader } = await fetchOriginalMessageId(account, messageId);

      // Build new MIME
      const raw = buildReplyMime({
        to: fromHeader || classifiedEmail.sender,
        from: `${account}@gmail.com`,
        subject: subject,
        body: draftText,
        inReplyTo: messageIdHeader
      });

      // Update existing draft
      const updatedResult = await updateGmailDraft(account, existingEntry.draftId, { threadId, raw });

      // Reset status and update tracker
      updateDraftStatus(threadId, 'pending');

      // Update draftId and short_key if they changed
      const tracker = loadState(DRAFT_TRACKER_PATH);
      if (tracker.drafts[threadId]) {
        tracker.drafts[threadId].draftId = updatedResult.draftId;
        tracker.drafts[threadId].short_key = updatedResult.draftId.slice(0, 12);
        saveState(DRAFT_TRACKER_PATH, tracker);
      }

      return {
        updated: true,
        draftId: updatedResult.draftId,
        threadId,
        account,
        category: primaryCategory,
        draftText
      };
    }

    // Check if category gets a draft
    if (!DRAFT_CATEGORIES.includes(primaryCategory)) {
      return { skipped: true, reason: 'no_draft_category' };
    }

    // Calendar conflict check
    let conflictResult = null;
    if (primaryCategory === 'calendar') {
      const times = extractEventTimes(classifiedEmail.snippet || '');
      if (times) {
        conflictResult = await checkCalendarConflict(account, times.start, times.end);
      }
    }

    // Generate draft text
    const draftText = await getDraftText(classifiedEmail, conflictResult);
    if (!draftText) {
      return { skipped: true, reason: 'no_draft_text' };
    }

    // Fetch original message headers for threading
    const { messageIdHeader, fromHeader } = await fetchOriginalMessageId(account, messageId);

    // Build MIME
    const raw = buildReplyMime({
      to: fromHeader || classifiedEmail.sender,
      from: `${account}@gmail.com`,
      subject: subject,
      body: draftText,
      inReplyTo: messageIdHeader
    });

    // Create Gmail draft
    const draftResult = await createGmailDraft(account, { threadId, raw });

    // Track draft
    trackDraft(threadId, {
      draftId: draftResult.draftId,
      account,
      category: primaryCategory,
      subject
    });

    return {
      created: true,
      draftId: draftResult.draftId,
      threadId,
      account,
      category: primaryCategory,
      draftText
    };
  } catch (err) {
    console.error(`[draft-generator] Error creating draft: ${err.message}`);
    return { error: true, message: err.message };
  }
}

/**
 * Generate a smart draft for urgent emails (D-04).
 * Forces Claude smart draft regardless of category.
 *
 * @param {object} classifiedEmail - Classified email from pipeline.
 * @returns {Promise<object>} Result object with created/updated/error status.
 */
async function generateSmartDraft(classifiedEmail) {
  try {
    const { threadId, messageId, account, subject } = classifiedEmail;
    const primaryCategory = classifiedEmail.categories[0].category;

    // Generate smart draft text via Claude
    const draftText = await generateSmartDraftText(classifiedEmail);

    // Check for existing draft (D-18)
    if (hasDraftForThread(threadId)) {
      const existingEntry = getDraftForThread(threadId);

      const { messageIdHeader, fromHeader } = await fetchOriginalMessageId(account, messageId);

      const raw = buildReplyMime({
        to: fromHeader || classifiedEmail.sender,
        from: `${account}@gmail.com`,
        subject: subject,
        body: draftText,
        inReplyTo: messageIdHeader
      });

      const updatedResult = await updateGmailDraft(account, existingEntry.draftId, { threadId, raw });

      updateDraftStatus(threadId, 'pending');

      const tracker = loadState(DRAFT_TRACKER_PATH);
      if (tracker.drafts[threadId]) {
        tracker.drafts[threadId].draftId = updatedResult.draftId;
        tracker.drafts[threadId].short_key = updatedResult.draftId.slice(0, 12);
        saveState(DRAFT_TRACKER_PATH, tracker);
      }

      return {
        updated: true,
        draftId: updatedResult.draftId,
        threadId,
        account,
        category: primaryCategory,
        draftText
      };
    }

    // Fetch original message headers for threading
    const { messageIdHeader, fromHeader } = await fetchOriginalMessageId(account, messageId);

    // Build MIME
    const raw = buildReplyMime({
      to: fromHeader || classifiedEmail.sender,
      from: `${account}@gmail.com`,
      subject: subject,
      body: draftText,
      inReplyTo: messageIdHeader
    });

    // Create Gmail draft
    const draftResult = await createGmailDraft(account, { threadId, raw });

    // Track draft
    trackDraft(threadId, {
      draftId: draftResult.draftId,
      account,
      category: primaryCategory,
      subject
    });

    return {
      created: true,
      draftId: draftResult.draftId,
      threadId,
      account,
      category: primaryCategory,
      draftText
    };
  } catch (err) {
    console.error(`[draft-generator] Error creating smart draft: ${err.message}`);
    return { error: true, message: err.message };
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  // OAuth / Gmail client
  getOAuth2Client,
  getGmailClient,

  // MIME
  buildReplyMime,

  // Message retrieval
  fetchOriginalMessageId,

  // Calendar
  checkCalendarConflict,

  // Draft CRUD
  createGmailDraft,
  updateGmailDraft,
  deleteGmailDraft,

  // Draft tracker
  hasDraftForThread,
  getDraftForThread,
  trackDraft,
  updateDraftStatus,
  getExpiredDrafts,
  cleanupExpiredDrafts,

  // Main orchestrators
  generateDraft,
  generateSmartDraft
};
