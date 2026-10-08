// npm run sync
//
// SOURCE → ADAPTER → NORMALIZER → STORAGE → PROJECTION → data/state.json
//
// A source that is not configured or fails is skipped and reported. The
// sync still writes a valid view from whatever did succeed.

import { mkdir, writeFile } from 'node:fs/promises';
import { loadConfig } from './core/config.ts';
import { EntityStore, type Event, type Project, type WorkItem } from './core/schema/entities.ts';
import { buildView } from './core/projections/view.ts';
import { loadMemory } from './storage/memory.ts';
import { localDate, localIso, addDays, atTime } from './core/time.ts';
import { TeamworkAdapter } from './adapters/teamwork/adapter.ts';
import { normalizeTeamwork } from './adapters/teamwork/normalize.ts';
import { GoogleCalendarAdapter } from './adapters/calendar/adapter.ts';
import { normalizeCalendar } from './adapters/calendar/normalize.ts';
import { GithubAdapter } from './adapters/github/adapter.ts';
import { normalizeGithub } from './adapters/github/normalize.ts';

const config = await loadConfig();
// Every local-time calculation below ("today", workday hours) uses this zone.
if (config.timezone) process.env.TZ = config.timezone;
const now = new Date();
const syncedAt = localIso(now);
const memory = await loadMemory();
const notes: string[] = [];

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

// A code host can map work to a project Teamwork did not return.
// Give that project a minimal record so the UI can show it.
const knownProjects = new Set(projects.map(p => p.id));
const aliases = new Map(Object.values(config.teamwork.projects).map(a => [a.id, a.name]));
for (const item of workItems) {
  if (!item.projectId || knownProjects.has(item.projectId)) continue;
  knownProjects.add(item.projectId);
  projects.push({
    id: item.projectId,
    name: aliases.get(item.projectId) ?? item.projectId,
    description: 'Defined in threadline.config.json',
    client: null, startAt: null, endAt: null,
    source: { type: 'manual', id: item.projectId, url: null, syncedAt },
  });
}

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

const store = EntityStore.parse({ syncedAt, user, projects, workItems, events, sourceStatus });
const view = buildView(store, memory, config, now);

await mkdir('data', { recursive: true });
await writeFile('data/entities.json', JSON.stringify(store, null, 2));
await writeFile('data/state.json', JSON.stringify(view, null, 2));

for (const s of sourceStatus) console.log(`${s.ok ? '✓' : '✗'} ${s.type.padEnd(16)} ${s.message}`);
for (const n of notes) console.log(`\n· ${n}`);
console.log(`\nWrote data/state.json: ${view.attention.length} attention items, ${view.nextUp.length} next up, ${view.projects.length} projects.`);
if (!sourceStatus.some(s => s.ok)) {
  console.log('No source synced. The UI will still load, but it will be mostly empty. Add credentials to .env (see README).');
  process.exitCode = 1;
}
