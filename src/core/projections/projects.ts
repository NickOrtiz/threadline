// Project pulse and weekly synthesis, derived from the user's own work items.
// Remembered context (role, decisions, learnings) merges in from memory.

import type { Project, WorkItem } from '../schema/entities.ts';
import type { ProjectView } from '../schema/view.ts';
import type { ProjectMemory } from '../../storage/memory.ts';
import { addDays, dueLabel, formatShortDate, localDate, weekStart } from '../time.ts';
import type { RankedItem } from './workload.ts';
import type { ProjectWeek } from './budget.ts';

const BOOKING_LABEL = { behind: 'Behind pace', on_pace: 'Healthy', done: 'Healthy', over: 'Over booking' } as const;

export function deriveProjects(
  projects: Project[],
  workItems: WorkItem[],
  ranked: RankedItem[],
  memory: Record<string, ProjectMemory>,
  today: string,
  week: Map<string, ProjectWeek> = new Map(),
): ProjectView[] {
  const monday = weekStart(today);

  return projects
    .map(p => {
      const mine = workItems.filter(w => w.mine && w.projectId === p.id);
      const done = mine.filter(w => w.status === 'done');
      const open = ranked.filter(r => r.item.projectId === p.id);
      const active = open.filter(r => !r.stale);
      const overdue = active.filter(r => (r.daysUntilDue ?? 0) < 0);
      const stale = open.filter(r => r.stale);
      const nextDue = active.filter(r => r.item.dueAt).sort((a, b) => a.item.dueAt!.localeCompare(b.item.dueAt!))[0];
      const doneThisWeek = done.filter(w => w.completedAt && localDate(new Date(w.completedAt)) >= monday);
      const total = done.length + open.length;
      const m = memory[p.id] ?? {};

      const schedule = overdue.length ? 'At risk' : stale.length ? 'Watch' : 'Healthy';
      const view: ProjectView & { sortKey: string } = {
        id: p.id,
        name: p.name,
        description: p.client ?? p.description,
        status: overdue.length ? 'At risk' : stale.length ? 'Watch' : 'On track',
        progress: total ? Math.round((done.length / total) * 100) : 0,
        due: p.endAt ? formatShortDate(p.endAt) : 'Open',
        role: m.role ?? 'Not recorded yet',
        objective: m.objective ?? p.description,
        nextMilestone: nextDue ? `${nextDue.item.title} · ${dueLabel(nextDue.item.dueAt, today)}` : 'Nothing scheduled',
        sourceUrl: p.source.url,
        health: { schedule, ...(week.get(p.id) ? { booking: BOOKING_LABEL[week.get(p.id)!.status] } : {}) },
        week: week.get(p.id) ? {
          booked: week.get(p.id)!.booked, logged: week.get(p.id)!.logged, remaining: week.get(p.id)!.remaining,
          status: week.get(p.id)!.status, manager: week.get(p.id)!.manager,
        } : undefined,
        goals: m.goals ?? [],
        accomplishments: m.accomplishments ?? [],
        decisions: m.decisions ?? [],
        learnings: m.learnings ?? [],
        weekly: m.weekly ?? {
          period: `${formatShortDate(monday)}–${formatShortDate(addDays(monday, 4))}`,
          summary: `You completed ${doneThisWeek.length} task${doneThisWeek.length === 1 ? '' : 's'} here this week. ${active.length} remain active` +
            (stale.length ? `, and ${stale.length} have outdated due dates.` : '.'),
          wins: doneThisWeek.slice(0, 5).map(w => w.title),
          risks: [
            ...overdue.slice(0, 3).map(r => `${r.item.title} is ${dueLabel(r.item.dueAt, today)}`),
            ...(stale.length ? [`${stale.length} task${stale.length === 1 ? '' : 's'} need new due dates`] : []),
          ],
          next: active.slice(0, 3).map(r => r.item.title),
        },
        sortKey: nextDue?.item.dueAt ?? '9999',
      };
      return view;
    })
    .sort((a, b) => a.sortKey.localeCompare(b.sortKey))
    .map(({ sortKey: _sortKey, ...rest }) => rest);
}
