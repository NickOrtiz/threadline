// Deterministic ranking of open work. This is where "what should I do next"
// lives until AI enrichment adds judgment on top.

import type { WorkItem } from '../schema/entities.ts';
import { daysBetween } from '../time.ts';

/** Past this many days overdue, a due date is more likely stale than real. */
export const STALE_AFTER_DAYS = 7;

export interface RankedItem {
  item: WorkItem;
  score: number;
  /** Negative when overdue. Null when there is no due date. */
  daysUntilDue: number | null;
  stale: boolean;
}

/** Optional per-project adjustment, such as booking pace. Small, so due dates still lead. */
export type ProjectBoost = (projectId: string | null) => number;

export function rankWorkItems(items: WorkItem[], today: string, boost: ProjectBoost = () => 0): RankedItem[] {
  const open = items.filter(w => w.mine && w.status !== 'done');
  // A parent task is a container. Rank its open subtasks instead.
  const parentsWithOpenChildren = new Set(open.map(w => w.parentId).filter(Boolean));

  return open
    .filter(w => !parentsWithOpenChildren.has(w.id))
    .map(item => {
      const daysUntilDue = item.dueAt ? daysBetween(today, item.dueAt) : null;
      const stale = (daysUntilDue !== null && daysUntilDue < -STALE_AFTER_DAYS) || abandonedReview(item, today);
      return { item, daysUntilDue, stale, score: stale ? 0 : score(item, daysUntilDue, today) + boost(item.projectId) };
    })
    .sort((a, b) => b.score - a.score || (a.item.dueAt ?? '9999').localeCompare(b.item.dueAt ?? '9999'));
}

/** A PR or review with no activity for a month is abandoned, not pending. */
const ABANDONED_REVIEW_DAYS = 30;
function abandonedReview(item: WorkItem, today: string): boolean {
  return item.codeReview !== null && daysBetween(item.updatedAt.slice(0, 10), today) > ABANDONED_REVIEW_DAYS;
}

/**
 * Work with no due date. Code review has its own urgency: a review request
 * blocks a teammate, and a PR with requested changes blocks your own work.
 */
function undatedScore(item: WorkItem): number {
  const cr = item.codeReview;
  if (!cr) return 20;
  if (cr.role === 'reviewer') return 75;
  if (cr.checks === 'failing' || cr.state === 'changes_requested') return 70;
  if (cr.state === 'approved') return 60;
  if (cr.state === 'draft') return 30;
  return 20;
}

function score(item: WorkItem, daysUntilDue: number | null, today: string): number {
  let s: number;
  if (daysUntilDue === null) s = undatedScore(item);
  else if (daysUntilDue < 0) s = 100 + daysUntilDue * 2; // recently overdue
  else if (daysUntilDue === 0) s = 92;
  else if (daysUntilDue === 1) s = 82;
  else if (daysUntilDue <= 7) s = 72 - daysUntilDue * 3;
  else s = 40 - Math.min(daysUntilDue, 30) / 2;

  if (item.priority === 'urgent') s += 25;
  else if (item.priority === 'high') s += 15;
  else if (item.priority === 'low') s -= 10;
  if (item.status === 'in_progress') s += 10;
  if (item.startAt && item.startAt > today) s -= 25; // not started yet on purpose
  if (item.status === 'blocked' || item.status === 'waiting') s -= 40;
  return s;
}
