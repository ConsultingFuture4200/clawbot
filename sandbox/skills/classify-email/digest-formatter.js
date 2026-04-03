'use strict';

const { CONFIDENCE_THRESHOLDS } = require('./types');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum Telegram message length (4096 limit minus 96 safety margin). */
const MAX_MSG_LENGTH = 4000;

/**
 * Map internal category names to display tags.
 * spam_noise -> SPAM per UI-SPEC contract.
 */
const CATEGORY_TAG_MAP = {
  code: 'CODE',
  calendar: 'CALENDAR',
  research: 'RESEARCH',
  home: 'HOME',
  urgent: 'URGENT',
  routine: 'ROUTINE',
  spam_noise: 'SPAM'
};

// ---------------------------------------------------------------------------
// HTML escaping
// ---------------------------------------------------------------------------

/**
 * Escape user-sourced strings for Telegram HTML parse mode.
 * Only &, <, > need escaping per Telegram Bot API docs.
 *
 * @param {string} text - Raw text to escape.
 * @returns {string} HTML-safe text.
 */
function escapeHtml(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ---------------------------------------------------------------------------
// Digest formatting
// ---------------------------------------------------------------------------

/**
 * Build the category tag string for a classified email.
 * Appends ' URGENT' if the email is urgent.
 *
 * @param {object} classifiedEmail - Classified email object.
 * @returns {string} Tag like '[CODE]' or '[CODE URGENT]'.
 */
function buildCategoryTag(classifiedEmail) {
  const primary = classifiedEmail.categories[0];
  const tag = CATEGORY_TAG_MAP[primary.category] || primary.category.toUpperCase();

  if (classifiedEmail.is_urgent) {
    return `[${tag} URGENT]`;
  }
  return `[${tag}]`;
}

/**
 * Format a single email entry for the digest.
 *
 * @param {object} email - Classified email object.
 * @param {number} globalNumber - Continuous numbering across messages.
 * @returns {string} Formatted entry string.
 */
function formatEntry(email, globalNumber) {
  const tag = buildCategoryTag(email);
  const sender = escapeHtml(email.sender);
  const subject = escapeHtml(email.subject);
  const action = escapeHtml(email.recommended_action);
  const primaryConfidence = email.categories[0].confidence;
  const isLowConfidence = primaryConfidence < CONFIDENCE_THRESHOLDS.ASK_USER;

  // Build secondary category note if applicable
  const secondaryCategories = email.categories
    .slice(1)
    .filter(c => c.confidence > 0.50)
    .map(c => CATEGORY_TAG_MAP[c.category] || c.category.toUpperCase());

  let actionSuffix = '';
  if (secondaryCategories.length > 0) {
    actionSuffix = ` (also ${secondaryCategories.join(', ')})`;
  }

  let entry = `${globalNumber}. ${tag} ${sender}\n`;
  entry += `   "${subject}"\n`;

  if (isLowConfidence) {
    entry += `   ? -> ${action}${actionSuffix}\n`;
    entry += `   <i>Reasoning: ${escapeHtml(email.reasoning)}</i>`;
  } else {
    entry += `   -> ${action}${actionSuffix}`;
  }

  if (email.is_unknown_sender) {
    entry += '\n   NEW SENDER';
  }

  return entry;
}

/**
 * Sort classified emails: urgent first, then by primary confidence descending.
 *
 * @param {Array<object>} emails - Array of classified email objects.
 * @returns {Array<object>} Sorted copy.
 */
function sortEmails(emails) {
  return [...emails].sort((a, b) => {
    // Urgent first
    if (a.is_urgent && !b.is_urgent) return -1;
    if (!a.is_urgent && b.is_urgent) return 1;
    // Then by primary confidence descending
    return b.categories[0].confidence - a.categories[0].confidence;
  });
}

/**
 * Format a digest of classified emails for a single account.
 *
 * Returns an array of strings, each <= MAX_MSG_LENGTH, formatted as HTML
 * for Telegram's parse_mode: "HTML". Numbering is continuous across splits.
 *
 * @param {Array<object>} classifiedEmails - Classified email objects for one account.
 * @param {string} account - 'personal' or 'work'.
 * @param {number} [startNumber=1] - Starting number for continuous numbering.
 * @returns {Array<string>} Array of message strings.
 */
function formatDigest(classifiedEmails, account, startNumber) {
  if (!classifiedEmails || classifiedEmails.length === 0) {
    return [formatEmptyState(0)];
  }

  const sorted = sortEmails(classifiedEmails);
  const accountLabel = account.toUpperCase();
  const header = `<b>${accountLabel}</b> (${sorted.length} new)\n\n`;
  const continuationHeader = `<b>${accountLabel}</b> (continued)\n\n`;
  const footer = '\n\n<i>Reply with a number to act on that email.</i>';
  const continuationMarker = '\n\n<i>continued...</i>';

  const messages = [];
  let currentMsg = header;
  let globalNumber = startNumber || 1;
  let isFirstChunk = true;

  for (let i = 0; i < sorted.length; i++) {
    const entry = formatEntry(sorted[i], globalNumber);
    const separator = (currentMsg === header || currentMsg === continuationHeader) ? '' : '\n\n';
    const candidateAddition = separator + entry;

    // Check if adding this entry would exceed the limit
    // Reserve space for footer or continuation marker
    const isLastEntry = i === sorted.length - 1;
    const reserveLen = isLastEntry ? footer.length : continuationMarker.length;

    if (currentMsg.length + candidateAddition.length + reserveLen > MAX_MSG_LENGTH) {
      // Current message is full -- finalize with continuation marker
      currentMsg += continuationMarker;
      messages.push(currentMsg);
      // Start new message with continuation header
      currentMsg = continuationHeader + entry;
      isFirstChunk = false;
    } else {
      currentMsg += candidateAddition;
    }

    globalNumber++;
  }

  // Finalize last message with footer
  currentMsg += footer;
  messages.push(currentMsg);

  return messages;
}

// ---------------------------------------------------------------------------
// Urgent standalone notification
// ---------------------------------------------------------------------------

/**
 * Format an urgent standalone notification for immediate delivery.
 *
 * @param {object} classifiedEmail - Single classified email with is_urgent === true.
 * @returns {string} Formatted urgent notification string.
 */
function formatUrgentNotification(classifiedEmail) {
  const sender = escapeHtml(classifiedEmail.sender);
  const subject = escapeHtml(classifiedEmail.subject);
  const account = classifiedEmail.account;
  const primary = classifiedEmail.categories[0];
  const categoryTag = CATEGORY_TAG_MAP[primary.category] || primary.category.toUpperCase();
  const action = escapeHtml(classifiedEmail.recommended_action);

  return [
    'URGENT EMAIL',
    '',
    `From: ${sender}`,
    `Subject: "${subject}"`,
    `Account: ${account}`,
    `Category: ${categoryTag}`,
    '',
    `-> ${action}`,
    '',
    '<i>Reply to act on this email.</i>'
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Empty & error states
// ---------------------------------------------------------------------------

/**
 * Format the empty state message.
 *
 * @param {number} spamCount - Number of emails filtered as spam.
 * @returns {string} Empty state message.
 */
function formatEmptyState(spamCount) {
  if (spamCount === 0) {
    return 'No new emails since last digest.';
  }
  return `${spamCount} emails received, all filtered as spam/noise. No action needed.`;
}

/**
 * Format an error state message.
 *
 * @param {'gemini_api' | 'ollama_offline' | 'gmail_api' | 'rate_limit'} errorType
 * @param {object} details - Error-specific details.
 * @returns {string} Error message string.
 */
function formatErrorState(errorType, details) {
  switch (errorType) {
    case 'gemini_api':
      return `Classification unavailable -- Gemini API error. ${details.count} emails queued for next cycle. Check API key and rate limits.`;
    case 'ollama_offline':
      return `Local spam filter offline -- Ollama not responding. Sending all ${details.count} emails to Gemini for classification.`;
    case 'gmail_api':
      return `Gmail sync failed for ${details.account}. Error: ${details.error_code}. Will retry next heartbeat cycle.`;
    case 'rate_limit':
      return `Gemini rate limit reached. ${details.count} emails queued for classification in next cycle (${details.minutes} min).`;
    default:
      return `Unknown error: ${errorType}`;
  }
}

// ---------------------------------------------------------------------------
// Draft notification formatting
// ---------------------------------------------------------------------------

/**
 * Format a Telegram notification for a created draft.
 * Uses HTML parse mode. All user-sourced strings escaped.
 *
 * @param {object} classifiedEmail - Classified email object.
 * @param {object} draftResult - Result from generateDraft/generateSmartDraft.
 * @returns {string} HTML-formatted Telegram message.
 */
function formatDraftNotification(classifiedEmail, draftResult) {
  const account = classifiedEmail.account.toUpperCase();
  const sender = escapeHtml(classifiedEmail.sender);
  const subject = escapeHtml(classifiedEmail.subject);
  const primary = classifiedEmail.categories[0];
  const categoryTag = CATEGORY_TAG_MAP[primary.category] || primary.category.toUpperCase();
  const category = primary.category;
  const model = category === 'urgent' ? 'Claude' : 'Gemini';
  const preview = draftResult.draftText
    ? escapeHtml(draftResult.draftText.slice(0, 100))
    : '';

  return [
    `<b>Draft ready (${account})</b>`,
    '',
    `From: ${sender}`,
    `Subject: "${subject}"`,
    `Category: ${categoryTag}`,
    `Draft type: ${escapeHtml(category)} (via ${model})`,
    '',
    `${preview}...`,
    '',
    '<i>Use the buttons below to approve, edit, or discard this draft.</i>'
  ].join('\n');
}

/**
 * Format an urgent draft notification for immediate delivery.
 *
 * @param {object} classifiedEmail - Classified email with urgent priority.
 * @param {object} draftResult - Result from generateSmartDraft.
 * @returns {string} HTML-formatted Telegram message.
 */
function formatUrgentDraftNotification(classifiedEmail, draftResult) {
  const account = classifiedEmail.account.toUpperCase();
  const sender = escapeHtml(classifiedEmail.sender);
  const subject = escapeHtml(classifiedEmail.subject);
  const preview = draftResult.draftText
    ? escapeHtml(draftResult.draftText.slice(0, 200))
    : '';

  return [
    `<b>URGENT -- Draft ready (${account})</b>`,
    '',
    `From: ${sender}`,
    `Subject: "${subject}"`,
    '',
    'Draft preview:',
    `"${preview}..."`,
    '',
    '<i>Approve to send, or edit in Gmail for full formatting.</i>'
  ].join('\n');
}

/**
 * Build a Telegram inline keyboard for draft approval actions.
 *
 * CRITICAL: Telegram callback_data has a 64-byte limit (Pitfall 4).
 * Uses short prefixes (da: dd: de: ds:) + draftId.slice(0,12).
 *
 * @param {string} draftId - Gmail draft ID (will be truncated to 12 chars).
 * @param {string} threadId - Gmail thread ID (for reference, not in callback_data).
 * @param {'personal' | 'work'} account - Gmail account.
 * @returns {object} Telegram inline_keyboard object.
 */
function buildDraftApprovalKeyboard(draftId, threadId, account) {
  const shortKey = draftId.slice(0, 12);
  const accountIndex = account === 'work' ? '1' : '0';

  return {
    inline_keyboard: [
      [
        { text: 'Approve & Send', callback_data: `da:${shortKey}` },
        { text: 'Discard', callback_data: `dd:${shortKey}` }
      ],
      [
        { text: 'Edit in Gmail', url: `https://mail.google.com/mail/u/${accountIndex}/#drafts` },
        { text: 'Quick Edit', callback_data: `de:${shortKey}` }
      ],
      [
        { text: '1hr', callback_data: `ds:${shortKey}:1` },
        { text: '3hr', callback_data: `ds:${shortKey}:3` },
        { text: 'Tomorrow', callback_data: `ds:${shortKey}:t` }
      ]
    ]
  };
}

// ---------------------------------------------------------------------------
// Delegation result formatting
// ---------------------------------------------------------------------------

/**
 * Format a delegation completion notification for Telegram (DELEG-08).
 *
 * @param {string} agentId - The agent that completed the delegation.
 * @param {string} subject - Original email subject.
 * @param {*} result - Result data from the sub-agent.
 * @returns {string} HTML-formatted Telegram message.
 */
function formatDelegationResult(agentId, subject, result) {
  const safeSubject = escapeHtml(subject);
  const summary = typeof result === 'string'
    ? escapeHtml(result)
    : escapeHtml(JSON.stringify(result));

  return [
    `<b>Agent update: @${escapeHtml(agentId)}</b>`,
    '',
    `Re: "${safeSubject}"`,
    summary
  ].join('\n');
}

/**
 * Format a delegation follow-up nudge for Telegram.
 *
 * @param {string} agentId - The agent that has not responded.
 * @param {string} subject - Original email subject.
 * @param {number} hoursAgo - Hours since delegation.
 * @returns {string} HTML-formatted Telegram message.
 */
function formatDelegationNudge(agentId, subject, hoursAgo) {
  const safeSubject = escapeHtml(subject);
  return `@${escapeHtml(agentId)} hasn't responded to "${safeSubject}" (delegated ${hoursAgo}h ago). Nudge the agent or take over?`;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  formatDigest,
  formatUrgentNotification,
  formatEmptyState,
  formatErrorState,
  escapeHtml,

  // Draft notification formatting
  formatDraftNotification,
  formatUrgentDraftNotification,
  buildDraftApprovalKeyboard,

  // Delegation result formatting
  formatDelegationResult,
  formatDelegationNudge,

  // Exposed for testing
  MAX_MSG_LENGTH,
  CATEGORY_TAG_MAP
};
