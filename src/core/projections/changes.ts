// "What changed since you left": compare the snapshot from when you left
// with the current one. Deterministic. Every line traces to a record.

import type { Snapshot } from '../../storage/history.ts';
import { formatShortDate } from '../time.ts';

export interface Change {
  id: string;
  projectId: string | null;
  kind: 'added' | 'completed' | 'removed' | 'due_moved' | 'review' | 'updated' | 'meeting_added' | 'meeting_moved' | 'meeting_cancelled';
  text: string;
  url: string | null;
}

const REVIEW_TEXT: Record<string, string> = {
  approved: 'approved', changes_requested: 'changes requested', awaiting_review: 'waiting for review', draft: 'back to draft',
};

const when = (iso: string) => new Date(iso).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' });

export function diffSnapshots(before: Snapshot, after: Snapshot, now: Date): Change[] {
  const changes: Change[] = [];
  const old = new Map(before.workItems.map(w => [w.id, w]));
  const current = new Map(after.workItems.map(w => [w.id, w]));
  const quietUpdates = new Map<string | null, number>();

  for (const w of after.workItems) {
    const was = old.get(w.id);
    const base = { projectId: w.projectId, url: w.url };
    if (!was) {
      if (w.status === 'done') continue;
      const text = w.kind === 'review' ? `Review requested: ${w.title.replace(/^Review: /, '')}` : w.kind === 'pull_request' ? `New PR: ${w.title}` : `New: ${w.title}`;
      changes.push({ ...base, id: `add-${w.id}`, kind: 'added', text });
      continue;
    }
    let noted = false;
    if (w.status === 'done' && was.status !== 'done') { changes.push({ ...base, id: `done-${w.id}`, kind: 'completed', text: `Completed: ${w.title}` }); noted = true; }
    if (w.dueAt !== was.dueAt && w.status !== 'done') {
      const from = was.dueAt ? formatShortDate(was.dueAt) : 'no date';
      const to = w.dueAt ? formatShortDate(w.dueAt) : 'no date';
      changes.push({ ...base, id: `due-${w.id}`, kind: 'due_moved', text: `Due date moved: ${w.title} (${from} → ${to})` });
      noted = true;
    }
    if (w.review && w.review !== was.review) { changes.push({ ...base, id: `rev-${w.id}`, kind: 'review', text: `${w.title}: ${REVIEW_TEXT[w.review] ?? w.review}` }); noted = true; }
    if (w.checks === 'failing' && was.checks !== 'failing') { changes.push({ ...base, id: `chk-${w.id}`, kind: 'review', text: `${w.title}: checks failing` }); noted = true; }
    if (!noted && w.updatedAt !== was.updatedAt) quietUpdates.set(w.projectId, (quietUpdates.get(w.projectId) ?? 0) + 1);
  }

  for (const w of before.workItems) {
    if (current.has(w.id) || w.status === 'done') continue;
    changes.push({ id: `rm-${w.id}`, projectId: w.projectId, kind: 'removed', text: `No longer on your list: ${w.title}`, url: w.url });
  }

  for (const [projectId, n] of quietUpdates) {
    changes.push({ id: `upd-${projectId ?? 'none'}`, projectId, kind: 'updated', text: `${n} other item${n === 1 ? ' was' : 's were'} updated`, url: null });
  }

  // Calendar: only meetings still ahead of you matter.
  const ahead = (e: { startAt: string }) => Date.parse(e.startAt) > now.getTime();
  const oldEvents = new Map(before.events.map(e => [e.id, e]));
  const newEvents = new Map(after.events.map(e => [e.id, e]));
  for (const e of after.events.filter(ahead)) {
    const was = oldEvents.get(e.id);
    if (!was) changes.push({ id: `mtg-add-${e.id}`, projectId: null, kind: 'meeting_added', text: `New on your calendar: ${e.title} · ${when(e.startAt)}`, url: e.url });
    else if (was.startAt !== e.startAt) changes.push({ id: `mtg-mv-${e.id}`, projectId: null, kind: 'meeting_moved', text: `Moved: ${e.title} → ${when(e.startAt)}`, url: e.url });
  }
  for (const e of before.events.filter(ahead)) {
    if (!newEvents.has(e.id)) changes.push({ id: `mtg-rm-${e.id}`, projectId: null, kind: 'meeting_cancelled', text: `Removed from your calendar: ${e.title} · ${when(e.startAt)}`, url: e.url });
  }

  return changes;
}
