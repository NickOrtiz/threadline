// Attention signals from deterministic rules.
//
// The rules are conservative about NOW. Most things land in NEXT or WATCH,
// and stale work is grouped per project so it does not flood the page.

import type { Event, Project, Signal } from '../schema/entities.ts';
import type { AttentionItem } from '../schema/view.ts';
import { daysBetween, dueLabel, formatClock, localDate, minutesLabel } from '../time.ts';
import type { RankedItem } from './workload.ts';
import { conflicts } from './today.ts';

const MAX_NOW = 3;

export interface SignalContext {
  ranked: RankedItem[];
  events: Event[];
  hasCalendar: boolean;
  today: string;
  generatedAt: string;
  /** Focus minutes available over the next 5 weekdays. */
  focusMinutesAhead: number;
}

export function deriveSignals(ctx: SignalContext): Signal[] {
  const signals: Signal[] = [];
  const rule = (name: string, confidence = 1) => ({ generatedBy: `rule:${name}`, generatedAt: ctx.generatedAt, confidence });

  for (const r of ctx.ranked) {
    const { item, daysUntilDue: d } = r;
    if (r.stale || d === null || d > 0 || item.status === 'waiting') continue;
    const urgent = item.priority === 'high' || item.priority === 'urgent';
    if (d < 0) {
      signals.push({
        id: `sig-overdue-${item.id}`, type: 'overdue', level: urgent ? 'now' : 'next',
        subject: { kind: 'workItem', id: item.id }, projectId: item.projectId,
        title: item.title,
        detail: item.group ? `In ${item.group}.` : 'Open task past its due date.',
        why: `The due date passed ${-d} day${d === -1 ? '' : 's'} ago.`,
        action: 'Finish it, or move the due date', dueAt: item.dueAt, derivation: rule('overdue'),
      });
    } else {
      signals.push({
        id: `sig-due-${item.id}`, type: 'deadline_risk', level: urgent ? 'now' : 'next',
        subject: { kind: 'workItem', id: item.id }, projectId: item.projectId,
        title: item.title,
        detail: item.group ? `In ${item.group}.` : 'Due today.',
        why: 'It is due today.',
        action: item.status === 'in_progress' ? 'Finish today' : 'Start today', dueAt: item.dueAt, derivation: rule('due-today'),
      });
    }
  }

  // Stale work: one signal per project, not one per task.
  const staleByProject = new Map<string, RankedItem[]>();
  for (const r of ctx.ranked.filter(r => r.stale)) {
    const key = r.item.projectId ?? 'none';
    staleByProject.set(key, [...(staleByProject.get(key) ?? []), r]);
  }
  for (const [projectId, items] of staleByProject) {
    const oldest = Math.max(...items.map(r => -(r.daysUntilDue ?? 0)));
    signals.push({
      id: `sig-stale-${projectId}`, type: 'stale', level: 'watch',
      subject: { kind: 'project', id: projectId }, projectId: projectId === 'none' ? null : projectId,
      title: `${items.length} task${items.length === 1 ? '' : 's'} with outdated due dates`,
      detail: items.slice(0, 3).map(r => r.item.title).join(' · ') + (items.length > 3 ? ` · +${items.length - 3} more` : ''),
      why: `Due dates passed up to ${oldest} days ago with no completion. The dates probably no longer reflect the plan.`,
      action: 'Confirm or reschedule in one pass', dueAt: null, derivation: rule('stale', 0.8),
    });
  }

  signals.push(...codeReviewSignals(ctx, rule));

  for (const [a, b] of conflicts(ctx.events, ctx.today)) {
    signals.push({
      id: `sig-conflict-${a.id}-${b.id}`, type: 'schedule_conflict', level: 'next',
      subject: { kind: 'event', id: a.id }, projectId: a.projectId ?? b.projectId,
      title: `${a.title} overlaps ${b.title}`,
      detail: `${formatClock(new Date(a.startAt))} and ${formatClock(new Date(b.startAt))} today.`,
      why: 'You cannot attend both.', action: 'Decline or move one', dueAt: ctx.today, derivation: rule('conflict'),
    });
  }

  // Capacity: estimated work due in the next week against open focus time.
  if (ctx.hasCalendar) {
    const dueSoon = ctx.ranked.filter(r => !r.stale && r.daysUntilDue !== null && r.daysUntilDue <= 7);
    const estimated = dueSoon.reduce((s, r) => s + (r.item.estimatedMinutes ?? 0), 0);
    const unestimated = dueSoon.filter(r => !r.item.estimatedMinutes).length;
    if (estimated > ctx.focusMinutesAhead) {
      signals.push({
        id: 'sig-capacity-week', type: 'capacity_risk', level: estimated > ctx.focusMinutesAhead * 1.5 ? 'now' : 'watch',
        subject: { kind: 'capacity', id: 'week' }, projectId: null,
        title: 'Planned work exceeds open focus time this week',
        detail: `${minutesLabel(estimated)} of estimated work is due within 7 days. You have ${minutesLabel(ctx.focusMinutesAhead)} of open focus time.` +
          (unestimated ? ` ${unestimated} more task${unestimated === 1 ? ' has' : 's have'} no estimate.` : ''),
        why: 'Something will slip unless the plan changes.',
        action: 'Move a due date or protect more focus time', dueAt: null, derivation: rule('capacity', 0.9),
      });
    }
  }

  return capNow(signals);
}

/** PR waits shorter than this are normal and not worth a signal. */
const REVIEW_WAIT_DAYS = 3;
/** PRs idle longer than this are abandoned, not waiting. They get no signal. */
const ABANDONED_DAYS = 30;

function codeReviewSignals(ctx: SignalContext, rule: (name: string, confidence?: number) => Signal['derivation']): Signal[] {
  const out: Signal[] = [];
  for (const { item } of ctx.ranked) {
    const cr = item.codeReview;
    if (!cr) continue;
    const idle = daysBetween(localDate(new Date(item.updatedAt)), ctx.today);
    if (idle > ABANDONED_DAYS) continue;
    const common = { subject: { kind: 'workItem' as const, id: item.id }, projectId: item.projectId, dueAt: null };

    if (cr.role === 'reviewer') {
      out.push({ ...common, id: `sig-review-${item.id}`, type: 'review_requested', level: 'next',
        title: item.title.replace(/^Review: /, ''), detail: `Review requested on ${cr.ref}.`,
        why: 'A teammate is waiting on your review.', action: 'Review the PR', derivation: rule('review-requested') });
    } else if (cr.checks === 'failing') {
      out.push({ ...common, id: `sig-checks-${item.id}`, type: 'blocked', level: 'next',
        title: item.title, detail: `Checks are failing on ${cr.ref}.`,
        why: 'Reviewers usually wait for green checks.', action: 'Fix the failing checks', derivation: rule('checks-failing') });
    } else if (cr.state === 'changes_requested') {
      out.push({ ...common, id: `sig-changes-${item.id}`, type: 'response_needed', level: 'next',
        title: item.title, detail: `Changes requested on ${cr.ref}.`,
        why: 'The PR cannot merge until you respond.', action: 'Address the requested changes', derivation: rule('changes-requested') });
    } else if (cr.state === 'approved') {
      out.push({ ...common, id: `sig-approved-${item.id}`, type: 'important_change', level: 'next',
        title: item.title, detail: `${cr.ref} is approved.`,
        why: 'Approved PRs go stale if they sit.', action: 'Merge it', derivation: rule('approved') });
    } else if (cr.state === 'awaiting_review' && idle >= REVIEW_WAIT_DAYS) {
      out.push({ ...common, id: `sig-waiting-${item.id}`, type: 'waiting', level: 'watch',
        title: item.title, detail: `No activity on ${cr.ref} for ${idle} days.`,
        why: 'Your PR may be stuck in the review queue.', action: 'Nudge the reviewer', derivation: rule('review-wait', 0.8) });
    }
  }
  return out;
}

/** Keep NOW small. The extra items drop to NEXT, keeping their order. */
function capNow(signals: Signal[]): Signal[] {
  let nowCount = 0;
  return signals.map(s => {
    if (s.level !== 'now') return s;
    return ++nowCount > MAX_NOW ? { ...s, level: 'next' } : s;
  });
}

const LEVEL_ORDER = { now: 0, next: 1, watch: 2, later: 3, fyi: 4 };
const STATUS: Record<Signal['type'], string> = {
  overdue: 'Overdue', deadline_risk: 'Due today', stale: 'Needs cleanup', schedule_conflict: 'Conflict',
  capacity_risk: 'Over capacity', response_needed: 'Needs response', blocked: 'Blocked', waiting: 'Waiting',
  review_requested: 'Review requested', goal_risk: 'Goal risk', important_change: 'Ready',
};
const SOURCE_LABEL: Record<string, string> = { teamwork: 'Teamwork', 'google-calendar': 'Calendar', github: 'GitHub', gitlab: 'GitLab', manual: 'Threadline' };

export function toAttentionItems(
  signals: Signal[],
  lookup: { workItem: (id: string) => RankedItem | undefined; event: (id: string) => Event | undefined; project: (id: string) => Project | undefined },
  today: string,
): AttentionItem[] {
  return [...signals]
    .sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level])
    .map(s => {
      const work = s.subject.kind === 'workItem' ? lookup.workItem(s.subject.id)?.item : undefined;
      const event = s.subject.kind === 'event' ? lookup.event(s.subject.id) : undefined;
      const project = s.projectId ? lookup.project(s.projectId) : undefined;
      const source = work?.source ?? event?.source ?? project?.source;
      return {
        id: s.id,
        level: s.level,
        source: source ? SOURCE_LABEL[source.type] ?? source.type : 'Threadline',
        sourceRef: work?.group ?? (event ? 'Today' : project?.name ?? 'Capacity'),
        sourceUrl: source?.url ?? null,
        projectId: s.projectId,
        title: s.title,
        detail: s.detail,
        why: s.why,
        due: s.dueAt ? dueLabel(s.dueAt, today) : '—',
        action: s.action,
        estimatedEffort: minutesLabel(work?.estimatedMinutes ?? null),
        status: STATUS[s.type],
      };
    });
}
