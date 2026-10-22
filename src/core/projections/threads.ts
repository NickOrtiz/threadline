// Threads: one continuing piece of work, followed across systems.
//
// A thread is anchored on a Teamwork task you worked on recently. It
// collects the pull requests named in your comments, the PRD linked to the
// task, the time you logged on it, and its history from the work journal.
// From those it derives continuity: where you left off, what changed since,
// what it is waiting on, and the next step. Deterministic; no AI.
// Your own notes on a thread stay in Threadline (memory/notes.json).

import type { EntityStore, Requirement, WorkItem } from '../schema/entities.ts';
import type { JournalEntry } from '../../storage/journal.ts';
import type { ThreadNote } from '../../storage/notes.ts';
import { addDays, localDate, relativeActivity } from '../time.ts';

/** Work you touched within this many days gets a thread. */
const RECENT_DAYS = 21;
/** Finished work stays visible this long. */
const DONE_DAYS = 3;
const MAX_THREADS = 24;

const PR_URL = /https:\/\/github\.com\/([^\s/]+)\/([^\s/]+)\/pull\/(\d+)/;
const STATE_LABEL: Record<string, string> = {
  draft: 'draft', awaiting_review: 'waiting for review', changes_requested: 'changes requested',
  approved: 'approved', merged: 'merged', closed: 'closed',
};

interface ThreadInput {
  store: EntityStore;
  journal: JournalEntry[];
  notes: Record<string, ThreadNote[]>;
  now: Date;
}

interface PrLink { ref: string; url: string; item: WorkItem | undefined }

export function deriveThreads({ store, journal, notes, now }: ThreadInput) {
  const today = localDate(now);
  const since = addDays(today, -RECENT_DAYS);
  const items = new Map(store.workItems.map(w => [w.id, w]));
  const requirements = new Map(store.requirements.map(r => [r.id, r]));
  const projectName = new Map(store.projects.map(p => [p.id, p.name]));

  // Everything you did, per work item: the journal plus recent activity not yet journaled.
  // Journal entries first; recent activity fills in links (older journal
  // entries predate link capture) and anything not journaled yet.
  const byId = new Map<string, JournalEntry>();
  for (const e of journal) if (e.workItemId && e.kind !== 'time') byId.set(e.id, { ...e, links: e.links ?? [] });
  for (const a of store.activities) {
    if (!a.workItemId || (a.kind !== 'comment' && a.kind !== 'completed' && a.kind !== 'reopened')) continue;
    const existing = byId.get(a.id);
    if (existing) { if (!existing.links.length) existing.links = a.links; continue; }
    byId.set(a.id, {
      id: a.id, at: a.at, date: localDate(new Date(a.at)), kind: a.kind, projectId: a.projectId, workItemId: a.workItemId,
      title: a.title, detail: a.text, url: a.url, source: a.source.type, links: a.links,
    });
  }
  const events = new Map<string, JournalEntry[]>();
  for (const e of byId.values()) events.set(e.workItemId!, [...(events.get(e.workItemId!) ?? []), e]);

  const anchors = store.workItems.filter(w => {
    if (w.source.type !== 'teamwork') return false;
    const recent = (events.get(w.id) ?? []).some(e => e.date >= since);
    if (w.status === 'done') return (events.get(w.id) ?? []).some(e => e.date >= addDays(today, -DONE_DAYS));
    return recent || (w.mine && w.status === 'in_progress');
  });

  const usedPrs = new Set<string>();
  const threads = anchors.map(task => {
    const history = (events.get(task.id) ?? []).sort((a, b) => b.at.localeCompare(a.at));
    const prs = pullRequests(history, items);
    // A pull request titled exactly like the task, in the same project, is the same work.
    for (const pr of store.workItems) {
      if (pr.kind !== 'pull_request' || pr.projectId !== task.projectId || pr.title.trim().toLowerCase() !== task.title.trim().toLowerCase()) continue;
      if (!prs.some(p => p.item?.id === pr.id)) prs.push({ ref: `PR #${pr.codeReview?.ref.split('#')[1] ?? ''}`, url: pr.source.url ?? '', item: pr });
    }
    prs.forEach(p => p.item && usedPrs.add(p.item.id));
    return build(task, history, prs, task.prdIds.map(id => requirements.get(id)).filter((r): r is Requirement => !!r));
  });

  // Your open pull requests that no task mentions get a thread of their own.
  for (const pr of store.workItems) {
    if (pr.kind !== 'pull_request' || pr.status === 'done' || usedPrs.has(pr.id) || !pr.projectId) continue;
    const ref = pr.codeReview?.ref ?? pr.title;
    threads.push(build(pr, (events.get(pr.id) ?? []), [{ ref: `PR #${ref.split('#')[1] ?? ''}`, url: pr.source.url ?? '', item: pr }], []));
  }

  const order = { Active: 0, Waiting: 1, 'Handed off': 2, Done: 3 } as Record<string, number>;
  return threads
    .sort((a, b) => order[a.status] - order[b.status] || b.lastActiveAt.localeCompare(a.lastActiveAt))
    .slice(0, MAX_THREADS)
    .map(({ lastActiveAt: _l, mergedButWaiting: _m, ...t }) => t);

  function build(task: WorkItem, history: JournalEntry[], prs: PrLink[], prds: Requirement[]) {
    const yours = history.filter(e => e.kind === 'comment' || e.kind === 'completed' || e.kind === 'reopened');
    const lastYours = yours[0];
    const lastActiveAt = history[0]?.at ?? task.updatedAt;
    const openPrs = prs.filter(p => p.item && p.item.status !== 'done');
    const stateOf = (p: PrLink) => p.item?.codeReview?.state;


    const waitingOn = [
      ...(task.status === 'waiting' && task.stage ? [`${task.stage}`] : []),
      ...(!task.mine && task.status !== 'done' ? [`Assigned to others${task.stage ? `, in ${task.stage}` : ''}`] : []),
      ...openPrs.filter(p => stateOf(p) === 'awaiting_review').map(p => `Review on ${p.ref}`),
    ];

    const changes = openPrs.find(p => stateOf(p) === 'changes_requested');
    const failing = openPrs.find(p => p.item?.codeReview?.checks === 'failing');
    const approved = openPrs.find(p => stateOf(p) === 'approved');
    // Every linked PR is merged, but the task still waits in a review stage.
    const mergedButWaiting = task.mine && task.status === 'waiting' && prs.length > 0 && prs.every(p => stateOf(p) === 'merged');
    // Something on the thread needs you, whatever the board stage says.
    const needsYou = task.status !== 'done' && (!!changes || !!failing || !!approved || task.needsResponse);
    const status = task.status === 'done' ? 'Done'
      : needsYou ? 'Active'
      : !task.mine ? 'Handed off'
      : task.status === 'waiting' || task.status === 'blocked' ? 'Waiting'
      : 'Active';

    const nextAction = task.status === 'done' ? 'Nothing left to do.'
      : mergedButWaiting ? `${prs.map(p => p.ref).join(', ')} ${prs.length === 1 ? 'is' : 'are'} merged. The ticket can leave ${task.stage ?? 'review'} when the reviewer closes it out.`
      : changes ? `Address the requested changes on ${changes.ref}.`
      : failing ? `Fix the failing checks on ${failing.ref}.`
      : task.needsResponse ? 'Respond to the feedback.'
      : approved ? `Merge ${approved.ref}.`
      : status === 'Handed off' ? 'Nothing for you until it comes back.'
      : status === 'Waiting' ? `Nothing for you until ${waitingOn[0] ?? 'it moves'}.`
      : task.nextAction ?? (prs.length ? `Continue on ${prs[0].ref}.` : 'Continue the work.');

    // What moved after your last comment: stage changes and PR state.
    const changedSince = [
      ...history.filter(e => e.kind === 'stage' && (!lastYours || e.at > lastYours.at)).map(e => `Moved: ${e.detail}`),
      ...prs.filter(p => p.item && (!lastYours || p.item.updatedAt > lastYours.at) && stateOf(p) && stateOf(p) !== 'awaiting_review')
        .map(p => `${p.ref}: ${STATE_LABEL[stateOf(p)!]}`),
    ];

    const whereYouWere = [
      lastYours?.detail ? `Your last note: "${lastYours.detail}"` : null,
      task.stage ? `Now in ${task.stage}.` : null,
    ].filter(Boolean).join(' ') || 'No updates from you yet.';

    const links = [
      ...(task.source.url ? [{ label: task.source.type === 'github' ? (task.codeReview?.ref ?? 'Pull request') : 'Teamwork task', url: task.source.url, kind: task.source.type, state: null }] : []),
      ...prs.filter(p => p.url && p.url !== task.source.url).map(p => ({ label: p.ref, url: p.url, kind: 'github', state: stateOf(p) ? STATE_LABEL[stateOf(p)!] : null })),
      ...prds.map(r => ({ label: [r.code, r.title].filter(Boolean).join(' · '), url: r.source.url ?? '', kind: 'relay', state: r.status })),
      ...[...new Set(prds.flatMap(r => r.designLinks))].slice(0, 2).map((url, i) => ({ label: i ? 'Design (Figma) 2' : 'Design (Figma)', url, kind: 'figma', state: null })),
    ].filter(l => l.url);

    const hours = store.timeLogs.filter(t => t.workItemId === task.id).reduce((s, t) => s + t.minutes, 0) / 60;

    return {
      id: `thread-${task.id}`,
      projectId: task.projectId ?? '',
      title: task.title,
      status,
      stage: task.stage,
      objective: prds[0] ? `Deliver ${prds[0].title}${prds[0].code ? ` (${prds[0].code})` : ''}.` : task.group ? `${projectName.get(task.projectId ?? '') ?? ''} · ${task.group}`.replace(/^ · /, '') : '',
      nextAction,
      updated: relativeActivity(lastActiveAt, now),
      notes: (notes[`thread-${task.id}`] ?? []).map(n => ({ id: n.id, at: relativeActivity(n.at, now), body: n.body })),
      openQuestions: prds.flatMap(r => r.openQuestions),
      waitingOn,
      linked: links.map(l => l.label),
      links,
      timeline: history.slice(0, 14).map(e => ({ date: e.date, kind: e.kind, text: e.detail ?? e.title, url: e.url })),
      hours: Math.round(hours * 10) / 10,
      prds: prds.map(r => ({ code: r.code, url: r.source.url, title: r.title, status: r.status, acceptanceTotal: r.acceptanceTotal, acceptanceDone: r.acceptanceDone, openQuestions: r.openQuestions, neededDependencies: r.neededDependencies, designLinks: r.designLinks })),
      sourceUrl: task.source.url,
      continuity: {
        lastActive: relativeActivity(lastActiveAt, now),
        whereYouWere,
        changedSince,
        restart: openPrs[0] ? `Open ${openPrs[0].ref}${prds[0] ? ` beside ${prds[0].code ?? 'the PRD'}` : ''}.` : prds[0] ? `Re-read ${prds[0].code ?? 'the PRD'}, then open the task.` : 'Open the task and read the latest comment.',
      },
      candidateLearnings: [],
      /** In code review: waiting on a reviewer, or merged while the ticket is still in review. */
      reviewState: status === 'Done' || needsYou ? null
        : mergedButWaiting ? 'merged'
        : openPrs.some(p => stateOf(p) === 'awaiting_review') || /review|qa/i.test(task.stage ?? '') ? 'in_review'
        : null,
      mergedButWaiting,
      lastActiveAt,
    };
  }
}

/** Pull requests named in a thread's history, matched to the PRs Threadline knows. */
function pullRequests(history: JournalEntry[], items: Map<string, WorkItem>): PrLink[] {
  const urls = [...new Set(history.flatMap(e => e.links ?? []).filter(u => PR_URL.test(u)))];
  return urls.map(url => {
    const [, owner, repo, number] = url.match(PR_URL)!;
    const item = items.get(`gh-pr-${owner}-${repo}-${number}`);
    return { ref: `PR #${number}`, url, item };
  });
}
