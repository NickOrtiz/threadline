// Your pull requests waiting on reviewers. Waiting is not an action for
// you, so these stay out of focus and "needs you". What matters is how
// long each has waited, so a stale one gets a bump. Working days only.

import type { WorkItem } from '../schema/entities.ts';
import { addDays, isWeekday, localDate } from '../time.ts';

export type ReviewTier = 'fresh' | 'aging' | 'stale';

/** Weekdays after `from` up to and including `to`, both YYYY-MM-DD. */
export function workdaysBetween(from: string, to: string): number {
  let n = 0;
  for (let d = addDays(from, 1); d <= to; d = addDays(d, 1)) if (isWeekday(d)) n++;
  return n;
}

export function deriveReviewQueue(items: WorkItem[], today: string, thresholds: { agingDays: number; staleDays: number }) {
  return items
    .filter(w => w.mine && w.codeReview?.role === 'author' && w.codeReview.state === 'awaiting_review' && w.status !== 'done')
    .map(w => {
      const cr = w.codeReview!;
      const since = cr.waitingSince ?? w.updatedAt;
      const days = workdaysBetween(localDate(new Date(since)), today);
      const tier: ReviewTier = days >= thresholds.staleDays ? 'stale' : days >= thresholds.agingDays ? 'aging' : 'fresh';
      return { id: w.id, ref: cr.ref, number: cr.ref.split('#')[1] ?? '', title: w.title, url: w.source.url, projectId: w.projectId, reviewers: cr.reviewers, waitingSince: since, waitingDays: days, tier, checks: cr.checks };
    })
    .sort((a, b) => b.waitingDays - a.waitingDays);
}
