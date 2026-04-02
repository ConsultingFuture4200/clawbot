#!/usr/bin/env bash
# =============================================================================
# 13-test-classification.sh — Classification Accuracy Test (CLASS-07)
# =============================================================================
#
# Runs the 50-email test set through the spam gate (Ollama) and Gemini
# classifier, then reports per-category accuracy and overall accuracy.
#
# REQUIREMENTS:
#   - GEMINI_API_KEY in .env (or exported in environment)
#   - Ollama running locally with qwen2.5:7b model (optional; fail-open)
#   - Node.js 22+
#   - @google/genai installed (npm install)
#
# COST: ~10 Gemini API requests (50 emails / 5 per batch). Well within
#        the 250 RPD free tier limit.
#
# USAGE: bash scripts/13-test-classification.sh
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Load .env if present
if [ -f "$PROJECT_DIR/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$PROJECT_DIR/.env"
  set +a
fi

# Check GEMINI_API_KEY
if [ -z "${GEMINI_API_KEY:-}" ]; then
  echo "ERROR: GEMINI_API_KEY not set. Add it to .env or export it."
  exit 1
fi

echo "=== Classification Accuracy Test (CLASS-07) ==="
echo "Test set: 50 emails"
echo "Gemini requests: ~10 (batches of 5)"
echo ""

# Run the Node.js test harness
node -e "
const fs = require('fs');
const path = require('path');

// Override sandbox paths for local testing
const typesPath = path.join('${PROJECT_DIR}', 'sandbox', 'skills', 'classify-email', 'types.js');
const types = require(typesPath);

// Patch file paths to use local project paths instead of /sandbox/
const configDir = path.join('${PROJECT_DIR}', 'sandbox', 'config');
const stateDir = path.join('${PROJECT_DIR}', 'sandbox', 'state');

// Monkey-patch fs.readFileSync to redirect /sandbox/ paths
const origReadFileSync = fs.readFileSync;
fs.readFileSync = function(p, ...args) {
  if (typeof p === 'string' && p.startsWith('/sandbox/config/')) {
    p = path.join(configDir, path.basename(p));
  }
  if (typeof p === 'string' && p.startsWith('/sandbox/state/')) {
    p = path.join(stateDir, path.basename(p));
  }
  return origReadFileSync.call(this, p, ...args);
};
// Patch writeFileSync too for sender cache updates
const origWriteFileSync = fs.writeFileSync;
fs.writeFileSync = function(p, ...args) {
  if (typeof p === 'string' && p.startsWith('/sandbox/config/')) {
    p = path.join(configDir, path.basename(p));
  }
  if (typeof p === 'string' && p.startsWith('/sandbox/state/')) {
    p = path.join(stateDir, path.basename(p));
  }
  return origWriteFileSync.call(this, p, ...args);
};

const { runSpamGate } = require(path.join('${PROJECT_DIR}', 'sandbox', 'skills', 'classify-email', 'spam-gate'));
const { classifyBatch } = require(path.join('${PROJECT_DIR}', 'sandbox', 'skills', 'classify-email', 'classifier'));
const { BATCH_SIZE, CATEGORIES } = types;

const testData = JSON.parse(fs.readFileSync(path.join(configDir, 'test-emails.json'), 'utf8'));
const emails = testData.emails;

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function runTest() {
  const results = [];
  const spamGateResults = [];

  // Stage 1: Spam gate (individual, sequential)
  console.log('Running spam gate on ' + emails.length + ' emails...');
  for (let i = 0; i < emails.length; i++) {
    const email = emails[i];
    const sgResult = await runSpamGate(email);
    spamGateResults.push({
      index: i,
      predicted_spam: sgResult.is_spam,
      expected_spam: email.expected_is_spam,
      reason: sgResult.reason
    });
  }

  // Stage 2: Classify non-spam emails in batches
  const nonSpamEmails = [];
  const nonSpamIndices = [];
  for (let i = 0; i < emails.length; i++) {
    // Send ALL emails to classification (even those the spam gate caught)
    // so we can measure Gemini classification accuracy independently
    nonSpamEmails.push(emails[i]);
    nonSpamIndices.push(i);
  }

  console.log('Classifying ' + nonSpamEmails.length + ' emails via Gemini...');
  const DELAY_MS = 6500;

  for (let batch = 0; batch < nonSpamEmails.length; batch += BATCH_SIZE) {
    if (batch > 0) {
      process.stdout.write('  Waiting for rate limit... ');
      await sleep(DELAY_MS);
      console.log('ok');
    }

    const chunk = nonSpamEmails.slice(batch, batch + BATCH_SIZE);
    const batchNum = Math.floor(batch / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(nonSpamEmails.length / BATCH_SIZE);
    process.stdout.write('  Batch ' + batchNum + '/' + totalBatches + '... ');

    const classified = await classifyBatch(chunk);

    if (!classified) {
      console.log('FAILED (Gemini error)');
      for (let j = 0; j < chunk.length; j++) {
        results.push({
          index: nonSpamIndices[batch + j],
          predicted_categories: [],
          expected_categories: chunk[j].expected_categories,
          error: true
        });
      }
      continue;
    }

    console.log('ok (' + classified.length + ' results)');

    for (let j = 0; j < chunk.length; j++) {
      const cls = classified.find(c => c.email_index === j);
      const predicted = cls
        ? cls.categories.map(c => c.category)
        : [];
      results.push({
        index: nonSpamIndices[batch + j],
        predicted_categories: predicted,
        expected_categories: chunk[j].expected_categories,
        error: !cls
      });
    }
  }

  // Calculate accuracy
  console.log('');
  console.log('Per-category accuracy:');

  const catStats = {};
  for (const cat of CATEGORIES) {
    catStats[cat] = { correct: 0, total: 0 };
  }

  let overallCorrect = 0;

  for (const r of results) {
    if (r.error) continue;

    // An email is correct if predicted primary category is in expected list
    const primaryPredicted = r.predicted_categories[0] || 'none';
    const isCorrect = r.expected_categories.includes(primaryPredicted);

    if (isCorrect) overallCorrect++;

    // Track per-category stats based on expected categories
    for (const cat of r.expected_categories) {
      if (catStats[cat]) {
        catStats[cat].total++;
        if (isCorrect) catStats[cat].correct++;
      }
    }
  }

  for (const cat of CATEGORIES) {
    const s = catStats[cat];
    if (s.total === 0) {
      console.log('  ' + cat.padEnd(12) + ': 0/0  (n/a)');
    } else {
      const pct = ((s.correct / s.total) * 100).toFixed(1);
      console.log('  ' + cat.padEnd(12) + ': ' + s.correct + '/' + s.total + '  (' + pct + '%)');
    }
  }

  const nonErrorCount = results.filter(r => !r.error).length;
  const overallPct = ((overallCorrect / nonErrorCount) * 100).toFixed(1);

  console.log('');
  console.log('Overall accuracy: ' + overallCorrect + '/' + nonErrorCount + ' (' + overallPct + '%)');
  console.log('Threshold: 80%');
  console.log('Result: ' + (parseFloat(overallPct) >= 80.0 ? 'PASS' : 'FAIL'));

  // Spam gate accuracy
  console.log('');
  console.log('Spam gate accuracy:');
  const spamCorrect = spamGateResults.filter(r => r.predicted_spam === r.expected_spam).length;
  const spamExpected = spamGateResults.filter(r => r.expected_spam).length;
  const spamCaught = spamGateResults.filter(r => r.expected_spam && r.predicted_spam).length;
  const falsePositives = spamGateResults.filter(r => !r.expected_spam && r.predicted_spam).length;
  console.log('  Expected spam emails: ' + spamExpected);
  console.log('  Caught by Ollama:     ' + spamCaught + '/' + spamExpected);
  console.log('  False positives:      ' + falsePositives);
  console.log('  Overall gate accuracy: ' + spamCorrect + '/' + spamGateResults.length + ' (' + ((spamCorrect / spamGateResults.length) * 100).toFixed(1) + '%)');

  // Output JSON summary for scripting
  const summary = {
    overall_accuracy: parseFloat(overallPct),
    threshold: 80.0,
    pass: parseFloat(overallPct) >= 80.0,
    per_category: {},
    spam_gate: {
      caught: spamCaught,
      expected: spamExpected,
      false_positives: falsePositives
    }
  };
  for (const cat of CATEGORIES) {
    const s = catStats[cat];
    summary.per_category[cat] = {
      correct: s.correct,
      total: s.total,
      accuracy: s.total > 0 ? parseFloat(((s.correct / s.total) * 100).toFixed(1)) : null
    };
  }

  // Write summary JSON for downstream tools
  const summaryPath = path.join(stateDir, 'classification-test-results.json');
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf8');
  console.log('');
  console.log('Results written to: sandbox/state/classification-test-results.json');

  // Exit with appropriate code
  process.exit(summary.pass ? 0 : 1);
}

runTest().catch(err => {
  console.error('Test harness error:', err);
  process.exit(2);
});
"
