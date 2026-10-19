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
import { EntityStore, type Activity, type Allocation, type Event, type Goal, type KnowledgeDocument, type Leave, type Project, type Requirement, type TimeLog, type WorkItem } from './core/schema/entities.ts';
import { buildView } from './core/projections/view.ts';
import { diffSnapshots } from './core/projections/changes.ts';
import type { ContinuityView } from './core/schema/view.ts';
import { loadMemory } from './storage/memory.ts';
import { loadTodos } from './storage/todos.ts';
import { loadActivity, saveSnapshot, snapshotAt, toSnapshot } from './storage/history.ts';
import type { DayStages, StageMap } from './core/projections/report.ts';
import { deriveJournalEntries } from './core/projections/journal.ts';
import { appendJournal, readJournal } from './storage/journal.ts';
import { loadNotes } from './storage/notes.ts';
import { loadClaudeUsage } from './storage/claude-usage.ts';
import { localDate, localIso, addDays, atTime } from './core/time.ts';
import { TeamworkAdapter } from './adapters/teamwork/adapter.ts';
import { normalizeTeamwork } from './adapters/teamwork/normalize.ts';
import { GoogleCalendarAdapter } from './adapters/calendar/adapter.ts';
import { normalizeCalendar } from './adapters/calendar/normalize.ts';
import { GithubAdapter } from './adapters/github/adapter.ts';
import { normalizeGithub } from './adapters/github/normalize.ts';
import { normalizeTodo } from './adapters/manual/normalize.ts';
import { RelayAdapter } from './adapters/relay/adapter.ts';
import { linkRequirements, normalizeRelayListing, normalizeRelayPrd } from './adapters/relay/normalize.ts';
import { MALCOLM_IMPORT_PATH, MalcolmImport } from './adapters/malcolm/schema.ts';
import { normalizeMalcolm } from './adapters/malcolm/normalize.ts';
import { LEAPSOME_IMPORT_PATH, LeapsomeImport } from './adapters/leapsome/schema.ts';
import { normalizeLeapsome } from './adapters/leapsome/normalize.ts';
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
  // The journal is permanent. It is written before the new snapshot, so stage
  // moves compare against the previous one.
  const journaled = await appendJournal(deriveJournalEntries(synced, await snapshotAt(now), await loadTodos(), localDate(now)));
  if (journaled) notes.push(`Added ${journaled} entr${journaled === 1 ? 'y' : 'ies'} to the work journal.`);
  // Only a complete sync becomes history. A failed source would look like
  // all of its work vanished.
  if (synced.sourceStatus.every(s => s.ok)) await saveSnapshot(toSnapshot(synced));
}

const todos = await loadTodos();
const workItems = [...synced.workItems, ...todos.map(t => normalizeTodo(t, synced.syncedAt))];
const store = EntityStore.parse({ ...synced, workItems, projects: withReferencedProjects(synced.projects, workItems, config, synced.syncedAt) });
const view = buildView(store, await loadMemory(), config, now, {
  todos,
  continuity: await continuityFor(synced, config, now),
  stagesByDate: await stagesForReport(config, now),
  journal: await readJournal(addDays(localDate(now), -30)),
  notes: await loadNotes(),
  claudeUsage: await loadClaudeUsage(),
});
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
  let activities: Activity[] = [];
  let timeLogs: TimeLog[] = [];
  let allocations: Allocation[] = [];
  let leave: Leave[] = [];
  let requirements: Requirement[] = [];
  let documents: KnowledgeDocument[] = [];
  let goals: Goal[] = [];
  const sourceStatus: EntityStore['sourceStatus'] = [];

  // Teamwork first: calendar events link to its projects by name.
  if (process.env.TEAMWORK_API_KEY) {
    try {
      const records = await new TeamworkAdapter({
        site: config.teamwork.site,
        apiKey: process.env.TEAMWORK_API_KEY,
        completedLookbackDays: config.teamwork.completedLookbackDays,
        // Midnight, report.days ago: enough history for the report page.
        activitySince: atTime(addDays(localDate(now), -(config.report.days - 1)), '00:00'),
      }).sync();
      const result = normalizeTeamwork(records, config, syncedAt);
      ({ projects, workItems, activities, timeLogs } = result);
      if (result.unrecognizedStages.length) notes.push(`Teamwork stages with no status rule (add them to teamwork.stageStatus): ${result.unrecognizedStages.join(', ')}`);
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

  // Relay: PRDs for the mapped projects, linked to the work they describe.
  const relaySlugs = [...new Set(Object.values(config.relay.projects).flat())];
  if (relaySlugs.length && !config.relay.url) {
    sourceStatus.push({ type: 'relay', ok: false, message: 'Set relay.url in threadline.config.json' });
  } else if (relaySlugs.length && config.relay.url && process.env.RELAY_API_KEY) {
    try {
      const { prds, listings, fetched } = await new RelayAdapter(config.relay.url, process.env.RELAY_API_KEY, relaySlugs).sync();
      requirements = prds.map(p => normalizeRelayPrd(p, config, syncedAt));
      documents = listings.map(l => normalizeRelayListing(l, config, syncedAt));
      workItems = linkRequirements(workItems, requirements);
      const linked = workItems.filter(w => w.prdIds.length).length;
      sourceStatus.push({ type: 'relay', ok: true, message: `${requirements.length} PRDs across ${relaySlugs.length} projects, ${linked} linked to your work (${fetched} refreshed)` });
    } catch (err) {
      sourceStatus.push({ type: 'relay', ok: false, message: (err as Error).message });
    }
  } else if (relaySlugs.length) {
    sourceStatus.push({ type: 'relay', ok: false, message: 'RELAY_API_KEY is not set' });
  }

  // Malcolm: read the last import. `npm run import:malcolm` (or the server) refreshes it.
  if (config.malcolm.enabled) {
    try {
      const data = MalcolmImport.parse(JSON.parse(await readFile(MALCOLM_IMPORT_PATH, 'utf8')));
      ({ allocations, leave } = normalizeMalcolm(data, config, syncedAt));
      const ageHours = (Date.now() - Date.parse(data.importedAt)) / 3_600_000;
      const age = ageHours < 1 ? 'under an hour ago' : `${Math.round(ageHours)} h ago`;
      sourceStatus.push({ type: 'malcolm', ok: true, message: `${allocations.length} allocations, ${leave.length} leave requests, imported ${age}${ageHours > config.malcolm.maxAgeHours ? ' (stale: run npm run import:malcolm)' : ''}` });
    } catch (err) {
      const missing = (err as NodeJS.ErrnoException).code === 'ENOENT';
      sourceStatus.push({ type: 'malcolm', ok: false, message: missing ? 'No import yet. Run npm run import:malcolm' : `Import file is invalid: ${(err as Error).message.slice(0, 160)}` });
    }
  }

  // Leapsome: read the last goal import. `npm run import:leapsome` (or the server) refreshes it.
  if (config.leapsome.enabled) {
    try {
      const data = LeapsomeImport.parse(JSON.parse(await readFile(LEAPSOME_IMPORT_PATH, 'utf8')));
      goals = normalizeLeapsome(data, syncedAt);
      const live = goals.filter(g => g.status !== 'archived').length;
      sourceStatus.push({ type: 'leapsome', ok: true, message: `${live} current goal${live === 1 ? '' : 's'}, ${goals.length - live} from past cycles` });
    } catch (err) {
      const missing = (err as NodeJS.ErrnoException).code === 'ENOENT';
      sourceStatus.push({ type: 'leapsome', ok: false, message: missing ? 'No import yet. Run npm run import:leapsome' : `Import file is invalid: ${(err as Error).message.slice(0, 160)}` });
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

  return EntityStore.parse({ syncedAt, user, projects, workItems, events, activities, timeLogs, allocations, leave, requirements, documents, goals, sourceStatus });
}

/** Each report day's start-of-day and end-of-day stages, from snapshots. */
async function stagesForReport(config: Config, now: Date): Promise<Map<string, DayStages>> {
  const toMap = (s: Awaited<ReturnType<typeof snapshotAt>>): StageMap =>
    s ? new Map(s.workItems.filter(w => w.stage !== undefined).map(w => [w.id, w.stage ?? null])) : null;
  const out = new Map<string, DayStages>();
  const today = localDate(now);
  for (let d = 0; d < config.report.days; d++) {
    const date = addDays(today, -d);
    out.set(date, {
      start: toMap(await snapshotAt(atTime(date, '00:00'))),
      end: d === 0 ? null : toMap(await snapshotAt(atTime(addDays(date, 1), '00:00'))),
    });
  }
  return out;
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
