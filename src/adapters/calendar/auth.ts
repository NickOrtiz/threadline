// One-time Google sign-in: `npm run auth:google`.
//
// Uses the OAuth "desktop app" loopback flow with PKCE. It stores only the
// refresh token, in .threadline/google-token.json (git-ignored, mode 600).
// Scope is read-only calendar events.

import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { TOKEN_PATH } from './adapter.ts';

const SCOPE = 'https://www.googleapis.com/auth/calendar.events.readonly';

const clientId = process.env.GOOGLE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
if (!clientId || !clientSecret) {
  console.error('Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env first. See README → Google Calendar setup.');
  process.exit(1);
}

const verifier = randomBytes(32).toString('base64url');
const challenge = createHash('sha256').update(verifier).digest('base64url');
const state = randomBytes(16).toString('base64url');

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  if (url.pathname !== '/callback') { res.writeHead(404).end(); return; }
  if (url.searchParams.get('state') !== state) { res.writeHead(400).end('State mismatch.'); return; }
  const code = url.searchParams.get('code');
  if (!code) { res.writeHead(400).end(`Sign-in failed: ${url.searchParams.get('error')}`); return; }

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code, client_id: clientId, client_secret: clientSecret, code_verifier: verifier,
        grant_type: 'authorization_code', redirect_uri: redirectUri(),
      }),
    });
    const token = await tokenRes.json() as { refresh_token?: string; scope?: string; error?: string };
    if (!token.refresh_token) throw new Error(token.error ?? 'Google returned no refresh token.');
    await mkdir('.threadline', { recursive: true });
    await writeFile(TOKEN_PATH, JSON.stringify({ refresh_token: token.refresh_token, scope: token.scope, createdAt: new Date().toISOString() }, null, 2), { mode: 0o600 });
    res.writeHead(200, { 'Content-Type': 'text/plain' }).end('Threadline is connected to Google Calendar. You can close this tab.');
    console.log(`Saved refresh token to ${TOKEN_PATH}. Run npm run sync next.`);
  } catch (err) {
    res.writeHead(500).end(String(err));
    console.error(err);
    process.exitCode = 1;
  } finally {
    server.close();
  }
});

function redirectUri() {
  const addr = server.address();
  return `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}/callback`;
}

server.listen(0, '127.0.0.1', () => {
  const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  auth.search = new URLSearchParams({
    client_id: clientId, redirect_uri: redirectUri(), response_type: 'code', scope: SCOPE,
    access_type: 'offline', prompt: 'consent', state, code_challenge: challenge, code_challenge_method: 'S256',
  }).toString();
  console.log(`Opening Google sign-in. If no browser opens, visit:\n\n${auth}\n`);
  spawn('open', [auth.toString()], { stdio: 'ignore', detached: true }).on('error', () => {});
});
