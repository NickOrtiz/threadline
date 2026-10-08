// Schedule and capacity, derived from calendar events. No AI.

import type { Event } from '../schema/entities.ts';
import type { ScheduleItem } from '../schema/view.ts';
import { addDays, atTime, formatTimeRange, isWeekday, localDate } from '../time.ts';

export interface Workday { start: string; end: string }
interface Interval { start: Date; end: Date }

/** Gaps shorter than this are not real focus time. */
const MIN_FOCUS_WINDOW_MIN = 30;
/** Gaps at least this long show on the timeline as open windows. */
const MIN_VISIBLE_WINDOW_MIN = 45;

const minutes = (i: Interval) => (i.end.getTime() - i.start.getTime()) / 60_000;

function timedEventsOn(events: Event[], date: string): Event[] {
  return events.filter(e => !e.allDay && localDate(new Date(e.startAt)) === date);
}

/** Free intervals inside the workday, after removing busy events. */
export function openWindows(events: Event[], date: string, workday: Workday): Interval[] {
  const dayStart = atTime(date, workday.start);
  const dayEnd = atTime(date, workday.end);
  if (events.some(e => e.kind === 'out_of_office' && overlaps(e, dayStart, dayEnd))) return [];

  const busy = timedEventsOn(events, date)
    .filter(e => e.busy)
    .map(e => ({ start: new Date(e.startAt), end: new Date(e.endAt) }))
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  const free: Interval[] = [];
  let cursor = dayStart;
  for (const b of busy) {
    if (b.end <= cursor) continue;
    if (b.start > cursor) free.push({ start: cursor, end: b.start < dayEnd ? b.start : dayEnd });
    if (b.end > cursor) cursor = b.end;
    if (cursor >= dayEnd) break;
  }
  if (cursor < dayEnd) free.push({ start: cursor, end: dayEnd });
  return free.filter(i => minutes(i) > 0);
}

function overlaps(e: Event, start: Date, end: Date): boolean {
  return new Date(e.startAt) < end && new Date(e.endAt) > start;
}

export interface DayCapacity {
  meetingMinutes: number;
  /** Open windows long enough to do real work, plus explicit focus blocks. */
  focusMinutes: number;
  workdayMinutes: number;
}

export function dayCapacity(events: Event[], date: string, workday: Workday): DayCapacity {
  const timed = timedEventsOn(events, date).filter(e => e.busy);
  const meetingMinutes = timed.filter(e => e.kind === 'meeting').reduce((s, e) => s + minutes({ start: new Date(e.startAt), end: new Date(e.endAt) }), 0);
  const focusBlocks = timed.filter(e => e.kind === 'focus').reduce((s, e) => s + minutes({ start: new Date(e.startAt), end: new Date(e.endAt) }), 0);
  const open = openWindows(events, date, workday).filter(w => minutes(w) >= MIN_FOCUS_WINDOW_MIN).reduce((s, w) => s + minutes(w), 0);
  return {
    meetingMinutes,
    focusMinutes: open + focusBlocks,
    workdayMinutes: minutes({ start: atTime(date, workday.start), end: atTime(date, workday.end) }),
  };
}

/** Focus minutes across the next `days` weekdays, starting today. */
export function focusMinutesAhead(events: Event[], today: string, days: number, workday: Workday): number {
  let total = 0;
  for (let d = 0, counted = 0; counted < days && d < days * 2 + 2; d++) {
    const date = addDays(today, d);
    if (!isWeekday(date)) continue;
    total += dayCapacity(events, date, workday).focusMinutes;
    counted++;
  }
  return total;
}

export function deriveSchedule(
  events: Event[],
  date: string,
  workday: Workday,
  projectName: (id: string | null) => string | null,
  openWindowHint: string | null,
): ScheduleItem[] {
  const items: (ScheduleItem & { sort: number })[] = timedEventsOn(events, date).map(e => {
    const start = new Date(e.startAt);
    const meta = [projectName(e.projectId), e.kind === 'meeting' ? `${e.attendeeCount} people` : null].filter(Boolean).join(' · ');
    return {
      id: e.id,
      time: formatTimeRange(start, new Date(e.endAt)),
      title: e.title,
      meta: meta || (e.kind === 'focus' ? 'Focus time' : 'Calendar'),
      kind: e.kind === 'meeting' ? 'meeting' : e.kind === 'focus' ? 'focus' : 'personal',
      sort: start.getTime(),
    };
  });

  let hinted = false;
  for (const w of openWindows(events, date, workday)) {
    if (minutes(w) < MIN_VISIBLE_WINDOW_MIN) continue;
    items.push({
      id: `open-${w.start.getTime()}`,
      time: formatTimeRange(w.start, w.end),
      title: 'Open focus window',
      meta: !hinted && openWindowHint ? `Best window for ${openWindowHint}` : `${Math.round(minutes(w))} min free`,
      kind: 'open',
      sort: w.start.getTime(),
    });
    hinted = true;
  }
  return items.sort((a, b) => a.sort - b.sort).map(({ sort: _sort, ...rest }) => rest);
}

/** Timed meetings today that overlap each other. */
export function conflicts(events: Event[], date: string): [Event, Event][] {
  const timed = timedEventsOn(events, date).filter(e => e.busy && e.kind === 'meeting');
  const out: [Event, Event][] = [];
  for (let i = 0; i < timed.length; i++)
    for (let j = i + 1; j < timed.length; j++)
      if (overlaps(timed[j], new Date(timed[i].startAt), new Date(timed[i].endAt))) out.push([timed[i], timed[j]]);
  return out;
}
