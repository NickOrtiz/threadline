// npm run sync
//
// SOURCE → ADAPTER → NORMALIZER → STORAGE → PROJECTION → data/state.json
//
// A source that is not configured or fails is skipped and reported. The
// sync still writes a valid view from whatever did succeed.
//
// With --rebuild, nothing is fetched. The last synced records in
// data/entities.json are combined with your current to-dos and activity,
// and the view is rebuilt. The server uses this after you edit a to-do.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { loadConfig, type Config } from './core/config.ts';
import { EntityStore, type Event, type Project, type WorkItem } from './core/schema/entities.ts';
import { buildView } from './core/projections/view.ts';
import { diffSnapshots } from './core/projections/changes.ts';
import type { ContinuityView } from './core/schema/view.ts';
import { loadMemory } from './storage/memory.ts';
import { loadTodos } from './storage/todos.ts';
import { loadActivity, saveSnapshot, snapshotAt, toSnapshot } from './storage/history.ts';
import { localDate, localIso, addDays, atTime } from './core/time.ts';
import { TeamworkAdapter } from './adapters/teamwork/adapter.ts';
import { normalizeTeamwork } from './adapters/teamwork/normalize.ts';
import { GoogleCalendarAdapter } from './adapters/calendar/adapter.ts';
import { normalizeCalendar } from './adapters/calendar/normalize.ts';
import { GithubAdapter } from './adapters/github/adapter.ts';
import { normalizeGithub } from './adapters/github/normalize.ts';
import { normalizeTodo } from './adapters/manual/normalize.ts';
import type { z } from 'zod';

const rebuild = process.argv.includes('--rebuild');
const config = await loadConfig();
// Every local-time calculation below ("today", workday hours) uses this zone.
if (config.timezone) process.env.TZ = config.timezone;
const now = new Date();
const notes: string[] = [];

/** Synced records only. Your to-dos are merged in later, never stored here. */
const synced = rebuild ? await loadLastSync() : await fetchSources(config, localIso(now));
if (!synced) {
  console.log('Nothing to rebuild yet. Run npm run sync first.');
  process.exit(1);
}

if (!rebuild) {
  await mkdir('data', { recursive: true });
  await writeFile('data/entities.json', JSON.stringify(synced, null, 2));
  // Only a complete sync becomes history. A failed source would look like
  // all of its work vanished.
  if (synced.sourceStatus.every(s => s.ok)) await saveSnapshot(toSnapshot(synced));
}

const todos = await loadTodos();
const workItems = [...synced.workItems, ...todos.map(t => normalizeTodo(t, synced.syncedAt))];
const store = EntityStore.parse({ ...synced, workItems, projects: withReferencedProjects(synced.projects, workItems, config, synced.syncedAt) });
const view = buildView(store, await loadMemory(), config, now, { todos, continuity: await continuityFor(synced, config, now) });
await writeFile('data/state.json', JSON.stringify(view, null, 2));

if (rebuild) {
  console.log(`Rebuilt data/state.json from the ${synced.syncedAt} sync.`);
} else {
  for (const s of synced.sourceStatus) console.log(`${s.ok ? '✓' : '✗'} ${s.type.padEnd(16)} ${s.message}`);
  for (const n of notes) console.log(`\n· ${n}`);
  console.log(`\nWrote data/state.json: ${view.attention.length} attention items, ${view.nextUp.length} next up, ${view.projects.length} projects.`);
  if (!synced.sourceStatus.some(s => s.ok)) {
    console.log('No source synced. The UI will still load, but it will be mostly empty. Add credentials to .env (see README).');
    process.exitCode = 1;
  }
}

async function loadLastSync(): Promise<EntityStore | null> {
  try {
    return EntityStore.parse(JSON.parse(await readFile('data/entities.json', 'utf8')));
  } catch {
    return null;
  }
}

async function fetchSources(config: Config, syncedAt: string): Promise<EntityStore> {
  let user = { id: 'me', name: 'You', initials: '··' };
  let projects: Project[] = [];
  let workItems: WorkItem[] = [];
  let events: Event[] = [];
  const sourceStatus: EntityStore['sourceStatus'] = [];

  // Teamwork first: calendar events link to its projects by name.
  if (process.env.TEAMWORK_API_KEY) {
    try {
      const records = await new TeamworkAdapter({
        site: config.teamwork.site,
        apiKey: process.env.TEAMWORK_API_KEY,
        completedLookbackDays: config.teamwork.completedLookbackDays,
      }).sync();
      ({ projects, workItems } = normalizeTeamwork(records, config, syncedAt));
      const { firstName, lastName, id } = records.me;
      user = { id: String(id), name: `${firstName} ${lastName}`, initials: `${firstName[0]}${lastName[0]}`.toUpperCase() };
      sourceStatus.push({ type: 'teamwork', ok: true, message: `${workItems.length} tasks across ${projects.length} projects` });
    } catch (err) {
      sourceStatus.push({ type: 'teamwork', ok: false, message: (err as Error).message });
    }
  } else {
    sourceStatus.push({ type: 'teamwork', ok: false, message: 'TEAMWORK_API_KEY is not set' });
  }

  for (const connection of config.codeHosts) {
    const type = connection.type;
    try {
      const records = await new GithubAdapter(connection).sync();
      const result = normalizeGithub(records, syncedAt);
      // Two connections can see the same PR. Keep the first copy.
      const seen = new Set(workItems.map(w => w.id));
      workItems.push(...result.workItems.filter(w => !seen.has(w.id)));
      sourceStatus.push({ type, ok: true, message: `${connection.id} (${records.login}): ${result.workItems.length} items` });
      if (result.ignoredRepos.length) notes.push(`${connection.id} ignored repos not in its allowlist: ${result.ignoredRepos.join(', ')}`);
    } catch (err) {
      sourceStatus.push({ type, ok: false, message: `${connection.id}: ${(err as Error).message}` });
    }
  }

  projects = withReferencedProjects(projects, workItems, config, syncedAt);

  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    try {
      const today = localDate(now);
      const records = await new GoogleCalendarAdapter({
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        calendarIds: config.calendar.calendarIds,
        timeMin: atTime(today, '00:00'),
        timeMax: atTime(addDays(today, config.calendar.lookaheadDays + 1), '00:00'),
      }).sync();
      events = normalizeCalendar(records, projects, syncedAt);
      sourceStatus.push({ type: 'google-calendar', ok: true, message: `${events.length} events` });
    } catch (err) {
      sourceStatus.push({ type: 'google-calendar', ok: false, message: (err as Error).message });
    }
  } else {
    sourceStatus.push({ type: 'google-calendar', ok: false, message: 'GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set' });
  }

  return EntityStore.parse({ syncedAt, user, projects, workItems, events, sourceStatus });
}

/**
 * A code host or a to-do can point at a project no source returned.
 * Give that project a minimal record so the UI can show it.
 */
function withReferencedProjects(projects: Project[], items: WorkItem[], config: Config, syncedAt: string): Project[] {
  const out = [...projects];
  const known = new Set(out.map(p => p.id));
  const aliases = new Map(Object.values(config.teamwork.projects).map(a => [a.id, a.name]));
  for (const item of items) {
    if (!item.projectId || known.has(item.projectId)) continue;
    known.add(item.projectId);
    out.push({
      id: item.projectId,
      name: aliases.get(item.projectId) ?? item.projectId,
      description: 'Defined in threadline.config.json',
      client: null, startAt: null, endAt: null,
      source: { type: 'manual', id: item.projectId, url: null, syncedAt },
    });
  }
  return out;
}

/**
 * "While you were away": shown when this session began at least
 * continuity.awayHours after the last one ended, until you dismiss it.
 */
async function continuityFor(synced: EntityStore, config: Config, now: Date): Promise<z.infer<typeof ContinuityView> | null> {
  const activity = await loadActivity();
  const { previousSessionEndedAt: left, sessionStartedAt: back, acknowledgedAt: ack } = activity;
  if (!left || !back) return null;
  if (Date.parse(back) - Date.parse(left) < config.continuity.awayHours * 3_600_000) return null;
  if (ack && Date.parse(ack) >= Date.parse(back)) return null;

  const baseline = await snapshotAt(new Date(left));
  if (!baseline) return null;

  // When a source failed this time, its records are missing, not removed.
  const complete = synced.sourceStatus.every(s => s.ok);
  const changes = diffSnapshots(baseline, toSnapshot(synced), now)
    .filter(c => complete || (c.kind !== 'removed' && c.kind !== 'meeting_cancelled'));

  const hours = (now.getTime() - Date.parse(left)) / 3_600_000;
  return {
    since: left,
    sinceLabel: new Date(left).toLocaleString('en-US', { weekday: 'long', hour: 'numeric', minute: '2-digit' }),
    awayLabel: hours < 36 ? `${Math.round(hours)} hours` : `${Math.round(hours / 24)} days`,
    changes,
  };
}
