#!/usr/bin/env node
/**
 * ClawBot — Gmail OAuth2 Helper
 * Direct OAuth flow using google-auth-library (no gog CLI dependency)
 *
 * Usage:
 *   node gmail-oauth-helper.cjs auth <client_secret.json> <label>
 *     → Opens browser, completes OAuth, saves token to /sandbox/state/token-<label>.json
 *
 *   node gmail-oauth-helper.cjs verify <label>
 *     → Loads token, tests Gmail API access, prints results as JSON
 *
 *   node gmail-oauth-helper.cjs list
 *     → Lists authenticated accounts from /sandbox/state/token-*.json
 *
 *   node gmail-oauth-helper.cjs profile <label>
 *     → Returns Gmail profile (email, historyId) as JSON
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const { URL } = require('url');
const { OAuth2Client } = require('google-auth-library');

const STATE_DIR = '/sandbox/state';
const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/calendar.readonly',
];

function tokenPath(label) {
  return path.join(STATE_DIR, `token-${label}.json`);
}

function loadClientCredentials(clientSecretPath) {
  const raw = JSON.parse(fs.readFileSync(clientSecretPath, 'utf8'));
  // GCP exports as { installed: { client_id, client_secret, ... } }
  // or { web: { ... } }
  const creds = raw.installed || raw.web;
  if (!creds) {
    throw new Error('Invalid client_secret.json — expected "installed" or "web" key');
  }
  return creds;
}

function createOAuth2Client(creds, redirectUri) {
  return new OAuth2Client(creds.client_id, creds.client_secret, redirectUri);
}

async function authenticate(clientSecretPath, label) {
  const creds = loadClientCredentials(clientSecretPath);

  // Find a free port for the callback
  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const redirectUri = `http://127.0.0.1:${port}`;

  const oauth2Client = createOAuth2Client(creds, redirectUri);

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent', // Force refresh token
  });

  console.log(`\nOpen this URL in your browser to authenticate the "${label}" account:\n`);
  console.log(authUrl);
  console.log('\nWaiting for OAuth callback...');

  // Try to open browser automatically
  try {
    const { exec } = require('child_process');
    // Detect platform
    const cmd = process.platform === 'win32' ? `start "" "${authUrl}"`
      : process.platform === 'darwin' ? `open "${authUrl}"`
      : `xdg-open "${authUrl}" 2>/dev/null || wslview "${authUrl}" 2>/dev/null || echo "Please open the URL manually"`;
    exec(cmd);
  } catch (_) {
    // Manual open fallback — URL is already printed
  }

  // Wait for the OAuth callback
  const code = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      server.close();
      reject(new Error('OAuth callback timed out after 5 minutes'));
    }, 5 * 60 * 1000);

    server.on('request', (req, res) => {
      const url = new URL(req.url, `http://127.0.0.1:${port}`);
      const authCode = url.searchParams.get('code');
      const error = url.searchParams.get('error');

      if (error) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<h2>Authentication failed</h2><p>Error: ${error}</p><p>You can close this tab.</p>`);
        clearTimeout(timeout);
        server.close();
        reject(new Error(`OAuth error: ${error}`));
        return;
      }

      if (authCode) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<h2>Authentication successful!</h2><p>You can close this tab and return to the terminal.</p>');
        clearTimeout(timeout);
        server.close();
        resolve(authCode);
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<p>Waiting for auth code...</p>');
    });
  });

  // Exchange code for tokens
  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);

  // Get user email via Gmail profile
  const gmail = require('@googleapis/gmail');
  const gmailClient = gmail.gmail({ version: 'v1', auth: oauth2Client });
  const profile = await gmailClient.users.getProfile({ userId: 'me' });

  // Save token + metadata
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const tokenData = {
    label,
    email: profile.data.emailAddress,
    historyId: profile.data.historyId,
    tokens,
    created: new Date().toISOString(),
  };
  fs.writeFileSync(tokenPath(label), JSON.stringify(tokenData, null, 2));

  console.log(`\nAuthenticated: ${profile.data.emailAddress}`);
  console.log(`Token saved to: ${tokenPath(label)}`);
  console.log(`historyId: ${profile.data.historyId}`);

  return tokenData;
}

async function verify(label) {
  const tp = tokenPath(label);
  if (!fs.existsSync(tp)) {
    console.error(JSON.stringify({ error: `Token file not found: ${tp}` }));
    process.exit(1);
  }

  const tokenData = JSON.parse(fs.readFileSync(tp, 'utf8'));
  const creds = {
    client_id: tokenData.tokens.client_id || process.env.GMAIL_OAUTH_CLIENT_ID,
    client_secret: tokenData.tokens.client_secret || process.env.GMAIL_OAUTH_CLIENT_SECRET,
  };

  // We need client_id/secret to refresh tokens. If not in token file, read client_secret.json
  const clientSecretPath = '/sandbox/config/client_secret.json';
  if ((!creds.client_id || !creds.client_secret) && fs.existsSync(clientSecretPath)) {
    const loaded = loadClientCredentials(clientSecretPath);
    creds.client_id = creds.client_id || loaded.client_id;
    creds.client_secret = creds.client_secret || loaded.client_secret;
  }

  const oauth2Client = new OAuth2Client(creds.client_id, creds.client_secret);
  oauth2Client.setCredentials(tokenData.tokens);

  const results = { label, email: tokenData.email, checks: {} };

  // Check 1: Token exists and has refresh_token
  results.checks.has_refresh_token = !!tokenData.tokens.refresh_token;

  // Check 2: Gmail profile access
  try {
    const gmail = require('@googleapis/gmail');
    const gmailClient = gmail.gmail({ version: 'v1', auth: oauth2Client });
    const profile = await gmailClient.users.getProfile({ userId: 'me' });
    results.checks.gmail_profile = true;
    results.email = profile.data.emailAddress;
    results.historyId = profile.data.historyId;
  } catch (e) {
    results.checks.gmail_profile = false;
    results.checks.gmail_profile_error = e.message;
  }

  // Check 3: Gmail messages.list
  try {
    const gmail = require('@googleapis/gmail');
    const gmailClient = gmail.gmail({ version: 'v1', auth: oauth2Client });
    const msgs = await gmailClient.users.messages.list({ userId: 'me', maxResults: 1 });
    results.checks.gmail_messages_list = true;
  } catch (e) {
    results.checks.gmail_messages_list = false;
    results.checks.gmail_messages_list_error = e.message;
  }

  // Check 4: Gmail history.list
  try {
    const gmail = require('@googleapis/gmail');
    const gmailClient = gmail.gmail({ version: 'v1', auth: oauth2Client });
    const hid = tokenData.historyId || results.historyId;
    if (hid) {
      await gmailClient.users.history.list({ userId: 'me', startHistoryId: hid });
    }
    results.checks.gmail_history_list = true;
  } catch (e) {
    // 404 is OK — means historyId is stale but API access works
    if (e.code === 404) {
      results.checks.gmail_history_list = true;
      results.checks.gmail_history_list_note = 'historyId stale (404) — API access confirmed';
    } else {
      results.checks.gmail_history_list = false;
      results.checks.gmail_history_list_error = e.message;
    }
  }

  const allPassed = Object.entries(results.checks)
    .filter(([k]) => !k.endsWith('_error') && !k.endsWith('_note'))
    .every(([, v]) => v === true);
  results.all_passed = allPassed;

  console.log(JSON.stringify(results, null, 2));
  return results;
}

function listAccounts() {
  if (!fs.existsSync(STATE_DIR)) {
    console.log(JSON.stringify([]));
    return;
  }
  const files = fs.readdirSync(STATE_DIR).filter(f => f.startsWith('token-') && f.endsWith('.json'));
  const accounts = files.map(f => {
    const data = JSON.parse(fs.readFileSync(path.join(STATE_DIR, f), 'utf8'));
    return { label: data.label, email: data.email, created: data.created };
  });
  console.log(JSON.stringify(accounts, null, 2));
}

async function profile(label) {
  const tp = tokenPath(label);
  if (!fs.existsSync(tp)) {
    console.error(JSON.stringify({ error: `Token file not found: ${tp}` }));
    process.exit(1);
  }
  const tokenData = JSON.parse(fs.readFileSync(tp, 'utf8'));
  console.log(JSON.stringify({ label: tokenData.label, email: tokenData.email, historyId: tokenData.historyId }));
}

// --- CLI ---
const [,, command, ...args] = process.argv;

(async () => {
  try {
    switch (command) {
      case 'auth':
        await authenticate(args[0], args[1]);
        break;
      case 'verify':
        await verify(args[0]);
        break;
      case 'list':
        listAccounts();
        break;
      case 'profile':
        await profile(args[0]);
        break;
      default:
        console.error('Usage: gmail-oauth-helper.cjs <auth|verify|list|profile> [args]');
        process.exit(1);
    }
  } catch (e) {
    console.error(`Error: ${e.message}`);
    process.exit(1);
  }
})();
