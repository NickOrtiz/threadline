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
import { deriveWeek, leaveAsEvents, type ProjectWeek } from './budget.ts';
import { deriveThreads } from './threads.ts';
import { deriveBatches } from './batches.ts';
import { deriveReviewQueue } from './review-queue.ts';
import type { ThreadNote } from '../../storage/notes.ts';
import type { ClaudeUsage } from '../../storage/claude-usage.ts';
import type { KnowledgeDocument, Requirement } from '../schema/entities.ts';
import type { JournalEntry } from '../../storage/journal.ts';
import { relayUrl } from '../../adapters/relay/normalize.ts';

const SOURCE_LABEL: Record<string, string> = { teamwork: 'Teamwork', 'google-calendar': 'Calendar', github: 'GitHub', gitlab: 'GitLab', manual: 'To-do', malcolm: 'Malcolm', relay: 'Relay', leapsome: 'Leapsome', claude: 'Claude' };

export interface ViewExtras {
  todos: Todo[];
  continuity: z.infer<typeof ContinuityView> | null;
  /** Stages at the start and end of each report day, from snapshots. */
  stagesByDate?: Map<string, DayStages>;
  /** Recent work journal entries. */
  journal?: JournalEntry[];
  /** Your local notes on threads. */
  notes?: Record<string, ThreadNote[]>;
  /** Claude plan usage from the status line script. */
  claudeUsage?: ClaudeUsage | null;
}

export function buildView(store: EntityStore, memory: Memory, config: Config, now: Date, extras: ViewExtras = { todos: [], continuity: null }): ThreadlineView {
  const today = localDate(now);
  const generatedAt = store.syncedAt;
  const hasCalendar = store.sourceStatus.some(s => s.type === 'google-calendar' && s.ok);
  const projectsById = new Map(store.projects.map(p => [p.id, p]));
  const projectName = (id: string | null) => (id ? projectsById.get(id)?.name ?? null : null);

  // Calendar events plus leave from Malcolm: both make days off.
  const events = [...store.events, ...leaveAsEvents(store.leave)];
  const hasDayData = hasCalendar || store.leave.length > 0;
  const dayOff = (date: string) => isDayOff(events, date, config.workday);

  // This week's bookings against logged time. Projects behind pace rank a little higher.
  const week = deriveWeek({
    allocations: store.allocations, timeLogs: store.timeLogs, isDayOff: dayOff, today, now,
    workday: config.workday, projectName: id => projectName(id) ?? id,
  });
  const weekByProject = new Map((week?.projects ?? []).map(p => [p.projectId, p]));
  const PACE_BOOST: Record<ProjectWeek['status'], number> = { behind: 6, on_pace: 0, done: -4, over: -6 };
  const ranked = rankWorkItems(store.workItems, today, id => {
    const w = id ? weekByProject.get(id) : undefined;
    return w ? PACE_BOOST[w.status] : 0;
  });
  const requirementsById = new Map(store.requirements.map(r => [r.id, r]));
  // Waiting and blocked work is someone else's move. It shows in attention, not in focus.
  const actionable = ranked.filter(r => !r.stale && r.item.status !== 'waiting' && r.item.status !== 'blocked');
  const top = actionable[0];

  // Today's focus time counts only what is left from now.
  const cap = dayCapacity(events, today, config.workday, now);
  const offToday = hasDayData && dayOff(today);
  const inWorkday = now < atTime(today, config.workday.end);
  const signals = deriveSignals({
    ranked, events, hasCalendar, today, generatedAt,
    focusMinutesAhead: focusMinutesAhead(events, today, 5, config.workday, now),
    todayFit: hasCalendar && !offToday && inWorkday ? { leftMinutes: cap.focusMinutes, nextWorkday: nextWorkday(events, today, config.workday) } : null,
    isDayOff: dayOff,
    week,
    requirements: requirementsById,
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

  const threads = deriveThreads({ store, journal: extras.journal ?? [], notes: extras.notes ?? {}, now });
  // Pull requests waiting on reviewers: one quiet item when some need a bump.
  const reviewQueue = deriveReviewQueue(store.workItems, today, config.codeReview);
  const stale = reviewQueue.filter(r => r.tier === 'stale');
  if (stale.length) {
    attention.push({
      id: 'sig-review-queue', level: 'watch', source: 'GitHub', sourceRef: 'Review queue', sourceUrl: stale.length === 1 ? stale[0].url : null, projectId: null,
      title: stale.length === 1 ? `${stale[0].ref} needs a bump from reviewers` : `${stale.length} pull requests need a bump from reviewers`,
      detail: stale.slice(0, 4).map(r => `${r.ref} (${r.waitingDays} working days${r.reviewers.length ? `, ${r.reviewers.join(', ')}` : ''})`).join(' · ') + (stale.length > 4 ? ` · +${stale.length - 4} more` : ''),
      why: `No review for ${config.codeReview.staleDays} or more working days.`,
      due: '—', action: 'Ask the reviewers for a look', estimatedEffort: '5 min', status: 'Review stale',
    });
  }
  // Claude usage near a limit: worth knowing before starting a big code task.
  const claudeNow = claudeView(extras.claudeUsage ?? null, now);
  for (const w of claudeNow && !claudeNow.stale ? claudeNow.windows : []) {
    const limit = w.label === '5-hour window' ? 80 : 85;
    if (w.usedPercent < limit) continue;
    const resets = w.resetsAt ? new Date(w.resetsAt).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : 'soon';
    attention.push({
      id: `sig-claude-${w.label}`, level: 'watch', source: 'Claude', sourceRef: 'Plan usage', sourceUrl: null, projectId: null,
      title: `Claude usage: ${Math.round(w.usedPercent)}% of your ${w.label}`,
      detail: `It resets ${resets}.`,
      why: 'A large code task could hit the limit before it finishes.',
      due: '—', action: 'Save big code tasks for after the reset', estimatedEffort: '—', status: 'Near limit',
    });
  }
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
      claude: claudeView(extras.claudeUsage ?? null, now),
      week: week ? { booked: week.booked, logged: round1(week.projects.reduce((t, p) => t + p.logged, 0)), available: week.available } : undefined,
    },
    focus: top ? { ...toFocus(top, today, now), prds: prdSummaries(top.item.prdIds, requirementsById) } : null,
    attention,
    schedule: hasCalendar ? deriveSchedule(events, today, config.workday, projectName, top?.item.title ?? null) : [],
    nextUp: actionable.slice(1, 6).map((r): NextUpItem => ({
      id: r.item.id,
      title: r.item.title,
      source: `${SOURCE_LABEL[r.item.source.type] ?? r.item.source.type} · ${dueLabel(r.item.dueAt, today)}`,
      sourceUrl: r.item.source.url,
      todoId: r.item.source.type === 'manual' ? r.item.source.id : undefined,
      prd: (() => { const p = requirementsById.get(r.item.prdIds[0] ?? ''); return p ? { code: p.code, title: p.title, openQuestions: p.openQuestions.length } : undefined; })(),
      estimate: minutesLabel(r.item.estimatedMinutes),
      projectId: r.item.projectId && projectsById.has(r.item.projectId) ? r.item.projectId : null,
      status: r.item.stage ?? r.item.status,
    })),
    projects: deriveProjects(store.projects, store.workItems, ranked, memory.projects, today, weekByProject).map(p => ({
      ...p,
      knowledgeBase: knowledgeBase(p.id, store.documents, store.requirements, store.workItems, config),
      record: (extras.journal ?? []).filter(e => e.projectId === p.id && e.kind !== 'time').slice(-12).reverse()
        .map(e => ({ date: e.date, kind: e.kind, title: e.title, detail: e.detail, url: e.url })),
    })),
    threads: [...threads, ...memory.threads],
    reviewQueue,
    batches: deriveBatches({
      ranked, workItems: store.workItems, requirements: requirementsById, week: weekByProject,
      projectName: id => projectName(id) ?? id,
      claudeUsedPercent: claudeNow && !claudeNow.stale && claudeNow.windows.length ? Math.max(...claudeNow.windows.map(w => w.usedPercent)) : null,
      switchMinutes: config.batching.switchMinutes, parallelSlots: config.batching.parallelSlots,
    }),
    goals: [...goalViews(store.goals, today), ...memory.goals],
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
    reason: item.dueAt ? (due.endsWith('overdue') ? `${due.charAt(0).toUpperCase()}${due.slice(1)}.` : `Due ${due.toLowerCase().startsWith('to') ? due.toLowerCase() : due}.`)
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

/** Past this age a reading is marked stale: usage elsewhere may have moved it since. */
const CLAUDE_USAGE_STALE_MS = 3 * 3_600_000;

/**
 * Claude plan usage windows still in effect. A window past its reset no
 * longer applies. Old readings stay visible, marked stale, so the card does
 * not vanish over a weekend without Claude Code.
 */
function claudeView(usage: ClaudeUsage | null, now: Date) {
  if (!usage) return undefined;
  const windows = ([['5-hour window', usage.fiveHour], ['week', usage.sevenDay]] as const)
    .filter(([, w]) => w && (!w.resetsAt || Date.parse(w.resetsAt) > now.getTime()))
    .map(([label, w]) => ({ label, usedPercent: w!.usedPercent, resetsAt: w!.resetsAt }));
  return { capturedAt: usage.capturedAt, stale: now.getTime() - Date.parse(usage.capturedAt) > CLAUDE_USAGE_STALE_MS, windows };
}

const GOAL_STATUS: Record<string, string> = { live: 'Live', draft: 'Draft', approvalPending: 'Awaiting approval', archived: 'Past cycle' };

/** Source goals in the Goals page's shape. Current goals first, newest deadline first. */
function goalViews(goals: EntityStore['goals'], today: string) {
  const order = (g: EntityStore['goals'][number]) => (g.status === 'archived' ? 1 : 0);
  return [...goals].sort((a, b) => order(a) - order(b) || (b.deadline ?? '').localeCompare(a.deadline ?? '')).map(g => {
    const done = g.keyResults.filter(k => (k.progress ?? 0) >= 100).length;
    const overdue = g.status !== 'archived' && g.deadline !== null && g.deadline < today && (g.progress ?? 0) < 100;
    return {
      id: g.id,
      title: g.title,
      type: g.cycle ? `${g.cycle} · Leapsome` : 'Leapsome',
      status: GOAL_STATUS[g.status] ?? g.status,
      progress: Math.round(g.progress ?? 0),
      target: g.outcome ?? '',
      measure: `${g.keyResults.length} key result${g.keyResults.length === 1 ? '' : 's'}`,
      current: `${done} of ${g.keyResults.length} key results done`,
      due: g.deadline ? new Date(`${g.deadline}T12:00:00`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : 'No deadline',
      linkedProjects: g.projectIds,
      evidence: g.keyResults.map(k => ({
        title: k.name,
        detail: `${Math.round(k.progress ?? 0)}% complete`,
        strength: (k.progress ?? 0) >= 100 ? 'Strong' : (k.progress ?? 0) > 0 ? 'Medium' : 'Not started',
      })),
      risk: g.status === 'archived' ? `From the ${g.cycle ?? 'past'} cycle. Kept as history.`
        : overdue ? `Past its deadline at ${Math.round(g.progress ?? 0)}%.`
        : g.manager ? `Managed with ${g.manager} in Leapsome.` : 'Tracked in Leapsome.',
      sourceUrl: g.source.url,
    };
  });
}

const ACTIVE_PRD = /draft|approved|in-progress|in progress|planned|review/i;

/** A read-only summary of a project's knowledge base, with links into it. */
function knowledgeBase(projectId: string, documents: KnowledgeDocument[], requirements: Requirement[], items: EntityStore['workItems'], config: Config) {
  const slugs = config.relay.projects[projectId];
  if (!slugs?.length) return undefined;
  const docs = documents.filter(d => d.projectId === projectId);
  if (!docs.length) return undefined;
  const linked = new Set(items.filter(w => w.mine).flatMap(w => w.prdIds));
  const prds = requirements.filter(r => r.projectId === projectId);
  const counts: Record<string, number> = {};
  for (const d of docs) counts[d.kind] = (counts[d.kind] ?? 0) + 1;
  const active = prds
    .filter(r => linked.has(r.id) || ACTIVE_PRD.test(r.status))
    .sort((a, b) => Number(linked.has(b.id)) - Number(linked.has(a.id)) || b.updatedAt.localeCompare(a.updatedAt))
    .map(r => ({ code: r.code, title: r.title, status: r.status, url: r.source.url, openQuestions: r.openQuestions.length, linked: linked.has(r.id) }));
  return {
    spaces: slugs.flatMap(s => { const url = relayUrl(config, s); return url ? [{ name: s, url }] : []; }),
    counts,
    active,
    implemented: prds.length - active.length,
    notebooks: docs.filter(d => d.kind === 'notebook' && !/\/index\.md$/.test(d.path))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 6)
      .map(d => ({ title: d.title, url: d.source.url, updatedAt: d.updatedAt.slice(0, 10) })),
  };
}

function prdSummaries(ids: string[], byId: Map<string, Requirement>) {
  const list = ids.map(id => byId.get(id)).filter((r): r is Requirement => !!r);
  return list.length ? list.map(r => ({
    code: r.code, url: r.source.url, title: r.title, status: r.status, acceptanceTotal: r.acceptanceTotal, acceptanceDone: r.acceptanceDone,
    openQuestions: r.openQuestions, neededDependencies: r.neededDependencies, designLinks: r.designLinks,
  })) : undefined;
}

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
