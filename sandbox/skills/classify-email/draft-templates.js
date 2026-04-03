'use strict';

const fs = require('fs');
const { GoogleGenAI } = require('@google/genai');
const {
  GEMINI_MODEL,
  CLAUDE_MODEL,
  ANTHROPIC_API_URL,
  DRAFT_TEMPLATES_PATH
} = require('./types');

// ---------------------------------------------------------------------------
// Template loading
// ---------------------------------------------------------------------------

/**
 * Load predefined reply templates from disk.
 * @returns {object} Template definitions from draft-templates.json.
 */
function loadTemplates() {
  const raw = fs.readFileSync(DRAFT_TEMPLATES_PATH, 'utf8');
  return JSON.parse(raw);
}

// ---------------------------------------------------------------------------
// Gemini routine acknowledgment
// ---------------------------------------------------------------------------

/**
 * Generate a short acknowledgment draft using Gemini.
 *
 * @param {object} classifiedEmail - Classified email from pipeline.
 * @returns {Promise<string>} Draft text string.
 */
async function generateRoutineAck(classifiedEmail) {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  const systemPrompt = `You are drafting a brief, friendly acknowledgment reply to an email for a personal assistant.
Match the formality level of the sender. Keep it under 2 sentences.
Do not include a subject line — just the body text.
Do not include greetings like "Dear" or sign-offs like "Best regards" unless the sender used them.`;

  const userPrompt = `Sender: ${classifiedEmail.sender}
Subject: ${classifiedEmail.subject}
Snippet: ${classifiedEmail.snippet}
Recommended action: ${classifiedEmail.recommended_action || 'acknowledge'}

Write a brief acknowledgment reply.`;

  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: userPrompt,
    config: {
      systemInstruction: systemPrompt,
      maxOutputTokens: 150
    }
  });

  return response.text.trim();
}

// ---------------------------------------------------------------------------
// Template-based reply
// ---------------------------------------------------------------------------

/**
 * Select the best predefined template based on email subject/snippet keywords.
 * Falls back to generateRoutineAck if no pattern matches.
 *
 * @param {object} classifiedEmail - Classified email from pipeline.
 * @returns {Promise<string>} Template text or Gemini-generated ack.
 */
async function generateTemplateReply(classifiedEmail) {
  const templates = loadTemplates();
  const searchText = `${classifiedEmail.subject} ${classifiedEmail.snippet}`.toLowerCase();

  // Check routine_ack patterns
  if (templates.routine_ack && templates.routine_ack.patterns) {
    for (const pattern of templates.routine_ack.patterns) {
      if (searchText.includes(pattern.toLowerCase())) {
        // Pick a random template from the list
        const options = templates.routine_ack.templates;
        return options[Math.floor(Math.random() * options.length)];
      }
    }
  }

  // Check follow_up pattern
  if (searchText.includes('follow up') || searchText.includes('following up') || searchText.includes('follow-up')) {
    return templates.follow_up.template;
  }

  // Check info_request pattern
  if (searchText.includes('request') || searchText.includes('information') || searchText.includes('question')) {
    return templates.info_request.template;
  }

  // No pattern match — fall back to Gemini-generated ack
  return generateRoutineAck(classifiedEmail);
}

// ---------------------------------------------------------------------------
// Calendar RSVP
// ---------------------------------------------------------------------------

/**
 * Generate a calendar RSVP draft based on conflict detection result.
 * Pure template — no Gemini call needed.
 *
 * @param {object} classifiedEmail - Classified email from pipeline.
 * @param {object} conflictResult - Result from checkCalendarConflict().
 *   Shape: { isFree: boolean|null, conflicts: Array<{ start, end, summary? }> }
 * @returns {string} RSVP draft text.
 */
function generateCalendarRsvp(classifiedEmail, conflictResult) {
  const templates = loadTemplates();

  // Unknown conflict status — tentative
  if (!conflictResult || conflictResult.isFree === null) {
    return templates.calendar_tentative.template;
  }

  // No conflicts — accept
  if (conflictResult.isFree) {
    return templates.calendar_accept.template;
  }

  // Has conflicts — decline with conflict info
  const firstConflict = conflictResult.conflicts[0];
  const conflictEvent = firstConflict && firstConflict.summary
    ? firstConflict.summary
    : 'another commitment';

  return templates.calendar_decline.with_conflict
    .replace('{conflict_event}', conflictEvent)
    .replace('{alternatives}', '');
}

// ---------------------------------------------------------------------------
// Claude smart draft
// ---------------------------------------------------------------------------

/**
 * Generate a smart draft using Claude (claude-sonnet-4-6) via Anthropic API.
 *
 * @param {object} classifiedEmail - Classified email from pipeline.
 * @returns {Promise<string>} Draft text string.
 */
async function generateSmartDraftText(classifiedEmail) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY not set — cannot generate smart draft');
  }

  const response = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 500,
      system: 'You are drafting a reply to an email for a personal assistant. Match the formality level of the sender. Be concise and helpful. Never include pleasantries that feel robotic.',
      messages: [
        {
          role: 'user',
          content: `Draft a reply to this email:

Sender: ${classifiedEmail.sender}
Subject: ${classifiedEmail.subject}
Snippet: ${classifiedEmail.snippet}
Classification reasoning: ${classifiedEmail.reasoning || 'N/A'}
Recommended action: ${classifiedEmail.recommended_action || 'reply'}

Write only the reply body — no subject line, no "Dear", no sign-off unless the sender's formality warrants it.`
        }
      ]
    })
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Anthropic API error ${response.status}: ${errorBody}`);
  }

  const result = await response.json();
  // Anthropic response shape: { content: [{ type: 'text', text: '...' }] }
  if (result.content && result.content[0] && result.content[0].text) {
    return result.content[0].text.trim();
  }

  throw new Error('Unexpected Anthropic API response shape');
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

/**
 * Route draft text generation to the correct model/template based on category.
 * Per D-01: routine -> Gemini ack, calendar -> RSVP template, urgent -> Claude.
 *
 * @param {object} classifiedEmail - Classified email from pipeline.
 * @param {object|null} conflictResult - Calendar conflict result (for calendar category).
 * @returns {Promise<string|null>} Draft text, or null if category doesn't get a draft.
 */
async function getDraftText(classifiedEmail, conflictResult) {
  const primaryCategory = classifiedEmail.categories[0].category;

  switch (primaryCategory) {
    case 'routine':
      return generateRoutineAck(classifiedEmail);

    case 'calendar':
      return generateCalendarRsvp(classifiedEmail, conflictResult);

    case 'urgent':
      return generateSmartDraftText(classifiedEmail);

    default:
      // No draft for code, research, home, spam_noise (D-02)
      return null;
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  getDraftText,
  generateRoutineAck,
  generateTemplateReply,
  generateCalendarRsvp,
  generateSmartDraftText
};
