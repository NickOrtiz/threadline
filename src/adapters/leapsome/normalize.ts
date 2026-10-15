// Leapsome import file → Threadline Goal. Deterministic.

import type { Goal } from '../../core/schema/entities.ts';
import type { LeapsomeImport } from './schema.ts';

export function normalizeLeapsome(data: LeapsomeImport, syncedAt: string): Goal[] {
  return data.goals.map(g => ({
    id: `leapsome-${g.id}`,
    title: g.name,
    outcome: g.description,
    status: g.status,
    progress: g.progress,
    deadline: g.deadline ? g.deadline.slice(0, 10) : null,
    cycle: g.cycle,
    keyResults: g.keyResults,
    manager: data.manager,
    projectIds: [],
    evidenceIds: [],
    // Leapsome records carry no link, and its goal URLs are unconfirmed, so link to the goals page.
    source: { type: 'leapsome', id: g.id, url: 'https://www.leapsome.com/app/#/goals', syncedAt },
  }));
}
