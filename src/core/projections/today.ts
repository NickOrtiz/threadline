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

/** Busy time that overlaps [start, end), clipped to it. Out-of-office counts as busy. */
function busyIntervals(events: Event[], start: Date, end: Date, only?: (e: Event) => boolean): Interval[] {
  return events
    .filter(e => (only ? only(e) : e.busy || e.kind === 'out_of_office') && overlaps(e, start, end))
    .map(e => ({
      start: new Date(Math.max(Date.parse(e.startAt), start.getTime())),
      end: new Date(Math.min(Date.parse(e.endAt), end.getTime())),
    }))
    .sort((a, b) => a.start.getTime() - b.start.getTime());
}

/** Gaps in [start, end) that no interval covers. */
function gaps(busy: Interval[], start: Date, end: Date): Interval[] {
  const free: Interval[] = [];
  let cursor = start;
  for (const b of busy) {
    if (b.end <= cursor) continue;
    if (b.start > cursor) free.push({ start: cursor, end: b.start < end ? b.start : end });
    cursor = b.end;
    if (cursor >= end) break;
  }
  if (cursor < end) free.push({ start: cursor, end });
  return free.filter(i => minutes(i) > 0);
}

/**
 * Free intervals inside the workday, after removing busy events and
 * out-of-office time. With `from`, only time after that moment counts.
 */
export function openWindows(events: Event[], date: string, workday: Workday, from?: Date): Interval[] {
  const dayStart = atTime(date, workday.start);
  const dayEnd = atTime(date, workday.end);
  const start = from && from > dayStart ? from : dayStart;
  if (start >= dayEnd) return [];
  return gaps(busyIntervals(events, dayStart, dayEnd), start, dayEnd);
}

function overlaps(e: Event, start: Date, end: Date): boolean {
  return new Date(e.startAt) < end && new Date(e.endAt) > start;
}

/** A weekend, or a weekday whose whole workday is out-of-office. */
export function isDayOff(events: Event[], date: string, workday: Workday): boolean {
  if (!isWeekday(date)) return true;
  const dayStart = atTime(date, workday.start);
  const dayEnd = atTime(date, workday.end);
  return gaps(busyIntervals(events, dayStart, dayEnd, e => e.kind === 'out_of_office'), dayStart, dayEnd).length === 0;
}

/** The next day after `date` that is not a day off. */
export function nextWorkday(events: Event[], date: string, workday: Workday): string {
  for (let d = 1; d <= 21; d++) {
    const next = addDays(date, d);
    if (!isDayOff(events, next, workday)) return next;
  }
  return addDays(date, 1);
}

export interface DayCapacity {
  /** All meeting time that day, including meetings already over. */
  meetingMinutes: number;
  /**
   * Open windows long enough to do real work, plus explicit focus blocks.
   * With `from`, only what is left after that moment.
   */
  focusMinutes: number;
  workdayMinutes: number;
}

export function dayCapacity(events: Event[], date: string, workday: Workday, from?: Date): DayCapacity {
  const dayStart = atTime(date, workday.start);
  const dayEnd = atTime(date, workday.end);
  const start = from && from > dayStart ? from : dayStart;
  const timed = timedEventsOn(events, date).filter(e => e.busy);
  const meetingMinutes = timed.filter(e => e.kind === 'meeting').reduce((s, e) => s + minutes({ start: new Date(e.startAt), end: new Date(e.endAt) }), 0);
  const focusBlocks = start >= dayEnd ? 0 : busyIntervals(events, start, dayEnd, e => e.kind === 'focus' && e.busy).reduce((s, i) => s + minutes(i), 0);
  const open = openWindows(events, date, workday, from).filter(w => minutes(w) >= MIN_FOCUS_WINDOW_MIN).reduce((s, w) => s + minutes(w), 0);
  return {
    meetingMinutes,
    focusMinutes: open + focusBlocks,
    workdayMinutes: minutes({ start: dayStart, end: dayEnd }),
  };
}

/** Focus minutes across the next `days` workdays, starting today. Today counts from `from`. */
export function focusMinutesAhead(events: Event[], today: string, days: number, workday: Workday, from?: Date): number {
  let total = 0;
  for (let d = 0, counted = 0; counted < days && d < days * 3 + 3; d++) {
    const date = addDays(today, d);
    if (isDayOff(events, date, workday)) continue;
    total += dayCapacity(events, date, workday, d === 0 ? from : undefined).focusMinutes;
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
