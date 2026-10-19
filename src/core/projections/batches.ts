// Batches: related tickets worth doing together, to cut ramp-up time.
//
// Two kinds, from deterministic rules:
//   parallel     ready, independent tickets in one repo: build side by side,
//                for example with AI agents in separate git worktrees.
//   back to back related tickets that share context or depend on each other:
//                do them in one focus block, so you ramp up once.
// Threadline only suggests. Each batch has a brief to paste into your tool.

import type { Requirement, WorkItem } from '../schema/entities.ts';
import type { RankedItem } from './workload.ts';
import type { ProjectWeek } from './budget.ts';
import { minutesLabel } from '../time.ts';

export interface BatchInput {
  ranked: RankedItem[];
  workItems: WorkItem[];
  requirements: Map<string, Requirement>;
  projectName: (id: string) => string;
  week: Map<string, ProjectWeek>;
  /** Highest Claude usage percentage in effect, or null when unknown. */
  claudeUsedPercent: number | null;
  switchMinutes: [number, number];
  parallelSlots: number;
}

/** "E 5.6 Related Content" → "E 5"; "Core block: List" → "Core block". */
export function familyOf(item: WorkItem): string | null {
  const epic = item.title.match(/^([A-Z]{1,3})\s?(\d+)\.\d+\b/);
  if (epic) return `${epic[1]} ${epic[2]}`;
  const prefix = item.title.match(/^([^:]{3,40}):\s/);
  if (prefix) return prefix[1].trim();
  return item.group;
}

/** Ready to build: no PRD to check, or an approved PRD with no open questions. */
function readiness(item: WorkItem, requirements: Map<string, Requirement>): { ready: boolean | null; reason: string } {
  const prds = item.prdIds.map(id => requirements.get(id)).filter((r): r is Requirement => !!r);
  if (!prds.length) return { ready: null, reason: 'No PRD to check' };
  const questions = prds.reduce((n, r) => n + r.openQuestions.length, 0);
  if (questions) return { ready: false, reason: `${questions} open question${questions === 1 ? '' : 's'} in the PRD` };
  if (prds.some(r => !/approved|implemented/i.test(r.status))) return { ready: false, reason: 'PRD not approved yet' };
  return { ready: true, reason: 'PRD approved, no open questions' };
}

export function deriveBatches(input: BatchInput) {
  // Your actionable work: not stale, not waiting on someone else.
  const work = input.ranked.filter(r => !r.stale && (r.item.status === 'open' || r.item.status === 'in_progress') && r.item.source.type === 'teamwork');

  const groups = new Map<string, RankedItem[]>();
  for (const r of work) {
    const family = familyOf(r.item);
    if (!family || !r.item.projectId) continue;
    const key = `${r.item.projectId}|${family}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }

  // The repo a project's pull requests usually live in, for the brief.
  const repoOf = (projectId: string) => {
    const counts = new Map<string, number>();
    for (const w of input.workItems) {
      const repo = w.codeReview?.ref.split(' #')[0];
      if (w.projectId === projectId && repo) counts.set(repo, (counts.get(repo) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  };

  const batches = [...groups.entries()].filter(([, list]) => list.length >= 2).map(([key, list]) => {
    const [projectId, family] = key.split('|');
    const items = list.map(r => ({ r, ...readiness(r.item, input.requirements) }));

    // Tickets that share a PRD, or where one is the other's parent, would collide in parallel.
    const prdUse = new Map<string, number>();
    for (const { r } of items) for (const id of r.item.prdIds) prdUse.set(id, (prdUse.get(id) ?? 0) + 1);
    const ids = new Set(items.map(x => x.r.item.id));
    const entangled = items.some(({ r }) => r.item.prdIds.some(id => (prdUse.get(id) ?? 0) > 1) || (r.item.parentId && ids.has(r.item.parentId)));
    const allReady = items.every(x => x.ready === true);
    const kind: 'parallel' | 'back_to_back' = allReady && !entangled ? 'parallel' : 'back_to_back';

    const minutes = items.reduce((s, x) => s + (x.r.item.estimatedMinutes ?? 0), 0);
    const unestimated = items.filter(x => !x.r.item.estimatedMinutes).length;
    const switches = items.length - 1;
    const saved: [number, number] = [switches * input.switchMinutes[0], switches * input.switchMinutes[1]];

    const booking = input.week.get(projectId);
    const notes: string[] = [];
    if (booking) notes.push(minutes / 60 <= booking.remaining ? `Fits this week's booking (${booking.remaining} h left).` : `More than this week's booking (${booking.remaining} h left).`);
    if (kind === 'parallel' && input.claudeUsedPercent !== null && input.claudeUsedPercent >= 90) notes.push(`Claude usage is at ${Math.round(input.claudeUsedPercent)}%. Wait for the reset before running AI builds in parallel.`);
    if (kind === 'back_to_back') {
      notes.push(entangled ? 'These tickets share a PRD or depend on each other, so build them in order.'
        : items.some(x => x.ready === false) ? 'Some tickets are not ready to build. Do the ready ones first, in one focus block.'
        : 'Readiness is unknown without PRDs. Do them in one focus block.');
    }

    const name = input.projectName(projectId);
    const repo = repoOf(projectId);
    const slots = Math.min(items.length, input.parallelSlots);
    const brief = [
      `Batch: ${name} · ${family} (${kind === 'parallel' ? `parallel, ${slots} at a time` : 'back to back'})`,
      repo ? `Repo: ${repo}` : null,
      `Estimate: ${minutes ? minutesLabel(minutes) : 'not estimated'}${unestimated ? ` (+${unestimated} without an estimate)` : ''}`,
      '',
      ...items.map((x, i) => {
        const prd = x.r.item.prdIds.map(id => input.requirements.get(id)).find(Boolean);
        return `${i + 1}. ${x.r.item.title}${x.r.item.estimatedMinutes ? ` (${minutesLabel(x.r.item.estimatedMinutes)})` : ''}\n   Ticket: ${x.r.item.source.url ?? '—'}${prd ? `\n   PRD: ${[prd.code, prd.title].filter(Boolean).join(' ')}${prd.source.url ? ` ${prd.source.url}` : ''}` : ''}`;
      }),
      '',
      kind === 'parallel' ? 'Run each ticket in its own worktree, then review them together.' : 'Work through these in order in one session, keeping the shared context open.',
    ].filter(l => l !== null).join('\n');

    return {
      id: `batch-${key.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`,
      projectId,
      title: `${name} · ${family}`,
      kind,
      slots: kind === 'parallel' ? slots : 1,
      items: items.map(x => ({ id: x.r.item.id, title: x.r.item.title, url: x.r.item.source.url, estimate: minutesLabel(x.r.item.estimatedMinutes), ready: x.ready, reason: x.reason })),
      estimateMinutes: minutes,
      unestimated,
      rampSavedMinutes: saved,
      notes,
      brief,
      // Bigger savings and earlier work first.
      score: saved[1] + items.reduce((s, x) => s + x.r.score, 0) / items.length,
    };
  });

  return batches.sort((a, b) => b.score - a.score).slice(0, 6).map(({ score: _s, ...b }) => b);
}
