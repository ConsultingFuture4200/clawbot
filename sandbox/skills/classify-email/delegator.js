'use strict';

const fs = require('fs');
const path = require('path');
const {
  DELEGATION_ROUTING,
  DELEGATION_CATEGORIES,
  DELEGATION_MAX_RETRIES,
  DELEGATION_RETRY_DELAY_MINUTES,
  DELEGATION_FOLLOW_UP_HOURS,
  DELEGATION_QUEUE_PATH
} = require('./types');

// ---------------------------------------------------------------------------
// State file helpers (same pattern as delivery.js)
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

/**
 * Generate a unique delegation ID.
 * @returns {string} ID like "deleg-m1abc2-x7y8z9"
 */
function generateId() {
  return 'deleg-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

// ---------------------------------------------------------------------------
// Context packaging (D-08: metadata + classification only, no full body)
// ---------------------------------------------------------------------------

/**
 * Build a delegation context object from a classified email.
 * Contains metadata and classification only -- target agent fetches full body
 * via Gmail API if needed.
 *
 * @param {object} classifiedEmail - Classified email from classifyPipeline.
 * @returns {object} Delegation context with sender, subject, snippet, account,
 *   threadId, messageId, and classification sub-object.
 */
function buildDelegationContext(classifiedEmail) {
  return {
    sender: classifiedEmail.sender,
    subject: classifiedEmail.subject,
    snippet: classifiedEmail.snippet,
    account: classifiedEmail.account,
    threadId: classifiedEmail.threadId,
    messageId: classifiedEmail.messageId,
    classification: {
      categories: classifiedEmail.categories,
      confidence: classifiedEmail.categories[0].confidence,
      reasoning: classifiedEmail.reasoning,
      recommended_action: classifiedEmail.recommended_action
    }
  };
}

// ---------------------------------------------------------------------------
// Task description builder
// ---------------------------------------------------------------------------

/**
 * Build a human-readable task description for the target agent.
 *
 * @param {object} classifiedEmail - Classified email or delegation context object.
 * @param {string} agentId - Target agent name (e.g. 'dev', 'research').
 * @returns {string} Task description string.
 */
function buildTaskDescription(classifiedEmail, agentId) {
  const sender = classifiedEmail.sender;
  const subject = classifiedEmail.subject;
  const account = classifiedEmail.account;
  const snippet = classifiedEmail.snippet;
  const messageId = classifiedEmail.messageId;
  const threadId = classifiedEmail.threadId;

  // Handle both classified email shape and delegation context shape
  const categories = classifiedEmail.categories || (classifiedEmail.classification && classifiedEmail.classification.categories);
  const primaryCategory = categories ? categories[0].category : 'unknown';
  const confidence = categories ? categories[0].confidence : 0;
  const reasoning = classifiedEmail.reasoning || (classifiedEmail.classification && classifiedEmail.classification.reasoning) || '';
  const recommendedAction = classifiedEmail.recommended_action || (classifiedEmail.classification && classifiedEmail.classification.recommended_action) || '';

  return `Email triage delegation from comms agent.

Sender: ${sender}
Subject: ${subject}
Account: ${account}
Category: ${primaryCategory} (confidence: ${confidence})
Recommended action: ${recommendedAction}

Classification reasoning: ${reasoning}

Snippet: ${snippet}

Please review this email and take appropriate action. If you need the full email body, fetch it via Gmail API using messageId: ${messageId} (threadId: ${threadId}).`;
}

// ---------------------------------------------------------------------------
// Delegation execution
// ---------------------------------------------------------------------------

/**
 * Delegate a classified email to the appropriate sibling agent via sessions_spawn.
 *
 * @param {object} classifiedEmail - Classified email from classifyPipeline.
 * @param {function} sessionSpawnFn - async ({ agentId, task, label, runTimeoutSeconds }) => { status, runId, childSessionKey }
 * @returns {Promise<object>} Result: { delegated, agentId, runId } | { queued, agentId, reason } | { skipped, reason } | { error, message }
 */
async function delegateToAgent(classifiedEmail, sessionSpawnFn) {
  try {
    const primaryCategory = classifiedEmail.categories[0].category;

    // Check if this category has a delegation target
    const agentId = DELEGATION_ROUTING[primaryCategory];
    if (!agentId) {
      return { skipped: true, reason: 'no_delegation_target' };
    }

    const task = buildTaskDescription(classifiedEmail, agentId);
    const label = 'email-' + classifiedEmail.messageId;
    const runTimeoutSeconds = DELEGATION_FOLLOW_UP_HOURS * 3600;

    try {
      const result = await sessionSpawnFn({ agentId, task, label, runTimeoutSeconds });

      if (result && result.status === 'accepted') {
        // Spawn succeeded -- add active entry to queue
        const queue = loadState(DELEGATION_QUEUE_PATH);
        const now = new Date();
        const followUpAt = new Date(now.getTime() + DELEGATION_FOLLOW_UP_HOURS * 3600 * 1000);

        queue.pending.push({
          id: generateId(),
          messageId: classifiedEmail.messageId,
          threadId: classifiedEmail.threadId,
          account: classifiedEmail.account,
          target_agent: agentId,
          context: buildDelegationContext(classifiedEmail),
          delegated_at: now.toISOString(),
          runId: result.runId,
          childSessionKey: result.childSessionKey,
          retry_count: 0,
          max_retries: DELEGATION_MAX_RETRIES,
          follow_up_at: followUpAt.toISOString(),
          status: 'active'
        });

        saveState(DELEGATION_QUEUE_PATH, queue);
        return { delegated: true, agentId, runId: result.runId };
      }

      // Non-accepted status -- queue for retry
      return _queueForRetry(classifiedEmail, agentId, 'spawn_returned_non_accepted');
    } catch (spawnErr) {
      // Spawn threw -- queue for retry
      return _queueForRetry(classifiedEmail, agentId, spawnErr.message || 'spawn_failed');
    }
  } catch (err) {
    return { error: true, message: err.message };
  }
}

/**
 * Internal: add a failed delegation to the queue for retry.
 *
 * @param {object} classifiedEmail - The classified email.
 * @param {string} agentId - Target agent ID.
 * @param {string} reason - Failure reason.
 * @returns {object} { queued: true, agentId, reason }
 */
function _queueForRetry(classifiedEmail, agentId, reason) {
  const queue = loadState(DELEGATION_QUEUE_PATH);
  const now = new Date();
  const nextRetryAt = new Date(now.getTime() + DELEGATION_RETRY_DELAY_MINUTES * 60 * 1000);

  queue.pending.push({
    id: generateId(),
    messageId: classifiedEmail.messageId,
    threadId: classifiedEmail.threadId,
    account: classifiedEmail.account,
    target_agent: agentId,
    context: buildDelegationContext(classifiedEmail),
    delegated_at: now.toISOString(),
    runId: null,
    childSessionKey: null,
    retry_count: 0,
    max_retries: DELEGATION_MAX_RETRIES,
    follow_up_at: null,
    next_retry_at: nextRetryAt.toISOString(),
    status: 'queued'
  });

  saveState(DELEGATION_QUEUE_PATH, queue);
  return { queued: true, agentId, reason };
}

// ---------------------------------------------------------------------------
// Queue processing (D-09: retry logic)
// ---------------------------------------------------------------------------

/**
 * Process the delegation queue: retry queued items, dead-letter exhausted ones.
 * Called every heartbeat cycle.
 *
 * @param {function} sessionSpawnFn - async ({ agentId, task, label, runTimeoutSeconds }) => result
 * @param {function} telegramSendFn - async (text, parseMode) => telegramMessageId
 * @returns {Promise<object>} { retried: number, dead_lettered: number }
 */
async function processDelegationQueue(sessionSpawnFn, telegramSendFn) {
  const queue = loadState(DELEGATION_QUEUE_PATH);
  const now = new Date();
  let retried = 0;
  let deadLettered = 0;

  // Iterate over pending items that are queued and ready for retry
  for (let i = queue.pending.length - 1; i >= 0; i--) {
    const item = queue.pending[i];

    if (item.status !== 'queued') continue;
    if (!item.next_retry_at || new Date(item.next_retry_at) > now) continue;

    const task = buildTaskDescription(item.context, item.target_agent);
    const label = 'email-' + item.messageId;
    const runTimeoutSeconds = DELEGATION_FOLLOW_UP_HOURS * 3600;

    try {
      const result = await sessionSpawnFn({
        agentId: item.target_agent,
        task,
        label,
        runTimeoutSeconds
      });

      if (result && result.status === 'accepted') {
        // Retry succeeded
        item.status = 'active';
        item.runId = result.runId;
        item.childSessionKey = result.childSessionKey;
        item.follow_up_at = new Date(now.getTime() + DELEGATION_FOLLOW_UP_HOURS * 3600 * 1000).toISOString();
        item.retry_count++;
        delete item.next_retry_at;
        retried++;
      } else {
        throw new Error('spawn_returned_non_accepted');
      }
    } catch (err) {
      item.retry_count++;

      if (item.retry_count >= item.max_retries) {
        // Move to dead letter
        item.status = 'dead_letter';
        queue.dead_letter.push(item);
        queue.pending.splice(i, 1);
        deadLettered++;

        // Notify user via Telegram
        const subject = item.context.subject || 'Unknown subject';
        const msg = `Delegation failed: [${subject}] to @${item.target_agent} after ${item.retry_count} attempts. Taking no further action -- please handle manually.`;
        try {
          await telegramSendFn(msg, 'HTML');
        } catch (tgErr) {
          console.error('[delegator] Failed to send dead-letter Telegram notification:', tgErr.message);
        }
      } else {
        // Schedule next retry
        item.next_retry_at = new Date(now.getTime() + DELEGATION_RETRY_DELAY_MINUTES * 60 * 1000).toISOString();
      }
    }
  }

  saveState(DELEGATION_QUEUE_PATH, queue);
  return { retried, dead_lettered: deadLettered };
}

// ---------------------------------------------------------------------------
// Follow-up tracking (D-10: 2-hour timeout nudge)
// ---------------------------------------------------------------------------

/**
 * Check for active delegations that have exceeded their follow-up time.
 * Sends a Telegram nudge and resets the follow-up timer.
 * Called every heartbeat cycle.
 *
 * @param {function} telegramSendFn - async (text, parseMode) => telegramMessageId
 * @returns {Promise<object>} { nudged: number }
 */
async function checkFollowUps(telegramSendFn) {
  const queue = loadState(DELEGATION_QUEUE_PATH);
  const now = new Date();
  let nudged = 0;

  for (const item of queue.pending) {
    if (item.status !== 'active') continue;
    if (!item.follow_up_at || new Date(item.follow_up_at) > now) continue;

    // Calculate hours since delegation
    const delegatedAt = new Date(item.delegated_at);
    const hoursAgo = Math.round((now.getTime() - delegatedAt.getTime()) / (1000 * 60 * 60));
    const subject = item.context.subject || 'Unknown subject';

    const msg = `@${item.target_agent} hasn't responded to "${subject}" (delegated ${hoursAgo}h ago). Nudge the agent or take over?`;

    try {
      await telegramSendFn(msg, 'HTML');
    } catch (tgErr) {
      console.error('[delegator] Failed to send follow-up nudge:', tgErr.message);
    }

    // Reset follow-up timer to prevent re-nudging for another cycle
    item.follow_up_at = new Date(now.getTime() + DELEGATION_FOLLOW_UP_HOURS * 3600 * 1000).toISOString();
    nudged++;
  }

  saveState(DELEGATION_QUEUE_PATH, queue);
  return { nudged };
}

// ---------------------------------------------------------------------------
// Delegation completion handler
// ---------------------------------------------------------------------------

/**
 * Mark a delegation as completed when OpenClaw announces sub-agent completion.
 *
 * @param {string} runId - The runId returned from sessions_spawn.
 * @param {*} result - Result data from the sub-agent.
 * @returns {object|null} The completed entry (for Telegram notification), or null if not found.
 */
function markDelegationComplete(runId, result) {
  const queue = loadState(DELEGATION_QUEUE_PATH);

  const idx = queue.pending.findIndex(item => item.runId === runId);
  if (idx === -1) return null;

  const entry = queue.pending[idx];
  entry.status = 'completed';
  entry.completed_at = new Date().toISOString();
  entry.result = result;

  saveState(DELEGATION_QUEUE_PATH, queue);
  return entry;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  delegateToAgent,
  buildDelegationContext,
  buildTaskDescription,
  processDelegationQueue,
  checkFollowUps,
  markDelegationComplete,
  generateId
};
