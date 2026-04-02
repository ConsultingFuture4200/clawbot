'use strict';

const { OLLAMA_URL, OLLAMA_MODEL, buildSpamGatePrompt } = require('./types');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Timeout for Ollama requests in milliseconds. */
const OLLAMA_TIMEOUT_MS = 30_000;

/** JSON schema for structured Ollama spam gate output. */
const SPAM_GATE_FORMAT = {
  type: 'object',
  properties: {
    is_spam: { type: 'boolean' },
    reason: { type: 'string' }
  },
  required: ['is_spam']
};

// ---------------------------------------------------------------------------
// Spam Gate (single email)
// ---------------------------------------------------------------------------

/**
 * Run the local Ollama spam gate on a single email.
 *
 * Returns a binary spam / not-spam verdict.  Fails open: if Ollama is
 * unreachable or returns garbage the email proceeds to Gemini classification
 * (is_spam = false).
 *
 * @param {{ sender: string, subject: string, snippet: string }} email
 * @returns {Promise<{ is_spam: boolean, reason: string }>}
 */
async function runSpamGate(email) {
  const messages = buildSpamGatePrompt(email.sender, email.subject, email.snippet);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT_MS);

    const response = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        messages,
        stream: false,
        format: SPAM_GATE_FORMAT
      }),
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!response.ok) {
      console.error(`[spam-gate] Ollama returned HTTP ${response.status}`);
      return { is_spam: false, reason: 'ollama_http_error' };
    }

    const data = await response.json();
    const content = data.message && data.message.content;

    if (!content) {
      console.error('[spam-gate] Ollama response missing message.content');
      return { is_spam: false, reason: 'empty_response' };
    }

    const parsed = JSON.parse(content);
    return {
      is_spam: Boolean(parsed.is_spam),
      reason: parsed.reason || ''
    };
  } catch (err) {
    // Fail open: connection refused, timeout, or JSON parse errors all
    // result in the email being forwarded to Gemini for classification.
    if (err.name === 'AbortError') {
      console.error('[spam-gate] Ollama request timed out after 30s');
      return { is_spam: false, reason: 'timeout' };
    }
    if (err.code === 'ECONNREFUSED' || err.cause?.code === 'ECONNREFUSED') {
      console.error('[spam-gate] Ollama unavailable (ECONNREFUSED)');
      return { is_spam: false, reason: 'ollama_unavailable' };
    }
    if (err instanceof SyntaxError) {
      console.error('[spam-gate] Failed to parse Ollama JSON response:', err.message);
      return { is_spam: false, reason: 'parse_error' };
    }

    console.error('[spam-gate] Unexpected error:', err.message || err);
    return { is_spam: false, reason: 'unknown_error' };
  }
}

// ---------------------------------------------------------------------------
// Spam Gate (batch)
// ---------------------------------------------------------------------------

/**
 * Run the spam gate on a batch of emails sequentially.
 *
 * Ollama handles one request at a time efficiently on local GPU, so
 * sequential processing is optimal here.
 *
 * @param {Array<{ sender: string, subject: string, snippet: string }>} emails
 * @returns {Promise<{ spam: Array<{ email: object, spamResult: object }>, notSpam: Array<{ email: object, spamResult: object }> }>}
 */
async function runSpamGateBatch(emails) {
  const results = [];

  for (const email of emails) {
    const spamResult = await runSpamGate(email);
    results.push({ email, spamResult });
  }

  const spam = results.filter(r => r.spamResult.is_spam);
  const notSpam = results.filter(r => !r.spamResult.is_spam);

  return { spam, notSpam };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = { runSpamGate, runSpamGateBatch };
