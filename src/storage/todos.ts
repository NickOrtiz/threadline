// Your own to-dos: work with no ticket, such as local setup or updates.
//
// Stored in memory/todos.json (git-ignored). The server is the only writer
// while `npm start` runs. The sync turns each to-do into a WorkItem with
// source type "manual", so it ranks and raises signals like any other work.

import { readFile, rename, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';

export const TODOS_PATH = 'memory/todos.json';

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const Todo = z.object({
  id: z.string(),
  title: z.string().trim().min(1, 'Add a title.').max(200, 'Keep the title under 200 characters.'),
  projectId: z.string().nullable().default(null),
  dueAt: IsoDate.nullable().default(null),
  estimatedMinutes: z.number().int().positive().max(24 * 60).nullable().default(null),
  status: z.enum(['open', 'done']).default('open'),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
  completedAt: z.string().datetime({ offset: true }).nullable().default(null),
});
export type Todo = z.infer<typeof Todo>;

export const TodoFile = z.object({ todos: z.array(Todo).default([]) });

/** The fields a person can set when adding a to-do. Missing fields default to null. */
export const TodoInput = Todo.pick({ title: true, projectId: true, dueAt: true, estimatedMinutes: true });

/**
 * An edit. Built without defaults on purpose: a field left out must stay
 * unchanged, not reset to null.
 */
export const TodoPatch = z.object({
  title: Todo.shape.title,
  projectId: z.string().nullable(),
  dueAt: IsoDate.nullable(),
  estimatedMinutes: z.number().int().positive().max(24 * 60).nullable(),
  status: z.enum(['open', 'done']),
}).partial();

export async function loadTodos(path = TODOS_PATH): Promise<Todo[]> {
  try {
    return TodoFile.parse(JSON.parse(await readFile(path, 'utf8'))).todos;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

/** Write to a temp file, then rename, so a crash never leaves half a file. */
export async function saveTodos(todos: Todo[], path = TODOS_PATH): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify({ todos }, null, 2) + '\n');
  await rename(tmp, path);
}
