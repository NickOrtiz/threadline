// User-owned memory: threads, goals, knowledge, review evidence, and
// per-project context (role, decisions, learnings).
//
// No external source knows these things yet, so they live in a local file
// with source type "manual". Phase 5 and 7 will start deriving them.
//
// v0.1 shortcut: these are stored in view shape. They should move to the
// entity shapes in core/schema/entities.ts once something writes them.

import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { GoalView, KnowledgeView, ProjectView, ReviewView, ThreadView } from '../core/schema/view.ts';

export const MEMORY_PATH = 'memory/threadline-memory.json';

export const ProjectMemory = ProjectView.pick({
  role: true, objective: true, goals: true, accomplishments: true, decisions: true, learnings: true, weekly: true,
}).partial();
export type ProjectMemory = z.infer<typeof ProjectMemory>;

export const Memory = z.object({
  projects: z.record(z.string(), ProjectMemory).default({}),
  threads: z.array(ThreadView).default([]),
  goals: z.array(GoalView).default([]),
  knowledge: z.array(KnowledgeView).default([]),
  review: ReviewView.nullable().default(null),
});
export type Memory = z.infer<typeof Memory>;

export async function loadMemory(path = MEMORY_PATH): Promise<Memory> {
  try {
    return Memory.parse(JSON.parse(await readFile(path, 'utf8')));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return Memory.parse({});
    throw err;
  }
}
