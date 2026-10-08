// Google Calendar events → Threadline Event. Deterministic only.

import type { Event, Project } from '../../core/schema/entities.ts';
import { localIso } from '../../core/time.ts';
import type { CalendarRecords, GoogleCalendarEvent } from './adapter.ts';

/** Event types that describe where you are, not what you are doing. */
const SKIPPED_TYPES = new Set(['workingLocation', 'birthday']);

export function normalizeCalendarEvent(raw: GoogleCalendarEvent, calendarId: string, projects: Project[], syncedAt: string): Event | null {
  if (raw.status === 'cancelled' || SKIPPED_TYPES.has(raw.eventType ?? '')) return null;

  const self = raw.attendees?.find(a => a.self);
  if (self?.responseStatus === 'declined') return null;

  const allDay = !raw.start.dateTime;
  const startAt = allDay ? localIso(new Date(`${raw.start.date}T00:00:00`)) : localIso(new Date(raw.start.dateTime!));
  const endAt = allDay ? localIso(new Date(`${raw.end.date}T00:00:00`)) : localIso(new Date(raw.end.dateTime!));
  const people = (raw.attendees ?? []).filter(a => !a.resource).length;
  const title = raw.summary?.trim() || '(No title)';

  let kind: Event['kind'];
  if (raw.eventType === 'focusTime') kind = 'focus';
  else if (raw.eventType === 'outOfOffice') kind = 'out_of_office';
  else if (allDay) kind = 'all_day';
  else if (people > 1) kind = 'meeting';
  else kind = 'personal';

  return {
    id: `gcal-${raw.id}`,
    projectId: matchProject(title, projects),
    title,
    kind,
    startAt,
    endAt,
    allDay,
    busy: !allDay && raw.transparency !== 'transparent',
    attendeeCount: people,
    source: { type: 'google-calendar', id: `${calendarId}/${raw.id}`, url: raw.htmlLink ?? null, syncedAt },
  };
}

/** Link an event to a project when the project's short name appears in the title. */
function matchProject(title: string, projects: Project[]): string | null {
  const t = title.toLowerCase().replace(/\s+/g, '');
  const hit = projects.find(p => p.name.length >= 3 && t.includes(p.name.toLowerCase().replace(/\s+/g, '')));
  return hit?.id ?? null;
}

export function normalizeCalendar(records: CalendarRecords[], projects: Project[], syncedAt: string): Event[] {
  const seen = new Set<string>();
  const events: Event[] = [];
  for (const { calendarId, events: raw } of records) {
    for (const r of raw) {
      const e = normalizeCalendarEvent(r, calendarId, projects, syncedAt);
      if (e && !seen.has(e.id)) { seen.add(e.id); events.push(e); }
    }
  }
  return events.sort((a, b) => a.startAt.localeCompare(b.startAt));
}
