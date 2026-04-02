'use strict';

const { GoogleGenAI } = require('@google/genai');
const fs = require('fs');
const path = require('path');

const {
  BATCH_SIZE,
  GEMINI_MODEL,
  CONFIDENCE_THRESHOLDS,
  loadClassificationSchema,
  loadFewShotExamples,
  buildClassificationPrompt,
  getConfidenceTier
} = require('./types');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Directory for per-account state files. */
const STATE_DIR = '/sandbox/state';

/** Delay between Gemini batch requests (ms) — stay under 10 RPM (Pitfall 1). */
const GEMINI_DELAY_MS = 6500;

/** Maximum entries in a sender cache before eviction (Pitfall 4). */
const SENDER_CACHE_MAX = 10000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Sleep for a given number of milliseconds.
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Load the sender cache for the given account from disk.
 * Returns a fresh empty cache when the file is missing or corrupt.
 *
 * @param {'personal' | 'work'} account
 * @returns {{ senders: Record<string, { first_seen: string, count: number }>, last_updated: string | null }}
 */
function loadSenderCache(account) {
  const filePath = path.join(STATE_DIR, `sender-cache-${account}.json`);
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return { senders: {}, last_updated: null };
  }
}

/**
 * Persist a sender cache to disk.
 *
 * @param {'personal' | 'work'} account
 * @param {object} cache
 */
function saveSenderCache(account, cache) {
  const filePath = path.join(STATE_DIR, `sender-cache-${account}.json`);
  fs.writeFileSync(filePath, JSON.stringify(cache, null, 2), 'utf8');
}

// ---------------------------------------------------------------------------
// Sender Cache
// ---------------------------------------------------------------------------

/**
 * Check whether a sender is unknown (not in the cache) for a given account.
 * Per D-08: unknown = sender email not present in senders map.
 *
 * @param {string} senderEmail
 * @param {'personal' | 'work'} account
 * @returns {boolean} true if the sender is NOT in the cache (unknown).
 */
function isUnknownSender(senderEmail, account) {
  const cache = loadSenderCache(account);
  return !(senderEmail in cache.senders);
}

/**
 * Record a sender in the cache.  Increments count for known senders;
 * adds new entry for unknown senders.  Evicts oldest entries when the cache
 * exceeds SENDER_CACHE_MAX (Pitfall 4).
 *
 * @param {string} senderEmail
 * @param {'personal' | 'work'} account
 */
function updateSenderCache(senderEmail, account) {
  const cache = loadSenderCache(account);

  if (senderEmail in cache.senders) {
    cache.senders[senderEmail].count += 1;
  } else {
    cache.senders[senderEmail] = {
      first_seen: new Date().toISOString(),
      count: 1
    };
  }

  // Evict oldest entries if over capacity
  const keys = Object.keys(cache.senders);
  if (keys.length > SENDER_CACHE_MAX) {
    const sorted = keys.sort((a, b) => {
      const da = new Date(cache.senders[a].first_seen).getTime();
      const db = new Date(cache.senders[b].first_seen).getTime();
      return da - db;
    });
    const toRemove = sorted.slice(0, keys.length - SENDER_CACHE_MAX);
    for (const key of toRemove) {
      delete cache.senders[key];
    }
  }

  cache.last_updated = new Date().toISOString();
  saveSenderCache(account, cache);
}

// ---------------------------------------------------------------------------
// Gemini Batch Classification
// ---------------------------------------------------------------------------

/**
 * Classify a batch of up to BATCH_SIZE emails using Gemini structured output.
 *
 * @param {Array<{ sender: string, subject: string, snippet: string }>} emails
 *   Max BATCH_SIZE (5) emails.
 * @returns {Promise<Array<object> | null>}
 *   Array of enriched classification objects with `confidenceTier`, or null on error.
 */
async function classifyBatch(emails) {
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const schema = loadClassificationSchema();
    const { examples } = loadFewShotExamples();
    const { systemPrompt, userPrompt } = buildClassificationPrompt(emails, examples);

    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: userPrompt,
      config: {
        systemInstruction: systemPrompt,
        responseMimeType: 'application/json',
        responseSchema: schema
      }
    });

    const result = JSON.parse(response.text);

    // Pitfall 6 mitigation: validate batch size match
    if (!result.classifications || result.classifications.length !== emails.length) {
      console.warn(
        `[classifier] Batch size mismatch: expected ${emails.length}, got ${
          result.classifications ? result.classifications.length : 0
        }. Falling back to individual classification for missing indices.`
      );

      const existingIndices = new Set(
        (result.classifications || []).map(c => c.email_index)
      );
      const missingEmails = emails
        .map((e, i) => ({ email: e, index: i }))
        .filter(item => !existingIndices.has(item.index));

      // Retry missing emails individually
      for (const { email, index } of missingEmails) {
        try {
          const singlePrompt = buildClassificationPrompt([email], examples);
          const singleResp = await ai.models.generateContent({
            model: GEMINI_MODEL,
            contents: singlePrompt.userPrompt,
            config: {
              systemInstruction: singlePrompt.systemPrompt,
              responseMimeType: 'application/json',
              responseSchema: schema
            }
          });
          const singleResult = JSON.parse(singleResp.text);
          if (singleResult.classifications && singleResult.classifications[0]) {
            const cls = singleResult.classifications[0];
            cls.email_index = index;
            result.classifications = result.classifications || [];
            result.classifications.push(cls);
          }
        } catch (singleErr) {
          console.error(`[classifier] Individual retry failed for email ${index}:`, singleErr.message);
        }
      }
    }

    // Enrich each classification with confidence tier
    const enriched = (result.classifications || []).map(cls => {
      const topConfidence =
        cls.categories && cls.categories.length > 0
          ? cls.categories[0].confidence
          : 0;
      return {
        ...cls,
        confidenceTier: getConfidenceTier(topConfidence)
      };
    });

    return enriched;
  } catch (err) {
    if (err.status === 429 || (err.message && err.message.includes('429'))) {
      console.warn('[classifier] Gemini rate limited, queuing for next cycle');
      return null;
    }
    console.error('[classifier] Classification error:', err.message || err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Full Classification Pipeline
// ---------------------------------------------------------------------------

/**
 * Run the complete classification pipeline on an arbitrary number of emails.
 *
 * Chunks emails into batches of BATCH_SIZE, classifies each batch via Gemini
 * with rate-limit-safe delays, then enriches results with sender-cache info,
 * account tag, and delivery mode.
 *
 * @param {Array<{ sender: string, subject: string, snippet: string }>} emails
 * @param {'personal' | 'work'} account
 * @returns {Promise<{ classified: Array<object>, failed: Array<object> }>}
 */
async function classifyPipeline(emails, account) {
  const classified = [];
  const failed = [];

  // Chunk into batches of BATCH_SIZE
  const chunks = [];
  for (let i = 0; i < emails.length; i += BATCH_SIZE) {
    chunks.push(emails.slice(i, i + BATCH_SIZE));
  }

  for (let ci = 0; ci < chunks.length; ci++) {
    const chunk = chunks[ci];

    // Rate-limit delay between batches (not before the first)
    if (ci > 0) {
      await sleep(GEMINI_DELAY_MS);
    }

    const results = await classifyBatch(chunk);

    if (!results) {
      // Entire batch failed — record all emails as failed
      for (const email of chunk) {
        failed.push(email);
      }
      continue;
    }

    // Enrich each result with sender cache, account, and delivery mode
    for (let i = 0; i < chunk.length; i++) {
      const email = chunk[i];
      const classification = results.find(r => r.email_index === i);

      if (!classification) {
        failed.push(email);
        continue;
      }

      const unknownSender = isUnknownSender(email.sender, account);
      updateSenderCache(email.sender, account);

      // D-02: urgent always gets immediate delivery regardless of confidence
      // D-01: non-urgent gets batch delivery
      const delivery = classification.is_urgent ? 'immediate' : 'batch';

      classified.push({
        ...classification,
        is_unknown_sender: unknownSender,
        account,
        delivery
      });
    }
  }

  return { classified, failed };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  classifyBatch,
  classifyPipeline,
  isUnknownSender,
  updateSenderCache
};
