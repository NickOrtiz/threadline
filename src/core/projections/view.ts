// Entities + memory → the ThreadlineView the UI renders.

import type { EntityStore } from '../schema/entities.ts';
import { ThreadlineView, type Focus, type NextUpItem } from '../schema/view.ts';
import type { Memory } from '../../storage/memory.ts';
import type { Config } from '../config.ts';
import { dueLabel, formatLongDate, localDate, minutesLabel, relativeActivity } from '../time.ts';
import { rankWorkItems, type RankedItem } from './workload.ts';
import { dayCapacity, deriveSchedule, focusMinutesAhead } from './today.ts';
import { deriveSignals, toAttentionItems } from './attention.ts';
import { deriveProjects } from './projects.ts';

const SOURCE_LABEL: Record<string, string> = { teamwork: 'Teamwork', 'google-calendar': 'Calendar', github: 'GitHub', gitlab: 'GitLab', manual: 'Threadline' };

export function buildView(store: EntityStore, memory: Memory, config: Config, now: Date): ThreadlineView {
  const today = localDate(now);
  const generatedAt = store.syncedAt;
  const hasCalendar = store.sourceStatus.some(s => s.type === 'google-calendar' && s.ok);
  const projectsById = new Map(store.projects.map(p => [p.id, p]));
  const projectName = (id: string | null) => (id ? projectsById.get(id)?.name ?? null : null);

  const ranked = rankWorkItems(store.workItems, today);
  // Waiting and blocked work is someone else's move. It shows in attention, not in focus.
  const actionable = ranked.filter(r => !r.stale && r.item.status !== 'waiting' && r.item.status !== 'blocked');
  const top = actionable[0];

  const cap = dayCapacity(store.events, today, config.workday);
  const signals = deriveSignals({
    ranked, events: store.events, hasCalendar, today, generatedAt,
    focusMinutesAhead: focusMinutesAhead(store.events, today, 5, config.workday),
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
  const allocation = hasCalendar ? Math.round(((cap.meetingMinutes + dueTodayMinutes) / cap.workdayMinutes) * 100) : 0;
  const capacityStatus = !hasCalendar ? 'Unknown' : allocation > 100 ? 'Overloaded' : allocation > 85 ? 'Tight' : 'Healthy';

  const nowCount = attention.filter(a => a.level === 'now').length;
  const firstName = config.displayName ?? store.user.name.split(' ')[0];
  const hour = now.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  const summaryParts = [
    top ? `Start with ${top.item.title}${projectName(top.item.projectId) ? ` for ${projectName(top.item.projectId)}` : ''}.` : 'Nothing is scheduled to need you today.',
    hasCalendar ? `You have ${minutesLabel(cap.focusMinutes)} of open focus time and ${minutesLabel(cap.meetingMinutes)} of meetings.` : 'Connect a calendar to see focus time.',
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
      estimate: minutesLabel(r.item.estimatedMinutes),
      projectId: r.item.projectId && projectsById.has(r.item.projectId) ? r.item.projectId : null,
      status: r.item.status,
    })),
    projects: deriveProjects(store.projects, store.workItems, ranked, memory.projects, today),
    threads: memory.threads,
    goals: memory.goals,
    knowledge: memory.knowledge,
    review: memory.review ?? { period: `${now.getFullYear()} · year to date`, themes: [], narrative: 'No evidence retained yet. Evidence collects here as work closes.' },
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
    title: item.title,
    description: item.group ? `In ${item.group}.` : '',
    reason: item.dueAt ? `Due ${due.toLowerCase().startsWith('to') ? due.toLowerCase() : due}.`
      : item.codeReview?.role === 'reviewer' ? 'A teammate is waiting on your review.'
      : item.codeReview ? 'Your PR cannot merge until this is done.'
      : 'Highest-ranked open task.',
    effort: minutesLabel(item.estimatedMinutes),
    status: item.status === 'in_progress' ? 'In progress' : 'Not started',
    blockers: item.blockedBy,
    nextAction: item.nextAction ?? (item.status === 'in_progress' ? 'Continue where you left off.' : 'Start the task.'),
    continuity: {
      lastActive: relativeActivity(item.updatedAt, now),
      lastAction: `Last updated in ${source}.`,
      restart: `Open the task in ${source}${item.group ? `, under ${item.group}` : ''}.`,
    },
  };
}

const round1 = (n: number) => Math.round(n * 10) / 10;
