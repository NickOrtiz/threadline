// Attention signals from deterministic rules.
//
// The rules are conservative about NOW. Most things land in NEXT or WATCH,
// and stale work is grouped per project so it does not flood the page.

import type { Event, Project, Requirement, Signal } from '../schema/entities.ts';
import type { WeekBudget } from './budget.ts';
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
  /** Focus minutes available over the next 5 workdays, counting today from now. */
  focusMinutesAhead: number;
  /** Today's remaining time against the work due today. Null outside the workday. */
  todayFit: { leftMinutes: number; nextWorkday: string } | null;
  /** True for weekends and full out-of-office days. */
  isDayOff: (date: string) => boolean;
  /** This week's bookings against logged time. Null without allocations. */
  week: WeekBudget | null;
  requirements: Map<string, Requirement>;
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

  for (const { item } of ctx.ranked) {
    if (!item.needsResponse) continue;
    signals.push({
      id: `sig-response-${item.id}`, type: 'response_needed', level: 'next',
      subject: { kind: 'workItem', id: item.id }, projectId: item.projectId,
      title: item.title,
      detail: item.stage ? `Moved to "${item.stage}".` : 'Handed back to you.',
      why: 'The task came back to you with feedback.',
      action: 'Respond to the feedback', dueAt: item.dueAt, derivation: rule('needs-response'),
    });
  }

  signals.push(...codeReviewSignals(ctx, rule));
  signals.push(...timeSignals(ctx, rule));
  signals.push(...bookingSignals(ctx, rule));
  signals.push(...requirementSignals(ctx, rule));

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

const weekdayName = (date: string) => new Date(Date.parse(`${date}T12:00:00Z`)).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });

/** Does today's work fit the time left, and is anything due on a day you are out? */
function timeSignals(ctx: SignalContext, rule: (name: string, confidence?: number) => Signal['derivation']): Signal[] {
  const out: Signal[] = [];
  const active = ctx.ranked.filter(r => !r.stale && r.item.status !== 'waiting' && r.item.status !== 'blocked');

  if (ctx.hasCalendar && ctx.todayFit) {
    const dueNow = active.filter(r => r.daysUntilDue !== null && r.daysUntilDue <= 0);
    const due = dueNow.reduce((s, r) => s + (r.item.estimatedMinutes ?? 0), 0);
    const unestimated = dueNow.filter(r => !r.item.estimatedMinutes).length;
    if (due > ctx.todayFit.leftMinutes) {
      const next = ctx.todayFit.nextWorkday;
      const nextIsTomorrow = daysBetween(ctx.today, next) === 1;
      out.push({
        id: 'sig-capacity-today', type: 'capacity_risk', level: 'now',
        subject: { kind: 'capacity', id: 'today' }, projectId: null,
        title: "Today's work won't fit",
        detail: `${minutesLabel(due)} of estimated work is due today. ${ctx.todayFit.leftMinutes ? `You have ${minutesLabel(ctx.todayFit.leftMinutes)} of focus time left.` : 'You have no focus time left today.'}` +
          (unestimated ? ` ${unestimated} more task${unestimated === 1 ? ' has' : 's have'} no estimate.` : ''),
        why: nextIsTomorrow ? 'Whatever slips moves to tomorrow.' : `Whatever slips waits until ${weekdayName(next)}, your next working day.`,
        action: 'Move a due date, or tell the team now', dueAt: ctx.today, derivation: rule('today-fit', 0.9),
      });
    }
  }

  if (ctx.hasCalendar) {
    for (const r of active) {
      const d = r.daysUntilDue;
      if (d === null || d < 1 || d > 7 || !r.item.dueAt || !ctx.isDayOff(r.item.dueAt)) continue;
      out.push({
        id: `sig-dayoff-${r.item.id}`, type: 'deadline_risk', level: 'watch',
        subject: { kind: 'workItem', id: r.item.id }, projectId: r.item.projectId,
        title: r.item.title,
        detail: `Due ${weekdayName(r.item.dueAt)}, when you are not working.`,
        why: 'It has to be done before then, or the date has to move.',
        action: 'Finish it earlier, or move the date', dueAt: r.item.dueAt, derivation: rule('due-on-day-off'),
      });
    }
  }
  return out;
}

const hours = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1)} h`;
const days = (n: number) => `${n} working day${n === 1 ? '' : 's'}`;

/** Booked time this week (Malcolm) against logged time (Teamwork). */
function bookingSignals(ctx: SignalContext, rule: (name: string, confidence?: number) => Signal['derivation']): Signal[] {
  const week = ctx.week;
  if (!week) return [];
  const out: Signal[] = [];
  const openWork = (projectId: string) => ctx.ranked.some(r => r.item.projectId === projectId && !r.stale && r.item.status !== 'waiting' && r.item.status !== 'blocked');

  for (const p of week.projects) {
    const ask = p.manager ? `ask ${p.manager}` : 'ask the project manager';
    const base = { subject: { kind: 'project' as const, id: p.projectId }, projectId: p.projectId, dueAt: null };
    if (p.status === 'behind' && !openWork(p.projectId)) {
      out.push({ ...base, id: `sig-booking-idle-${p.projectId}`, type: 'capacity_risk', level: 'watch',
        title: `${p.name}: ${hours(p.booked)} booked this week, no open tasks`,
        detail: `You have logged ${hours(p.logged)}, and nothing open is assigned to you here.`,
        why: 'Booked time with no visible work usually means a missing task.',
        action: `Ask what to pick up (${ask})`, derivation: rule('booking-no-work') });
    } else if (p.status === 'behind') {
      out.push({ ...base, id: `sig-booking-behind-${p.projectId}`, type: 'capacity_risk',
        level: p.daysLeft <= 2 && p.remaining >= 4 ? 'next' : 'watch',
        title: `${p.name}: ${hours(p.remaining)} of this week's booking left`,
        detail: `Booked ${hours(p.booked)}, logged ${hours(p.logged)}. ${days(p.daysLeft)} left this week.`,
        why: 'Your booked time for this project is behind pace.',
        action: p.remaining > p.daysLeft * 6 ? `Plan the time, or ${ask} to move the booking` : 'Plan time for it this week', derivation: rule('booking-pace', 0.9) });
    } else if (p.status === 'over') {
      out.push({ ...base, id: `sig-booking-over-${p.projectId}`, type: 'capacity_risk', level: 'watch',
        title: `${p.name}: ${hours(p.logged)} logged of ${hours(p.booked)} booked`,
        detail: 'You are over this week\'s booking.',
        why: 'Time past the booking may not be budgeted.',
        action: `Check before logging more (${ask})`, derivation: rule('booking-over') });
    }
  }

  if (week.booked > week.available + 0.5) {
    out.push({ id: 'sig-booking-total', type: 'capacity_risk', level: 'watch',
      subject: { kind: 'capacity', id: 'week' }, projectId: null,
      title: `Booked ${hours(week.booked)} this week, ${hours(week.available)} available`,
      detail: week.projects.map(p => `${p.name} ${hours(p.booked)}`).join(' · '),
      why: 'Your bookings add up to more than your working hours.',
      action: 'Raise it with the project managers', dueAt: null, derivation: rule('booking-total') });
  }
  return out;
}

/** Work about to start or underway whose PRD still has open product questions. */
function requirementSignals(ctx: SignalContext, rule: (name: string, confidence?: number) => Signal['derivation']): Signal[] {
  const out: Signal[] = [];
  for (const r of ctx.ranked) {
    const { item } = r;
    if (r.stale || item.status === 'waiting' || item.status === 'blocked' || !item.prdIds.length) continue;
    const soon = item.status === 'in_progress' || (r.daysUntilDue !== null && r.daysUntilDue <= 5);
    if (!soon) continue;
    const prds = item.prdIds.map(id => ctx.requirements.get(id)).filter((x): x is Requirement => !!x);
    const questions = prds.flatMap(p => p.openQuestions);
    if (!questions.length) continue;
    out.push({
      id: `sig-prd-questions-${item.id}`, type: 'blocked', level: 'next',
      subject: { kind: 'workItem', id: item.id }, projectId: item.projectId,
      title: `${item.title}: ${questions.length} open product question${questions.length === 1 ? '' : 's'}`,
      detail: questions.slice(0, 2).join(' · ') + (questions.length > 2 ? ` · +${questions.length - 2} more` : ''),
      why: `${prds.map(p => p.code ?? p.title).join(', ')} still has unanswered questions. Building now risks rework.`,
      action: 'Get answers before you build', dueAt: item.dueAt, derivation: rule('prd-open-questions'),
    });
  }
  return out;
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
const SOURCE_LABEL: Record<string, string> = { teamwork: 'Teamwork', 'google-calendar': 'Calendar', github: 'GitHub', gitlab: 'GitLab', manual: 'To-do', malcolm: 'Malcolm', relay: 'Relay' };

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
