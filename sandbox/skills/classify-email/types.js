'use strict';

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * The 7 classification categories for email triage.
 * Matches the enum in classification-schema.json.
 */
const CATEGORIES = [
  'code',
  'calendar',
  'research',
  'home',
  'urgent',
  'routine',
  'spam_noise'
];

/**
 * Confidence thresholds for classification tiers (D-01).
 *   AUTO_LABEL      (>0.85) : auto-label, shown in digest, no prompt
 *   ACT_AND_CONFIRM (0.70-0.84) : act-and-confirm, silent confirm if ignored
 *   ASK_USER        (<0.70) : ask user, shown with '?' marker and best guess
 */
const CONFIDENCE_THRESHOLDS = {
  AUTO_LABEL: 0.85,
  ACT_AND_CONFIRM: 0.70,
  ASK_USER: 0.70
};

/** Number of emails per Gemini classification request (D-05). */
const BATCH_SIZE = 5;

/** Primary classification model. */
const GEMINI_MODEL = 'gemini-3-flash';

/** Local spam pre-filter model. */
const OLLAMA_MODEL = 'qwen2.5:7b';

/** Ollama REST API base URL. */
const OLLAMA_URL = 'http://127.0.0.1:11434';

// ---------------------------------------------------------------------------
// File paths (sandbox runtime paths)
// ---------------------------------------------------------------------------

const SCHEMA_PATH = '/sandbox/config/classification-schema.json';
const EXAMPLES_PATH = '/sandbox/config/classification-examples.json';

// ---------------------------------------------------------------------------
// Loaders
// ---------------------------------------------------------------------------

/**
 * Load and parse the Gemini response schema definition.
 * @returns {object} The JSON Schema for Gemini's responseSchema config.
 */
function loadClassificationSchema() {
  const raw = fs.readFileSync(SCHEMA_PATH, 'utf8');
  return JSON.parse(raw);
}

/**
 * Load and parse the few-shot classification examples.
 * @returns {object} Object with an `examples` array.
 */
function loadFewShotExamples() {
  const raw = fs.readFileSync(EXAMPLES_PATH, 'utf8');
  return JSON.parse(raw);
}

// ---------------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------------

/**
 * Build the system + user prompts for Gemini batch classification.
 *
 * @param {Array<{sender: string, subject: string, snippet: string}>} emails
 *   Array of email metadata objects (max BATCH_SIZE).
 * @param {Array<object>} fewShotExamples
 *   Array of example objects from classification-examples.json.
 * @returns {{ systemPrompt: string, userPrompt: string }}
 */
function buildClassificationPrompt(emails, fewShotExamples) {
  const systemPrompt = `You are an email classifier for a personal assistant.
Classify each email into one or more categories with confidence scores.

Categories: ${CATEGORIES.join(', ')}

Rules:
- Each email can have multiple categories (multi-label)
- Confidence is 0.0 to 1.0 for each category
- "urgent" can co-occur with any other category
- Include chain-of-thought reasoning for each classification
- Recommend an action for each email
- Return email_index matching the index provided in the input

Examples:
${JSON.stringify(fewShotExamples, null, 2)}`;

  const userPrompt = `Classify these ${emails.length} emails:

${emails.map((e, i) => `Email ${i}:
  Sender: ${e.sender}
  Subject: ${e.subject}
  Snippet: ${e.snippet}`).join('\n\n')}`;

  return { systemPrompt, userPrompt };
}

/**
 * Build the messages array for the Ollama /api/chat spam gate.
 *
 * @param {string} sender  - Email sender address.
 * @param {string} subject - Email subject line.
 * @param {string} snippet - Email body snippet.
 * @returns {Array<{role: string, content: string}>} Messages for Ollama /api/chat.
 */
function buildSpamGatePrompt(sender, subject, snippet) {
  return [
    {
      role: 'system',
      content: 'You are a spam detector. Classify the email as spam or not_spam based on sender and subject. Respond with JSON containing is_spam (boolean) and reason (string).'
    },
    {
      role: 'user',
      content: `Sender: ${sender}\nSubject: ${subject}\nSnippet: ${snippet}`
    }
  ];
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/**
 * Determine the confidence tier for a given confidence score (D-01).
 *
 * @param {number} confidence - Confidence score between 0.0 and 1.0.
 * @returns {'auto_label' | 'act_and_confirm' | 'ask_user'}
 */
function getConfidenceTier(confidence) {
  if (confidence > CONFIDENCE_THRESHOLDS.AUTO_LABEL) {
    return 'auto_label';
  }
  if (confidence >= CONFIDENCE_THRESHOLDS.ACT_AND_CONFIRM) {
    return 'act_and_confirm';
  }
  return 'ask_user';
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  // Constants
  CATEGORIES,
  CONFIDENCE_THRESHOLDS,
  BATCH_SIZE,
  GEMINI_MODEL,
  OLLAMA_MODEL,
  OLLAMA_URL,

  // File paths
  SCHEMA_PATH,
  EXAMPLES_PATH,

  // Loaders
  loadClassificationSchema,
  loadFewShotExamples,

  // Prompt builders
  buildClassificationPrompt,
  buildSpamGatePrompt,

  // Utilities
  getConfidenceTier
};
