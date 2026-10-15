// What a sync adds to the work journal. Deterministic: each entry comes
// from one source event and keeps its id, so re-running never duplicates.

import type { EntityStore } from '../schema/entities.ts';
import type { Snapshot } from '../../storage/history.ts';
import type { Todo } from '../../storage/todos.ts';
import type { JournalEntry } from '../../storage/journal.ts';
import { localDate } from '../time.ts';

export function deriveJournalEntries(store: EntityStore, previous: Snapshot | null, todos: Todo[], today: string): JournalEntry[] {
  const entries: JournalEntry[] = [];
  const items = new Map(store.workItems.map(w => [w.id, w]));

  // Your comments, completions, and reopenings from the activity log.
  for (const a of store.activities) {
    if (a.kind !== 'comment' && a.kind !== 'completed' && a.kind !== 'reopened') continue;
    entries.push({
      id: a.id, at: a.at, date: localDate(new Date(a.at)), kind: a.kind,
      projectId: a.projectId, workItemId: a.workItemId, title: items.get(a.workItemId ?? '')?.title ?? a.title,
      detail: a.text, url: a.url, source: a.source.type, links: a.links,
    });
  }

  // Stage moves since the previous snapshot, including work you handed off.
  if (previous) {
    const before = new Map(previous.workItems.map(w => [w.id, w]));
    for (const w of store.workItems) {
      const was = before.get(w.id);
      if (!w.stage || !was || was.stage === undefined || was.stage === w.stage) continue;
      entries.push({
        id: `stage-${w.id}-${w.stage}-${today}`, at: store.syncedAt, date: today, kind: 'stage',
        projectId: w.projectId, workItemId: w.id, title: w.title,
        detail: was.stage ? `${was.stage} → ${w.stage}` : w.stage, url: w.source.url, source: w.source.type, links: [],
      });
    }
  }

  // Your pull requests, once merged.
  for (const w of store.workItems) {
    if (w.codeReview?.role !== 'author' || w.codeReview.state !== 'merged' || !w.completedAt) continue;
    entries.push({
      id: `merged-${w.id}`, at: w.completedAt, date: localDate(new Date(w.completedAt)), kind: 'merged',
      projectId: w.projectId, workItemId: w.id, title: w.title, detail: w.codeReview.ref, url: w.source.url, source: 'github', links: w.source.url ? [w.source.url] : [],
    });
  }

  // Your own to-dos, once done.
  for (const t of todos) {
    if (t.status !== 'done' || !t.completedAt) continue;
    entries.push({
      id: `todo-${t.id}`, at: t.completedAt, date: localDate(new Date(t.completedAt)), kind: 'todo_done',
      projectId: t.projectId, workItemId: `todo-${t.id}`, title: t.title, detail: null, url: null, source: 'manual', links: [],
    });
  }

  // Hours per project per day, for finished days only, so a partial day is never frozen.
  const hours = new Map<string, { date: string; projectId: string | null; minutes: number }>();
  for (const t of store.timeLogs) {
    if (t.date >= today) continue;
    const key = `${t.date}|${t.projectId ?? 'none'}`;
    const h = hours.get(key) ?? { date: t.date, projectId: t.projectId, minutes: 0 };
    h.minutes += t.minutes;
    hours.set(key, h);
  }
  const projectName = new Map(store.projects.map(p => [p.id, p.name]));
  for (const h of hours.values()) {
    entries.push({
      id: `time-${h.date}-${h.projectId ?? 'none'}`, at: `${h.date}T23:59:00`, date: h.date, kind: 'time',
      projectId: h.projectId, workItemId: null, title: h.projectId ? projectName.get(h.projectId) ?? h.projectId : 'Other',
      detail: `${Math.round(h.minutes / 6) / 10} h`, url: null, source: 'teamwork', links: [],
    });
  }
  return entries;
}
