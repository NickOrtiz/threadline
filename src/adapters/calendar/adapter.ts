// Google Calendar adapter: fetch only.
// Docs: https://developers.google.com/calendar/api/v3/reference/events/list

import { readFile } from 'node:fs/promises';

export const TOKEN_PATH = '.threadline/google-token.json';

/** The subset of a Calendar API event that Threadline reads. */
export interface GoogleCalendarEvent {
  id: string;
  status: string; // "confirmed" | "tentative" | "cancelled"
  summary?: string;
  htmlLink?: string;
  eventType?: string; // "default" | "focusTime" | "outOfOffice" | "workingLocation" | ...
  transparency?: string; // "opaque" | "transparent"
  start: { dateTime?: string; date?: string };
  end: { dateTime?: string; date?: string };
  attendees?: { self?: boolean; responseStatus?: string; resource?: boolean }[];
}

export interface CalendarRecords {
  calendarId: string;
  events: GoogleCalendarEvent[];
}

export interface CalendarAdapterOptions {
  clientId: string;
  clientSecret: string;
  calendarIds: string[];
  timeMin: Date;
  timeMax: Date;
}

export class GoogleCalendarAdapter {
  private readonly opts: CalendarAdapterOptions;
  constructor(opts: CalendarAdapterOptions) {
    this.opts = opts;
  }

  async sync(): Promise<CalendarRecords[]> {
    const accessToken = await this.accessToken();
    const out: CalendarRecords[] = [];
    for (const calendarId of this.opts.calendarIds) {
      const events: GoogleCalendarEvent[] = [];
      let pageToken: string | undefined;
      do {
        const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`);
        url.search = new URLSearchParams({
          timeMin: this.opts.timeMin.toISOString(),
          timeMax: this.opts.timeMax.toISOString(),
          singleEvents: 'true',
          orderBy: 'startTime',
          maxResults: '250',
          ...(pageToken ? { pageToken } : {}),
        }).toString();
        const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
        if (!res.ok) throw new Error(`Google Calendar ${res.status}: ${(await res.text()).slice(0, 200)}`);
        const body = await res.json() as { items: GoogleCalendarEvent[]; nextPageToken?: string };
        events.push(...body.items);
        pageToken = body.nextPageToken;
      } while (pageToken);
      out.push({ calendarId, events });
    }
    return out;
  }

  private async accessToken(): Promise<string> {
    let stored: { refresh_token: string };
    try {
      stored = JSON.parse(await readFile(TOKEN_PATH, 'utf8'));
    } catch {
      throw new Error('Not signed in to Google. Run npm run auth:google.');
    }
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.opts.clientId,
        client_secret: this.opts.clientSecret,
        refresh_token: stored.refresh_token,
        grant_type: 'refresh_token',
      }),
    });
    const body = await res.json() as { access_token?: string; error?: string };
    if (!body.access_token) throw new Error(`Google token refresh failed: ${body.error}. Run npm run auth:google again.`);
    return body.access_token;
  }
}
