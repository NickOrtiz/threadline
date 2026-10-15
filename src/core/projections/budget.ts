// This week's booked time per project against the time you logged.
// Deterministic: allocations × working days, minus time logs.

import type { Allocation, Leave, TimeLog } from '../schema/entities.ts';
import { addDays, atTime, weekStart } from '../time.ts';

export interface ProjectWeek {
  projectId: string;
  name: string;
  manager: string | null;
  booked: number;
  logged: number;
  remaining: number;
  /** Working days left this week, today included while the workday is not over. */
  daysLeft: number;
  status: 'behind' | 'on_pace' | 'done' | 'over';
}

export interface WeekBudget {
  projects: ProjectWeek[];
  booked: number;
  /** Your working hours this week, after days off. */
  available: number;
}

/** Below this many hours behind the expected pace, a project counts as on pace. */
const PACE_TOLERANCE_H = 2;

const round = (n: number) => Math.round(n * 10) / 10;

export function deriveWeek(input: {
  allocations: Allocation[];
  timeLogs: TimeLog[];
  isDayOff: (date: string) => boolean;
  today: string;
  now: Date;
  workday: { start: string; end: string };
  projectName: (id: string) => string;
}): WeekBudget | null {
  const { allocations, today, now, workday } = input;
  if (!allocations.length) return null;

  const monday = weekStart(today);
  const days = Array.from({ length: 5 }, (_, i) => addDays(monday, i)).filter(d => !input.isDayOff(d));
  const dayStart = atTime(today, workday.start).getTime();
  const dayEnd = atTime(today, workday.end).getTime();
  const workdayHours = (dayEnd - dayStart) / 3_600_000;

  // How much of the week's working time has passed: whole earlier days plus the part of today.
  const todayFraction = days.includes(today) ? Math.min(1, Math.max(0, (now.getTime() - dayStart) / (dayEnd - dayStart))) : 0;
  const elapsed = days.filter(d => d < today).length + todayFraction;
  const daysLeft = days.filter(d => d > today).length + (days.includes(today) && now.getTime() < dayEnd ? 1 : 0);

  const booked = new Map<string, { hours: number; manager: string | null }>();
  for (const a of allocations) {
    if (!a.projectId) continue;
    const hours = days.filter(d => d >= a.startAt && d <= a.endAt).length * a.hoursPerDay;
    if (!hours) continue;
    const entry = booked.get(a.projectId) ?? { hours: 0, manager: a.manager };
    entry.hours += hours;
    booked.set(a.projectId, entry);
  }

  const logged = new Map<string, number>();
  for (const t of input.timeLogs) {
    if (!t.projectId || t.date < monday || t.date > today) continue;
    logged.set(t.projectId, (logged.get(t.projectId) ?? 0) + t.minutes / 60);
  }

  const projects = [...booked.entries()].map(([projectId, b]): ProjectWeek => {
    const done = logged.get(projectId) ?? 0;
    const expected = days.length ? b.hours * (elapsed / days.length) : 0;
    const status = done > b.hours + 1 ? 'over'
      : done >= b.hours - 0.25 ? 'done'
      : expected - done >= Math.max(PACE_TOLERANCE_H, b.hours * 0.25) ? 'behind'
      : 'on_pace';
    return {
      projectId, name: input.projectName(projectId), manager: b.manager,
      booked: round(b.hours), logged: round(done), remaining: round(Math.max(0, b.hours - done)), daysLeft, status,
    };
  }).sort((a, b) => b.remaining - a.remaining);

  return {
    projects,
    booked: round(projects.reduce((s, p) => s + p.booked, 0)),
    available: round(days.length * workdayHours),
  };
}

/** Leave as all-day out-of-office events, so day-off logic covers it. */
export function leaveAsEvents(leave: Leave[]) {
  const events = [];
  for (const l of leave) {
    for (let d = l.startAt; d <= l.endAt; d = addDays(d, 1)) {
      events.push({
        id: `${l.id}-${d}`, projectId: null, title: l.kind, kind: 'out_of_office' as const,
        startAt: atTime(d, '00:00').toISOString(), endAt: atTime(addDays(d, 1), '00:00').toISOString(),
        allDay: true, busy: false, attendeeCount: 0, source: l.source,
      });
    }
  }
  return events;
}
