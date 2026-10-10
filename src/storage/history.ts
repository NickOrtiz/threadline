// Sync history and your activity, for "what changed since you left".
//
// Snapshots: after each online sync, a compact copy of the synced work and
// events goes to data/snapshots/. A new file is written only when something
// changed. Files older than 30 days are deleted, except the latest.
//
// Activity: the server records when you use the dashboard, in
// data/activity.json. A gap of 30 minutes or more starts a new session.

import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { EntityStore } from '../core/schema/entities.ts';

export const SNAPSHOT_DIR = 'data/snapshots';
export const ACTIVITY_PATH = 'data/activity.json';
const KEEP_DAYS = 30;

export interface Snapshot {
  syncedAt: string;
  workItems: {
    id: string; title: string; projectId: string | null; status: string; dueAt: string | null;
    updatedAt: string; review: string | null; checks: string | null; url: string | null; kind: string;
    /** Missing in snapshots taken before stages were tracked. */
    stage?: string | null;
  }[];
  events: { id: string; title: string; startAt: string; endAt: string; url: string | null }[];
}

/** Synced records only. To-dos you add yourself are not "changes while you were away". */
export function toSnapshot(store: EntityStore): Snapshot {
  return {
    syncedAt: store.syncedAt,
    workItems: store.workItems.filter(w => w.source.type !== 'manual' && w.mine).map(w => ({
      id: w.id, title: w.title, projectId: w.projectId, status: w.status, dueAt: w.dueAt, updatedAt: w.updatedAt,
      review: w.codeReview?.state ?? null, checks: w.codeReview?.checks ?? null, url: w.source.url, kind: w.kind, stage: w.stage,
    })),
    events: store.events.map(e => ({ id: e.id, title: e.title, startAt: e.startAt, endAt: e.endAt, url: e.source.url })),
  };
}

const fileFor = (syncedAt: string) => `${new Date(syncedAt).toISOString().replace(/[:.]/g, '-')}.json`;
const timeOf = (file: string) => Date.parse(file.replace('.json', '').replace(/T(\d\d)-(\d\d)-(\d\d)-(\d+)Z/, 'T$1:$2:$3.$4Z'));

async function listSnapshots(): Promise<string[]> {
  try {
    return (await readdir(SNAPSHOT_DIR)).filter(f => f.endsWith('.json')).sort();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

const content = (s: Snapshot) => JSON.stringify({ workItems: s.workItems, events: s.events });

export async function saveSnapshot(snapshot: Snapshot): Promise<void> {
  await mkdir(SNAPSHOT_DIR, { recursive: true });
  const files = await listSnapshots();
  const latest = files.at(-1);
  if (latest) {
    const previous = JSON.parse(await readFile(join(SNAPSHOT_DIR, latest), 'utf8')) as Snapshot;
    if (content(previous) === content(snapshot)) return;
  }
  await writeFile(join(SNAPSHOT_DIR, fileFor(snapshot.syncedAt)), JSON.stringify(snapshot));
  const cutoff = Date.now() - KEEP_DAYS * 86_400_000;
  for (const f of files) if (timeOf(f) < cutoff) await unlink(join(SNAPSHOT_DIR, f));
}

/** The newest snapshot taken at or before `at`, or null when none is that old. */
export async function snapshotAt(at: Date): Promise<Snapshot | null> {
  const files = (await listSnapshots()).filter(f => timeOf(f) <= at.getTime());
  const file = files.at(-1);
  return file ? JSON.parse(await readFile(join(SNAPSHOT_DIR, file), 'utf8')) as Snapshot : null;
}

export const Activity = z.object({
  /** The latest moment the dashboard was open and visible. */
  lastSeenAt: z.string().nullable().default(null),
  sessionStartedAt: z.string().nullable().default(null),
  /** When the session before this one ended. "Since you left" counts from here. */
  previousSessionEndedAt: z.string().nullable().default(null),
  /** When you dismissed the "while you were away" card. */
  acknowledgedAt: z.string().nullable().default(null),
});
export type Activity = z.infer<typeof Activity>;

/** A gap at least this long between pings ends a session. */
export const SESSION_GAP_MS = 30 * 60_000;

export async function loadActivity(): Promise<Activity> {
  try {
    return Activity.parse(JSON.parse(await readFile(ACTIVITY_PATH, 'utf8')));
  } catch {
    return Activity.parse({});
  }
}

export async function saveActivity(activity: Activity): Promise<void> {
  await mkdir('data', { recursive: true });
  await writeFile(`${ACTIVITY_PATH}.tmp`, JSON.stringify(activity, null, 2));
  await rename(`${ACTIVITY_PATH}.tmp`, ACTIVITY_PATH);
}

/** Record a visit. Returns true when this visit starts a new session. */
export function recordSeen(activity: Activity, now: Date): boolean {
  const last = activity.lastSeenAt ? Date.parse(activity.lastSeenAt) : null;
  const isNew = last === null || now.getTime() - last >= SESSION_GAP_MS;
  if (isNew) {
    activity.previousSessionEndedAt = activity.lastSeenAt;
    activity.sessionStartedAt = now.toISOString();
  }
  activity.lastSeenAt = now.toISOString();
  return isNew;
}
