// Entities + memory → the ThreadlineView the UI renders.

import type { EntityStore } from '../schema/entities.ts';
import { ThreadlineView, type Focus, type NextUpItem } from '../schema/view.ts';
import type { z } from 'zod';
import type { ContinuityView } from '../schema/view.ts';
import type { Todo } from '../../storage/todos.ts';
import type { Memory } from '../../storage/memory.ts';
import type { Config } from '../config.ts';
import { atTime, dueLabel, formatLongDate, localDate, minutesLabel, relativeActivity } from '../time.ts';
import { rankWorkItems, type RankedItem } from './workload.ts';
import { dayCapacity, deriveSchedule, focusMinutesAhead, isDayOff, nextWorkday } from './today.ts';
import { deriveSignals, toAttentionItems } from './attention.ts';
import { deriveProjects } from './projects.ts';
import { deriveReports, type DayStages } from './report.ts';

const SOURCE_LABEL: Record<string, string> = { teamwork: 'Teamwork', 'google-calendar': 'Calendar', github: 'GitHub', gitlab: 'GitLab', manual: 'To-do' };

export interface ViewExtras {
  todos: Todo[];
  continuity: z.infer<typeof ContinuityView> | null;
  /** Stages at the start and end of each report day, from snapshots. */
  stagesByDate?: Map<string, DayStages>;
}

export function buildView(store: EntityStore, memory: Memory, config: Config, now: Date, extras: ViewExtras = { todos: [], continuity: null }): ThreadlineView {
  const today = localDate(now);
  const generatedAt = store.syncedAt;
  const hasCalendar = store.sourceStatus.some(s => s.type === 'google-calendar' && s.ok);
  const projectsById = new Map(store.projects.map(p => [p.id, p]));
  const projectName = (id: string | null) => (id ? projectsById.get(id)?.name ?? null : null);

  const ranked = rankWorkItems(store.workItems, today);
  // Waiting and blocked work is someone else's move. It shows in attention, not in focus.
  const actionable = ranked.filter(r => !r.stale && r.item.status !== 'waiting' && r.item.status !== 'blocked');
  const top = actionable[0];

  // Today's focus time counts only what is left from now.
  const cap = dayCapacity(store.events, today, config.workday, now);
  const dayOff = (date: string) => isDayOff(store.events, date, config.workday);
  const offToday = hasCalendar && dayOff(today);
  const inWorkday = now < atTime(today, config.workday.end);
  const signals = deriveSignals({
    ranked, events: store.events, hasCalendar, today, generatedAt,
    focusMinutesAhead: focusMinutesAhead(store.events, today, 5, config.workday, now),
    todayFit: hasCalendar && !offToday && inWorkday ? { leftMinutes: cap.focusMinutes, nextWorkday: nextWorkday(store.events, today, config.workday) } : null,
    isDayOff: dayOff,
  });
  const rankedById = new Map(ranked.map(r => [r.item.id, r]));
  const eventsById = new Map(store.events.map(e => [e.id, e]));
  const attention = toAttentionItems(signals, {
    workItem: id => rankedById.get(id),
    event: id => eventsById.get(id),
    project: id => projectsById.get(id),
  }, today);

  const dueTodayMinutes = actionable
    .filter(r => r.daysUntilDue !== null && r.daysUntilDue <= 0)
    .reduce((s, r) => s + (r.item.estimatedMinutes ?? 0), 0);
  // Allocation: estimated work due today against the focus time left today.
  const working = hasCalendar && !offToday && inWorkday;
  const allocation = !working ? 0
    : cap.focusMinutes ? Math.round((dueTodayMinutes / cap.focusMinutes) * 100)
    : dueTodayMinutes ? 100 : 0;
  const capacityStatus = !hasCalendar ? 'Unknown'
    : offToday ? 'Day off'
    : !inWorkday ? 'Day done'
    : dueTodayMinutes > cap.focusMinutes ? 'Overloaded'
    : allocation > 85 ? 'Tight' : 'Healthy';

  const nowCount = attention.filter(a => a.level === 'now').length;
  const firstName = config.displayName ?? store.user.name.split(' ')[0];
  const hour = now.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  const summaryParts = [
    top ? `Start with ${top.item.title}${projectName(top.item.projectId) ? ` for ${projectName(top.item.projectId)}` : ''}.` : 'Nothing is scheduled to need you today.',
    !hasCalendar ? 'Connect a calendar to see focus time.'
      : offToday ? 'You are not working today.'
      : !inWorkday ? 'Your workday is over.'
      : `You have ${cap.focusMinutes ? `${minutesLabel(cap.focusMinutes)} of` : 'no'} focus time left today${cap.meetingMinutes ? `, and ${minutesLabel(cap.meetingMinutes)} of meetings on the calendar` : ''}.`,
    nowCount ? `${nowCount} item${nowCount === 1 ? ' needs' : 's need'} a decision today.` : 'Nothing needs to interrupt you.',
  ];

  return ThreadlineView.parse({
    meta: {
      workspace: config.workspace,
      user: store.user,
      generatedAt,
      dataMode: 'live',
      timezone: config.timezone,
      sources: store.sourceStatus,
    },
    daily: {
      date: formatLongDate(now),
      headline: `${greeting}, ${firstName}.`,
      greetingName: firstName,
      subhead: 'Here is the plan. Everything else can wait.',
      summary: summaryParts.join(' '),
      capacity: {
        focusHours: round1(cap.focusMinutes / 60),
        meetingsHours: round1(cap.meetingMinutes / 60),
        allocation,
        status: capacityStatus,
      },
    },
    focus: top ? toFocus(top, today, now) : null,
    attention,
    schedule: hasCalendar ? deriveSchedule(store.events, today, config.workday, projectName, top?.item.title ?? null) : [],
    nextUp: actionable.slice(1, 6).map((r): NextUpItem => ({
      id: r.item.id,
      title: r.item.title,
      source: `${SOURCE_LABEL[r.item.source.type] ?? r.item.source.type} · ${dueLabel(r.item.dueAt, today)}`,
      sourceUrl: r.item.source.url,
      todoId: r.item.source.type === 'manual' ? r.item.source.id : undefined,
      estimate: minutesLabel(r.item.estimatedMinutes),
      projectId: r.item.projectId && projectsById.has(r.item.projectId) ? r.item.projectId : null,
      status: r.item.stage ?? r.item.status,
    })),
    projects: deriveProjects(store.projects, store.workItems, ranked, memory.projects, today),
    threads: memory.threads,
    goals: memory.goals,
    knowledge: memory.knowledge,
    review: memory.review ?? { period: `${now.getFullYear()} · year to date`, themes: [], narrative: 'No evidence retained yet. Evidence collects here as work closes.' },
    todos: todoViews(extras.todos, today, now),
    continuity: extras.continuity,
    reports: deriveReports({
      today, days: config.report.days, activities: store.activities, workItems: store.workItems, ranked,
      projects: store.projects, todos: extras.todos, stagesByDate: extras.stagesByDate ?? new Map(),
    }),
  });
}

function toFocus(r: RankedItem, today: string, now: Date): Focus {
  const { item } = r;
  const due = dueLabel(item.dueAt, today);
  const source = SOURCE_LABEL[item.source.type] ?? item.source.type;
  return {
    id: item.id,
    projectId: item.projectId ?? '',
    threadId: item.threadId,
    sourceUrl: item.source.url,
    todoId: item.source.type === 'manual' ? item.source.id : undefined,
    title: item.title,
    description: item.group ? `In ${item.group}.` : '',
    reason: item.dueAt ? `Due ${due.toLowerCase().startsWith('to') ? due.toLowerCase() : due}.`
      : item.codeReview?.role === 'reviewer' ? 'A teammate is waiting on your review.'
      : item.codeReview ? 'Your PR cannot merge until this is done.'
      : 'Highest-ranked open task.',
    effort: minutesLabel(item.estimatedMinutes),
    status: item.stage ?? (item.status === 'in_progress' ? 'In progress' : 'Not started'),
    blockers: item.blockedBy,
    nextAction: item.nextAction ?? (item.status === 'in_progress' ? 'Continue where you left off.' : 'Start the task.'),
    continuity: item.source.type === 'manual'
      ? { lastActive: relativeActivity(item.updatedAt, now), lastAction: 'Added to your to-dos.', restart: 'Pick it up from your to-do list.' }
      : {
        lastActive: relativeActivity(item.updatedAt, now),
        lastAction: `Last updated in ${source}.`,
        restart: `Open the task in ${source}${item.group ? `, under ${item.group}` : ''}.`,
      },
  };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Open to-dos by due date, then those done in the last 7 days, newest first. */
function todoViews(todos: Todo[], today: string, now: Date) {
  const weekAgo = now.getTime() - 7 * 86_400_000;
  const open = todos.filter(t => t.status === 'open').sort((a, b) => (a.dueAt ?? '9999').localeCompare(b.dueAt ?? '9999') || a.createdAt.localeCompare(b.createdAt));
  const done = todos.filter(t => t.status === 'done' && t.completedAt && Date.parse(t.completedAt) >= weekAgo).sort((a, b) => b.completedAt!.localeCompare(a.completedAt!));
  return [...open, ...done].map(t => ({
    id: t.id, title: t.title, projectId: t.projectId, dueAt: t.dueAt, due: dueLabel(t.dueAt, today),
    estimatedMinutes: t.estimatedMinutes, status: t.status, completedAt: t.completedAt,
  }));
}
