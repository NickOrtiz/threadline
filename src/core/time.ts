// Date helpers. Sync runs on the user's machine, so "local" means the
// system time zone.

const DAY_MS = 86_400_000;

/** YYYY-MM-DD in local time. */
export function localDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** ISO timestamp with the local UTC offset, e.g. 2026-10-08T09:45:00-06:00. */
export function localIso(d: Date): string {
  const offset = -d.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const abs = Math.abs(offset);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${localDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/** Whole days from date a to date b, both YYYY-MM-DD. Positive when b is later. */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);
}

export function addDays(date: string, n: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/** Local Date at a given HH:MM on a YYYY-MM-DD day. */
export function atTime(date: string, hhmm: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  const [h, min] = hhmm.split(':').map(Number);
  return new Date(y, m - 1, d, h, min);
}

export function isWeekday(date: string): boolean {
  const day = new Date(Date.parse(`${date}T12:00:00Z`)).getUTCDay();
  return day !== 0 && day !== 6;
}

export function formatClock(d: Date): string {
  const h = d.getHours() % 12 || 12;
  const m = d.getMinutes();
  return m ? `${h}:${String(m).padStart(2, '0')}` : `${h}:00`;
}

/** "6:00–6:45 AM", "11:30 AM–1:00 PM". The period shows once unless it changes. */
export function formatTimeRange(start: Date, end: Date): string {
  const period = (d: Date) => (d.getHours() < 12 ? 'AM' : 'PM');
  return period(start) === period(end)
    ? `${formatClock(start)}–${formatClock(end)} ${period(end)}`
    : `${formatClock(start)} ${period(start)}–${formatClock(end)} ${period(end)}`;
}

export function formatLongDate(d: Date): string {
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

export function formatShortDate(date: string): string {
  return new Date(Date.parse(`${date}T12:00:00Z`)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/** "Today", "Tomorrow", "Fri · Oct 9", "2 days overdue". */
export function dueLabel(due: string | null, today: string): string {
  if (!due) return 'No due date';
  const diff = daysBetween(today, due);
  if (diff < 0) return `${-diff} day${diff === -1 ? '' : 's'} overdue`;
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  const weekday = new Date(Date.parse(`${due}T12:00:00Z`)).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
  return `${weekday} · ${formatShortDate(due)}`;
}

export function relativeActivity(iso: string, now: Date): string {
  const d = new Date(iso);
  const diff = daysBetween(localDate(d), localDate(now));
  const clock = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  if (diff === 0) return `Today · ${clock}`;
  if (diff === 1) return `Yesterday · ${clock}`;
  if (diff < 7) return `${d.toLocaleDateString('en-US', { weekday: 'long' })} · ${clock}`;
  return formatShortDate(localDate(d));
}

export function minutesLabel(min: number | null): string {
  if (!min) return '—';
  if (min < 60) return `${min} min`;
  const h = min / 60;
  return `${Number.isInteger(h) ? h : h.toFixed(1)} h`;
}

/** Start of the Monday–Sunday week that contains date. */
export function weekStart(date: string): string {
  const day = new Date(Date.parse(`${date}T12:00:00Z`)).getUTCDay();
  return addDays(date, day === 0 ? -6 : 1 - day);
}
