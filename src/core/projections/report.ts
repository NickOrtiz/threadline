// Daily status reports: what you moved, per project, per day, ready to
// paste into Slack. Built from your activity log, the current board stage,
// and snapshots. Deterministic: every line traces to a record.

import type { Activity, Project, WorkItem } from '../schema/entities.ts';
import type { Todo } from '../../storage/todos.ts';
import type { RankedItem } from './workload.ts';
import { addDays, localDate } from '../time.ts';

/** Stage per work item id at a moment, from a snapshot. Null when no snapshot is that old. */
export type StageMap = Map<string, string | null> | null;

export interface DayStages { start: StageMap; end: StageMap }

export interface ReportLine { workItemId: string | null; title: string; detail: string; url: string | null }
export interface ProjectReport { projectId: string | null; name: string; lines: ReportLine[]; next: string[]; waiting: string[]; text: string }
export interface DayReport { date: string; label: string; projects: ProjectReport[]; text: string }

export interface ReportInput {
  today: string;
  days: number;
  activities: Activity[];
  workItems: WorkItem[];
  ranked: RankedItem[];
  projects: Project[];
  todos: Todo[];
  /** Stages at the start and end of each date, from snapshots. */
  stagesByDate: Map<string, DayStages>;
}

const longDate = (date: string) => new Date(Date.parse(`${date}T12:00:00Z`)).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' });

export function deriveReports(input: ReportInput): DayReport[] {
  const items = new Map(input.workItems.map(w => [w.id, w]));
  const projectNames = new Map(input.projects.map(p => [p.id, p.name]));
  const reports: DayReport[] = [];

  for (let d = 0; d < input.days; d++) {
    const date = addDays(input.today, -d);
    const isToday = d === 0;
    const label = isToday ? 'Today' : d === 1 ? 'Yesterday' : longDate(date);
    const stages = input.stagesByDate.get(date) ?? { start: null, end: null };

    // Group the day's activity by work item, in the order you touched them.
    const touched = new Map<string, { projectId: string | null; title: string; url: string | null; acts: Activity[] }>();
    for (const a of input.activities.filter(a => localDate(new Date(a.at)) === date).sort((x, y) => x.at.localeCompare(y.at))) {
      const key = a.workItemId ?? a.id;
      if (!touched.has(key)) touched.set(key, { projectId: a.projectId, title: items.get(key)?.title ?? a.title, url: a.url, acts: [] });
      touched.get(key)!.acts.push(a);
    }

    const lines = new Map<string | null, ReportLine[]>();
    const add = (projectId: string | null, line: ReportLine) => lines.set(projectId, [...(lines.get(projectId) ?? []), line]);

    for (const [id, t] of touched) {
      const item = items.get(id);
      const done = t.acts.some(a => a.kind === 'completed') && !t.acts.some(a => a.kind === 'reopened' && a.at > t.acts.find(x => x.kind === 'completed')!.at);
      const from = stages.start?.get(id) ?? null;
      const to = isToday ? item?.stage ?? null : stages.end?.get(id) ?? null;
      const notes = [...new Set(t.acts.filter(a => a.kind === 'comment' && a.text).map(a => a.text!))].slice(0, 2);

      let state = '';
      if (done || (isToday && item?.status === 'done' && t.acts.some(a => a.kind !== 'comment'))) state = 'Done';
      else if (from && to && from !== to) state = `${from} → ${to}`;
      else if (to) state = to;
      else if (t.acts.every(a => a.kind === 'created')) state = 'Created';

      const detail = [state, notes.join('; ')].filter(Boolean).join('. ');
      add(t.projectId ?? item?.projectId ?? null, { workItemId: item ? id : null, title: t.title, detail, url: t.url });
    }

    // Your own to-dos finished that day.
    for (const todo of input.todos.filter(x => x.status === 'done' && x.completedAt && localDate(new Date(x.completedAt)) === date)) {
      add(todo.projectId, { workItemId: `todo-${todo.id}`, title: todo.title, detail: 'Done', url: null });
    }

    const projects: ProjectReport[] = [...lines.entries()].map(([projectId, projectLines]) => {
      const listed = new Set(projectLines.map(l => l.workItemId));
      const inProject = (r: RankedItem) => r.item.projectId === projectId && !listed.has(r.item.id) && !r.stale;
      const next = isToday ? input.ranked.filter(r => inProject(r) && r.item.status !== 'waiting' && r.item.status !== 'blocked').slice(0, 3).map(r => r.item.title) : [];
      // Waiting on others: your waiting or blocked work, plus work you handed off that is not done.
      const listedTitles = new Set(projectLines.map(l => l.title.toLowerCase()));
      const waitingItems = isToday ? [
        ...input.ranked.filter(r => inProject(r) && (r.item.status === 'waiting' || r.item.status === 'blocked')).map(r => r.item),
        ...input.workItems.filter(w => !w.mine && w.projectId === projectId && w.status !== 'done' && !listed.has(w.id)),
      ] : [];
      const waiting = [...new Set(waitingItems
        .filter(w => !listedTitles.has(w.title.toLowerCase())) // a PR named like a listed task
        .map(w => w.stage ? `${w.title} (${w.stage})` : w.codeReview ? `${w.title} (${w.codeReview.ref})` : w.title))];
      const name = projectId ? projectNames.get(projectId) ?? projectId : 'Other';
      // Done first, then the order you worked in.
      const ordered = [...projectLines.filter(l => l.detail.startsWith('Done')), ...projectLines.filter(l => !l.detail.startsWith('Done'))];
      return { projectId, name, lines: ordered, next, waiting, text: '' };
    }).sort((a, b) => b.lines.length - a.lines.length || a.name.localeCompare(b.name));

    for (const p of projects) p.text = projectText(p, `${p.name}* · ${longDate(date)}`);
    const text = projects.length
      ? [`*Status · ${longDate(date)}*`, ...projects.map(p => projectText(p, `${p.name}*`))].join('\n\n')
      : '';

    if (isToday || projects.length) reports.push({ date, label, projects, text });
  }
  return reports;
}

/** Slack formatting: *bold*, _italic_, • bullets. */
function projectText(p: ProjectReport, heading: string): string {
  const out = [`*${heading}`];
  for (const l of p.lines) out.push(`• *${l.title}*${l.detail ? ` — ${l.detail}` : ''}`);
  if (p.next.length) out.push(`_Next:_ ${p.next.join(' · ')}`);
  if (p.waiting.length) out.push(`_Waiting on others:_ ${p.waiting.join(' · ')}`);
  return out.join('\n');
}
