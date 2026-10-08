// npm start: serve the UI on this machine only, and keep the data fresh.
//
//   - Serves only the files the page needs. Secrets (.env, .threadline/),
//     source code, and raw entities are never served.
//   - Listens on 127.0.0.1, so other machines on the network cannot connect.
//   - Runs `src/sync.ts` at start and then every server.syncIntervalMinutes.
//     A Mac that wakes from sleep syncs right away if a run is overdue.
//   - Tells open pages when a sync finishes (Server-Sent Events), so they
//     update in place.
//
// npm run serve: the same server with automatic sync turned off.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { spawn, type ChildProcess } from 'node:child_process';
import { extname, join, resolve } from 'node:path';
import { loadConfig } from './core/config.ts';

const ROOT = resolve(import.meta.dirname, '..');
const config = await loadConfig(join(ROOT, 'threadline.config.json'));
const { syncIntervalMinutes } = config.server;
const port = Number(process.env.PORT) || config.server.port;
const autoSync = !process.argv.includes('--no-sync');

/** The only paths the server will read from disk. */
const STATIC = new Set(['/index.html', '/app.js', '/loader.js', '/theme.js', '/styles.css', '/data/state.json']);
const FIXTURE = /^\/fixtures\/[a-z0-9-]+\.json$/;
const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

interface SyncStatus {
  autoSync: boolean;
  intervalMinutes: number;
  running: boolean;
  lastRun: { startedAt: string; finishedAt: string; ok: boolean; summary: string } | null;
  nextRunAt: string | null;
}

const status: SyncStatus = { autoSync, intervalMinutes: syncIntervalMinutes, running: false, lastRun: null, nextRunAt: null };
const listeners = new Set<ServerResponse>();
let child: ChildProcess | null = null;

function broadcast() {
  const message = `event: status\ndata: ${JSON.stringify(status)}\n\n`;
  for (const res of listeners) res.write(message);
}

function runSync(reason: string) {
  if (status.running) return;
  const startedAt = new Date();
  status.running = true;
  broadcast();
  log(`sync started (${reason})`);

  let output = '';
  child = spawn(process.execPath, ['--env-file-if-exists=.env', 'src/sync.ts'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout?.on('data', chunk => { output += chunk; });
  child.stderr?.on('data', chunk => { output += chunk; });
  child.on('close', code => {
    child = null;
    const lines = output.split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(l => l && !l.startsWith('.env not found'));
    status.running = false;
    status.lastRun = {
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      ok: code === 0,
      summary: lines.filter(l => /^[✓✗]/.test(l)).join(' · ') || lines.at(-1) || `exit code ${code}`,
    };
    status.nextRunAt = autoSync ? new Date(Date.now() + syncIntervalMinutes * 60_000).toISOString() : null;
    broadcast();
    log(`sync ${code === 0 ? 'finished' : 'failed'}: ${status.lastRun.summary}`);
  });
}

async function serveFile(path: string, res: ServerResponse) {
  try {
    const body = await readFile(join(ROOT, path));
    res.writeHead(200, { 'Content-Type': TYPES[extname(path)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404).end('Not found');
  }
}

/** Blocks DNS-rebinding: a page on another site cannot pose as localhost. */
function fromLocalhost(req: IncomingMessage): boolean {
  const host = (req.headers.host ?? '').replace(/:\d+$/, '');
  return host === 'localhost' || host === '127.0.0.1';
}

const server = createServer(async (req, res) => {
  if (!fromLocalhost(req)) { res.writeHead(403).end('Forbidden'); return; }
  const path = new URL(req.url ?? '/', 'http://localhost').pathname;

  if (path === '/api/sync' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(status));
    return;
  }
  if (path === '/api/sync' && req.method === 'POST') {
    runSync('requested from the page');
    res.writeHead(202, { 'Content-Type': 'application/json' }).end(JSON.stringify(status));
    return;
  }
  if (path === '/api/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.write(`event: status\ndata: ${JSON.stringify(status)}\n\n`);
    listeners.add(res);
    req.on('close', () => listeners.delete(res));
    return;
  }

  if (path === '/favicon.ico') { res.writeHead(204).end(); return; }
  const file = path === '/' ? '/index.html' : path;
  if (req.method === 'GET' && (STATIC.has(file) || FIXTURE.test(file))) { await serveFile(file, res); return; }
  res.writeHead(404).end('Not found');
});

server.listen(port, '127.0.0.1', () => {
  log(`Threadline is running at http://localhost:${port}`);
  log(autoSync ? `Syncing now, then every ${syncIntervalMinutes} minutes. Press Ctrl+C to stop.` : 'Automatic sync is off. Press Ctrl+C to stop.');
  if (autoSync) runSync('startup');
});

// Check every 30 seconds rather than one long timer, so a sync that came
// due while the Mac slept runs right after it wakes.
if (autoSync) {
  setInterval(() => {
    if (status.nextRunAt && Date.now() >= Date.parse(status.nextRunAt)) runSync('scheduled');
  }, 30_000);
}

// SSE connections idle out in some browsers; a comment line keeps them open.
setInterval(() => { for (const res of listeners) res.write(': keep-alive\n\n'); }, 25_000);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    child?.kill();
    for (const res of listeners) res.end();
    server.close();
    process.exit(0);
  });
}

function log(message: string) {
  console.log(`[${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}] ${message}`);
}
