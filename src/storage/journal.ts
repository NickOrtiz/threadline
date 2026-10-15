// The work journal: a permanent, append-only record of what you did.
//
// Sources keep only recent history (7 days of activity, 30 days of
// completions). The journal keeps it all, one JSON line per entry, in
// memory/journal/YYYY-MM.jsonl. Every entry links back to its source.
// Entries are never edited or removed. Knowledge, reflections, and goal
// evidence are built on top of this record.

import { appendFile, mkdir, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';

export const JOURNAL_DIR = 'memory/journal';

export const JournalEntry = z.object({
  /** Stable id from the source event, so an entry is written once. */
  id: z.string(),
  at: z.string(),
  /** Local date the work counts for. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  kind: z.enum(['completed', 'reopened', 'stage', 'comment', 'todo_done', 'time', 'merged']),
  projectId: z.string().nullable(),
  workItemId: z.string().nullable(),
  title: z.string(),
  /** A comment excerpt, the new stage, or hours logged. */
  detail: z.string().nullable(),
  url: z.string().nullable(),
  source: z.string(),
  /** Links found in the source event, such as pull request URLs. */
  links: z.array(z.string()).default([]),
});
export type JournalEntry = z.infer<typeof JournalEntry>;

const fileFor = (date: string) => join(JOURNAL_DIR, `${date.slice(0, 7)}.jsonl`);

async function files(): Promise<string[]> {
  try {
    return (await readdir(JOURNAL_DIR)).filter(f => f.endsWith('.jsonl')).sort();
  } catch {
    return [];
  }
}

async function readFileEntries(file: string): Promise<JournalEntry[]> {
  const text = await readFile(join(JOURNAL_DIR, file), 'utf8').catch(() => '');
  return text.split('\n').filter(Boolean).flatMap(line => {
    const parsed = JournalEntry.safeParse(JSON.parse(line));
    return parsed.success ? [parsed.data] : [];
  });
}

/** Entries on or after `since` (YYYY-MM-DD), oldest first. */
export async function readJournal(since: string): Promise<JournalEntry[]> {
  const wanted = (await files()).filter(f => f.slice(0, 7) >= since.slice(0, 7));
  const all = (await Promise.all(wanted.map(readFileEntries))).flat();
  return all.filter(e => e.date >= since).sort((a, b) => a.at.localeCompare(b.at));
}

/** Append entries whose ids are not already in their month's file. Returns how many were new. */
export async function appendJournal(entries: JournalEntry[]): Promise<number> {
  if (!entries.length) return 0;
  await mkdir(JOURNAL_DIR, { recursive: true });
  const byFile = new Map<string, JournalEntry[]>();
  for (const e of entries) byFile.set(fileFor(e.date), [...(byFile.get(fileFor(e.date)) ?? []), e]);

  let added = 0;
  for (const [file, list] of byFile) {
    const existing = new Set((await readFileEntries(file.split('/').pop()!)).map(e => e.id));
    const fresh = list.filter(e => !existing.has(e.id) && existing.add(e.id));
    if (fresh.length) await appendFile(file, fresh.map(e => JSON.stringify(e)).join('\n') + '\n');
    added += fresh.length;
  }
  return added;
}
