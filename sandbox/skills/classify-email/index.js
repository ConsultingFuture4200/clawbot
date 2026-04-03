'use strict';

const { runSpamGateBatch } = require('./spam-gate');
const { classifyPipeline } = require('./classifier');
const {
  processClassifiedEmails,
  handleDigestReply: _handleDigestReply,
  handleCallbackQuery: _handleCallbackQuery,
  handleDelegationResult: _handleDelegationResult,
  runHeartbeatMaintenance: _runHeartbeatMaintenance
} = require('./delivery');
const { formatEmptyState, formatErrorState } = require('./digest-formatter');

// ---------------------------------------------------------------------------
// Unified Pipeline Entry Point
// ---------------------------------------------------------------------------

/**
 * Handle new emails through the complete classification pipeline.
 *
 * Three-stage flow (per D-04 / RESEARCH Pattern 1):
 *   1. Spam gate  — local Ollama binary filter (fail-open)
 *   2. Classify   — Gemini batch classification with structured output
 *   3. Deliver    — urgent immediate, non-urgent batch buffer + digest
 *
 * @param {Array<{ sender: string, subject: string, snippet: string, threadId: string, messageId: string }>} emails
 *   Email metadata from Gmail API messages.get.
 * @param {'personal' | 'work'} account
 *   Which Gmail account these emails belong to.
 * @param {function} telegramSendFn
 *   async (text, parseMode, replyMarkup?) => telegramMessageId
 * @param {function} [sessionSpawnFn]
 *   async ({ agentId, task, label, runTimeoutSeconds }) => { status, runId, childSessionKey }
 * @returns {Promise<object>} Pipeline result summary.
 */
async function handleNewEmails(emails, account, telegramSendFn, sessionSpawnFn) {
  const startTime = Date.now();

  try {
    // -----------------------------------------------------------------------
    // Empty input
    // -----------------------------------------------------------------------
    if (!emails || emails.length === 0) {
      await telegramSendFn(formatEmptyState(0), 'HTML');
      console.log('[classify-email] No emails to process');
      return { total: 0 };
    }

    console.log(`[classify-email] Processing ${emails.length} emails for ${account}`);

    // -----------------------------------------------------------------------
    // Stage 1: Spam gate (local Ollama)
    // -----------------------------------------------------------------------
    const spamStart = Date.now();
    const { spam, notSpam } = await runSpamGateBatch(emails);
    console.log(
      `[classify-email] Stage 1 (spam gate): ${spam.length} spam, ${notSpam.length} passed — ${Date.now() - spamStart}ms`
    );

    // All spam — nothing left to classify
    if (notSpam.length === 0) {
      await telegramSendFn(formatEmptyState(spam.length), 'HTML');
      return {
        total: emails.length,
        spam: spam.length,
        classified: 0
      };
    }

    // -----------------------------------------------------------------------
    // Stage 2: Classification (Gemini)
    // -----------------------------------------------------------------------
    const classifyStart = Date.now();
    // Extract the raw email objects from spam-gate's { email, spamResult } wrapper
    const emailsToClassify = notSpam.map(item => item.email);
    const classifyResult = await classifyPipeline(emailsToClassify, account);
    console.log(
      `[classify-email] Stage 2 (classify): ${classifyResult.classified.length} classified, ${classifyResult.failed.length} failed — ${Date.now() - classifyStart}ms`
    );

    // Gemini total failure — null check (classifyPipeline returns object, but
    // if every batch failed, classified will be empty and failed will contain all)
    if (classifyResult.classified.length === 0 && classifyResult.failed.length === emailsToClassify.length) {
      await telegramSendFn(
        formatErrorState('gemini_api', { count: emailsToClassify.length }),
        'HTML'
      );
      return {
        total: emails.length,
        spam: spam.length,
        classified: 0,
        error: 'gemini_api'
      };
    }

    // -----------------------------------------------------------------------
    // Stage 3: Delivery (Telegram)
    // -----------------------------------------------------------------------
    const deliverStart = Date.now();
    const deliveryResult = await processClassifiedEmails(classifyResult, telegramSendFn, sessionSpawnFn);
    console.log(
      `[classify-email] Stage 3 (deliver): urgent=${deliveryResult.urgent_sent}, buffered=${deliveryResult.buffered}, digests=${deliveryResult.digests_sent.length} — ${Date.now() - deliverStart}ms`
    );

    const totalTime = Date.now() - startTime;
    console.log(`[classify-email] Pipeline complete in ${totalTime}ms`);

    return {
      total: emails.length,
      spam: spam.length,
      classified: classifyResult.classified.length,
      failed: classifyResult.failed.length,
      delivery: deliveryResult
    };
  } catch (err) {
    const totalTime = Date.now() - startTime;
    console.error(`[classify-email] Pipeline error after ${totalTime}ms:`, err.message || err);

    try {
      await telegramSendFn(
        formatErrorState('gemini_api', { count: emails.length }),
        'HTML'
      );
    } catch (sendErr) {
      console.error('[classify-email] Failed to send error notification:', sendErr.message);
    }

    return {
      total: emails.length,
      error: err.message || 'unknown_error'
    };
  }
}

/**
 * Handle a user's numbered reply to a digest or urgent notification.
 * Re-export from delivery.js.
 */
function handleDigestReply(telegramMsgId, replyText) {
  return _handleDigestReply(telegramMsgId, replyText);
}

/**
 * Handle a Telegram inline keyboard callback query.
 * Re-export from delivery.js.
 */
function handleCallbackQuery(callbackData, telegramSendFn) {
  return _handleCallbackQuery(callbackData, telegramSendFn);
}

/**
 * Handle a delegation result when a sub-agent completes.
 * Re-export from delivery.js.
 */
async function handleDelegationResult(runId, result, telegramSendFn) {
  return _handleDelegationResult(runId, result, telegramSendFn);
}

/**
 * Run periodic heartbeat maintenance (delegation retries, follow-ups, draft expiry).
 * Re-export from delivery.js.
 */
async function runHeartbeatMaintenance(sessionSpawnFn, telegramSendFn) {
  return _runHeartbeatMaintenance(sessionSpawnFn, telegramSendFn);
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  handleNewEmails,
  handleDigestReply,
  handleCallbackQuery,
  handleDelegationResult,
  runHeartbeatMaintenance
};
