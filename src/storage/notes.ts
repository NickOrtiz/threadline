// Your working notes on threads. Local to Threadline; never sent to a source.
// Stored in memory/notes.json (git-ignored), keyed by thread id.

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';

export const NOTES_PATH = 'memory/notes.json';

export const ThreadNote = z.object({
  id: z.string(),
  at: z.string(),
  body: z.string().trim().min(1, 'Write something first.').max(4000),
});
export type ThreadNote = z.infer<typeof ThreadNote>;

export const NotesFile = z.record(z.string(), z.array(ThreadNote));

export async function loadNotes(path = NOTES_PATH): Promise<Record<string, ThreadNote[]>> {
  try {
    return NotesFile.parse(JSON.parse(await readFile(path, 'utf8')));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw err;
  }
}

export async function saveNotes(notes: Record<string, ThreadNote[]>, path = NOTES_PATH): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(`${path}.tmp`, JSON.stringify(notes, null, 2) + '\n');
  await rename(`${path}.tmp`, path);
}
