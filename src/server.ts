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
import { loadTodos, saveTodos, Todo, TodoInput, TodoPatch } from './storage/todos.ts';
import { loadNotes, saveNotes, ThreadNote } from './storage/notes.ts';
import { loadActivity, recordSeen, saveActivity } from './storage/history.ts';
import { localIso } from './core/time.ts';
import { MALCOLM_IMPORT_PATH } from './adapters/malcolm/schema.ts';
import { LEAPSOME_IMPORT_PATH } from './adapters/leapsome/schema.ts';
import { stat } from 'node:fs/promises';
import { watch } from 'node:fs';

const ROOT = resolve(import.meta.dirname, '..');
// Storage modules use paths relative to the project folder.
process.chdir(ROOT);
const config = await loadConfig('threadline.config.json');
if (config.timezone) process.env.TZ = config.timezone;
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

function broadcast(event = 'status', data: unknown = status) {
  const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of listeners) res.write(message);
}

// One job at a time. A sync fetches from every source; a rebuild only
// recomputes the view from the last sync plus your to-dos and activity.
let jobRunning = false;
let pendingSync: string | null = null;
let pendingRebuild = false;

function runSync(reason: string) {
  if (status.running) return;
  if (jobRunning) { pendingSync = reason; return; }
  runJob('sync', reason);
}

function requestRebuild() {
  if (jobRunning) { pendingRebuild = true; return; }
  runJob('rebuild', 'local change');
}

function runJob(kind: 'sync' | 'rebuild', reason: string) {
  jobRunning = true;
  const startedAt = new Date();
  if (kind === 'sync') {
    status.running = true;
    broadcast();
    log(`sync started (${reason})`);
  }

  let output = '';
  const args = ['--env-file-if-exists=.env', 'src/sync.ts', ...(kind === 'rebuild' ? ['--rebuild'] : [])];
  child = spawn(process.execPath, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout?.on('data', chunk => { output += chunk; });
  child.stderr?.on('data', chunk => { output += chunk; });
  child.on('close', code => {
    child = null;
    jobRunning = false;
    const lines = output.split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(l => l && !l.startsWith('.env not found'));
    if (kind === 'sync') {
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
    } else if (code !== 0) {
      log(`rebuild failed: ${lines.at(-1) ?? `exit code ${code}`}`);
    }
    // data/state.json changed: open pages reload it.
    if (code === 0) broadcast('state', { at: new Date().toISOString() });

    if (pendingSync) { const r = pendingSync; pendingSync = null; runJob('sync', r); }
    else if (pendingRebuild) { pendingRebuild = false; runJob('rebuild', 'local change'); }
  });
}

// ── Claude-run imports ──────────────────────────────────────────────────
// Malcolm and Leapsome have no personal API tokens yet, so a Claude run
// refreshes their import files when they are missing or older than maxAgeHours.

const IMPORTS = [
  { name: 'Malcolm', enabled: config.malcolm.enabled, path: MALCOLM_IMPORT_PATH, maxAgeHours: config.malcolm.maxAgeHours, script: 'src/adapters/malcolm/import.ts' },
  { name: 'Leapsome', enabled: config.leapsome.enabled, path: LEAPSOME_IMPORT_PATH, maxAgeHours: config.leapsome.maxAgeHours, script: 'src/adapters/leapsome/import.ts' },
];
const importing = new Set<string>();

async function refreshImportsIfStale() {
  for (const imp of IMPORTS) {
    if (!imp.enabled || importing.has(imp.name)) continue;
    const age = await stat(imp.path).then(s => Date.now() - s.mtimeMs, () => Infinity);
    if (age < imp.maxAgeHours * 3_600_000) continue;
    importing.add(imp.name);
    log(`${imp.name} import started`);
    const child = spawn(process.execPath, ['--env-file-if-exists=.env', imp.script], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout?.on('data', c => { output += c; });
    child.stderr?.on('data', c => { output += c; });
    child.on('close', code => {
      importing.delete(imp.name);
      log(code === 0 ? output.trim().split('\n').at(-1) ?? `${imp.name} import finished` : `${imp.name} import failed: ${output.trim().slice(0, 200)}`);
      if (code === 0) requestRebuild();
    });
  }
}

// ── To-dos and activity ─────────────────────────────────────────────────

/** Serializes writes to memory/todos.json. */
let todoWrites: Promise<unknown> = Promise.resolve();
function withTodos<T>(fn: (todos: Todo[]) => Promise<T> | T): Promise<T> {
  const next = todoWrites.then(async () => {
    const todos = await loadTodos();
    const result = await fn(todos);
    await saveTodos(todos);
    return result;
  });
  todoWrites = next.catch(() => {});
  return next;
}

class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

/** JSON bodies only, and only from this page. Blocks cross-site form posts. */
async function readJson(req: IncomingMessage): Promise<unknown> {
  const origin = req.headers.origin;
  if (origin && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) throw new HttpError(403, 'Forbidden origin');
  if (!(req.headers['content-type'] ?? '').startsWith('application/json')) throw new HttpError(415, 'Send JSON');
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 10_000) throw new HttpError(413, 'Too large');
  }
  try { return body ? JSON.parse(body) : {}; } catch { throw new HttpError(400, 'Invalid JSON'); }
}

function sendJson(res: ServerResponse, code: number, data: unknown) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(data));
}

/** Serializes writes to memory/notes.json. */
let noteWrites: Promise<unknown> = Promise.resolve();
function withNotes<T>(fn: (notes: Record<string, ThreadNote[]>) => T): Promise<T> {
  const next = noteWrites.then(async () => {
    const notes = await loadNotes();
    const result = fn(notes);
    await saveNotes(notes);
    return result;
  });
  noteWrites = next.catch(() => {});
  return next;
}

async function handleApi(req: IncomingMessage, res: ServerResponse, path: string): Promise<boolean> {
  const todoMatch = path.match(/^\/api\/todos\/([a-z0-9-]+)$/);
  const noteMatch = path.match(/^\/api\/threads\/([\w.-]+)\/notes(?:\/([a-z0-9]+))?$/);

  // Thread notes: local working notes, never sent to a source.
  if (noteMatch && req.method === 'POST' && !noteMatch[2]) {
    const input = (await readJson(req)) as { body?: unknown };
    const note = ThreadNote.safeParse({ id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, at: localIso(new Date()), body: input.body });
    if (!note.success) throw new HttpError(400, note.error.issues[0]?.message ?? 'Invalid note');
    await withNotes(notes => { notes[noteMatch[1]] = [...(notes[noteMatch[1]] ?? []), note.data]; });
    requestRebuild();
    sendJson(res, 201, note.data);
    return true;
  }
  if (noteMatch && req.method === 'DELETE' && noteMatch[2]) {
    await readJson(req).catch(() => {}); // no body needed, but keep the origin check
    const removed = await withNotes(notes => {
      const list = notes[noteMatch[1]] ?? [];
      const kept = list.filter(n => n.id !== noteMatch[2]);
      notes[noteMatch[1]] = kept;
      return kept.length !== list.length;
    });
    if (!removed) throw new HttpError(404, 'No such note');
    requestRebuild();
    sendJson(res, 200, { ok: true });
    return true;
  }

  if (path === '/api/todos' && req.method === 'GET') {
    sendJson(res, 200, { todos: await loadTodos() });
    return true;
  }
  if (path === '/api/todos' && req.method === 'POST') {
    const input = TodoInput.safeParse(await readJson(req));
    if (!input.success) throw new HttpError(400, input.error.issues[0]?.message ?? 'Invalid to-do');
    const stamp = localIso(new Date());
    const todo = await withTodos(todos => {
      const created = Todo.parse({ ...input.data, id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, createdAt: stamp, updatedAt: stamp });
      todos.push(created);
      return created;
    });
    requestRebuild();
    sendJson(res, 201, todo);
    return true;
  }
  if (todoMatch && (req.method === 'PATCH' || req.method === 'DELETE')) {
    const id = todoMatch[1];
    const patch = req.method === 'PATCH' ? TodoPatch.safeParse(await readJson(req)) : null;
    if (patch && !patch.success) throw new HttpError(400, patch.error.issues[0]?.message ?? 'Invalid change');
    if (!patch) await readJson(req).catch(() => {}); // DELETE needs no body, but keep the origin check
    const result = await withTodos(todos => {
      const index = todos.findIndex(t => t.id === id);
      if (index < 0) return null;
      if (!patch) return todos.splice(index, 1)[0];
      const stamp = localIso(new Date());
      const t = todos[index];
      const next = { ...t, ...patch.data, updatedAt: stamp };
      if (patch.data.status === 'done' && t.status !== 'done') next.completedAt = stamp;
      if (patch.data.status === 'open') next.completedAt = null;
      todos[index] = Todo.parse(next);
      return todos[index];
    });
    if (!result) throw new HttpError(404, 'No such to-do');
    requestRebuild();
    sendJson(res, 200, result);
    return true;
  }
  if (path === '/api/seen' && req.method === 'POST') {
    const body = (await readJson(req)) as { acknowledge?: boolean };
    const activity = await loadActivity();
    const now = new Date();
    const newSession = recordSeen(activity, now);
    if (body.acknowledge) activity.acknowledgedAt = now.toISOString();
    await saveActivity(activity);
    // A new session may need "while you were away"; dismissing hides it.
    if (newSession || body.acknowledge) requestRebuild();
    sendJson(res, 200, { newSession });
    return true;
  }
  return false;
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
  if (path.startsWith('/api/') && path !== '/api/events' && path !== '/api/sync') {
    try {
      if (await handleApi(req, res, path)) return;
    } catch (err) {
      const code = err instanceof HttpError ? err.status : 500;
      if (code === 500) log(`error on ${path}: ${(err as Error).message}`);
      sendJson(res, code, { error: (err as Error).message });
      return;
    }
    sendJson(res, 404, { error: 'Not found' });
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
  // Claude Code rewrites data/claude-usage.json after each reply; show it within a minute.
  let usageTimer: NodeJS.Timeout | null = null;
  try {
    watch(join(ROOT, 'data'), (_event, file) => {
      if (file !== 'claude-usage.json' || usageTimer) return;
      usageTimer = setTimeout(() => { usageTimer = null; requestRebuild(); }, 60_000);
    });
  } catch { /* no data folder yet; the next sync creates it */ }

  if (autoSync) {
    runSync('startup');
    void refreshImportsIfStale();
    setInterval(() => void refreshImportsIfStale(), 30 * 60_000);
  }
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
