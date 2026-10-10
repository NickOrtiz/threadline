// Teamwork records → Threadline Project and WorkItem.
//
// Deterministic only. Teamwork already knows titles, dates, estimates,
// and completion, so nothing here guesses.

import type { Activity, Project, WorkItem } from '../../core/schema/entities.ts';
import type { Config } from '../../core/config.ts';
import type { TeamworkActivity, TeamworkProject, TeamworkRecords, TeamworkTask } from './adapter.ts';

const PRIORITY: Record<string, WorkItem['priority']> = { low: 'low', medium: 'normal', high: 'high' };

export function threadlineProjectId(teamworkProjectId: number, config: Config): string {
  return config.teamwork.projects[String(teamworkProjectId)]?.id ?? `tw-${teamworkProjectId}`;
}

/** "Northwind - Website Build (Q2 2026)" → "Northwind". Config aliases win. */
function shortName(project: TeamworkProject, config: Config): string {
  const alias = config.teamwork.projects[String(project.id)]?.name;
  if (alias) return alias;
  return project.name.split(/\s+[-–]\s+|\s+\(/)[0].trim() || project.name;
}

const dateOnly = (v: string | null | undefined) => (v ? v.slice(0, 10) : null);

export function normalizeTeamworkProject(project: TeamworkProject, config: Config, syncedAt: string): Project {
  return {
    id: threadlineProjectId(project.id, config),
    name: shortName(project, config),
    description: project.name,
    client: project.company?.name ?? null,
    startAt: dateOnly(project.startAt ?? project.startDate),
    endAt: dateOnly(project.endAt ?? project.endDate),
    source: { type: 'teamwork', id: String(project.id), url: `${config.teamwork.site}/app/projects/${project.id}`, syncedAt },
  };
}

type StageMeaning = WorkItem['status'] | 'needs_response';

/**
 * Read a status from a board column's name. Boards differ per project, so
 * these are keyword rules; teamwork.stageStatus in the config overrides them.
 * Returns null for a name no rule recognizes.
 */
export function stageMeaning(name: string, overrides: Config['teamwork']['stageStatus']): StageMeaning | null {
  const exact = Object.entries(overrides).find(([k]) => k.trim().toLowerCase() === name.trim().toLowerCase());
  if (exact) return exact[1];
  const n = name.toLowerCase();
  if (/needs? (attn|attention|input|feedback)|feedback shared|changes requested|returned/.test(n)) return 'needs_response';
  if (/blocked|on hold|paused/.test(n)) return 'blocked';
  if (/\b(done|complete|completed|closed|shipped|deployed|live)\b/.test(n)) return 'done';
  if (/review|\bqa\b|testing|approved|ready (for|to) deploy/.test(n)) return 'waiting';
  if (/in progress|doing|started|development|building/.test(n)) return 'in_progress';
  if (/to ?do|planned|planning|backlog|discovery|ready to start|not started|new/.test(n)) return 'open';
  return null;
}

export function normalizeTeamworkTask(task: TeamworkTask, records: TeamworkRecords, config: Config, syncedAt: string, mine = true): WorkItem {
  const tasklistId = task.tasklistId ?? task.tasklist?.id;
  const tasklist = tasklistId ? records.tasklists.get(tasklistId) : undefined;
  const twProjectId = task.projectId ?? tasklist?.projectId ?? task.tasklist?.meta?.projectId;
  const parentId = task.parentTaskId ?? task.parentTask?.id ?? null;
  const done = task.status === 'completed';
  const stageId = task.workflowStages?.find(s => s.stageId)?.stageId;
  const stage = stageId ? records.stages.get(stageId) ?? null : null;
  const meaning = stage && !done ? stageMeaning(stage, config.teamwork.stageStatus) : null;
  // Completion in Teamwork wins. Then the board stage. Then progress.
  const status: WorkItem['status'] = done ? 'done'
    : meaning === 'needs_response' ? 'open'
    : meaning ?? ((task.progress ?? 0) > 0 ? 'in_progress' : 'open');

  return {
    id: `tw-task-${task.id}`,
    projectId: twProjectId ? threadlineProjectId(twProjectId, config) : null,
    threadId: null,
    title: task.name,
    kind: 'task',
    status,
    priority: task.priority ? PRIORITY[task.priority] ?? null : null,
    group: tasklist?.name ?? task.tasklist?.meta?.name ?? null,
    parentId: parentId ? `tw-task-${parentId}` : null,
    startAt: dateOnly(task.startDate),
    dueAt: dateOnly(task.dueDate),
    completedAt: task.completedAt ?? null,
    estimatedMinutes: task.estimateMinutes || null,
    nextAction: meaning === 'needs_response' ? 'Respond to the feedback.' : null,
    blockedBy: meaning === 'waiting' ? [`In ${stage}`] : [],
    codeReview: null,
    stage,
    needsResponse: mine && meaning === 'needs_response',
    mine,
    updatedAt: task.updatedAt,
    source: { type: 'teamwork', id: String(task.id), url: `${config.teamwork.site}/app/tasks/${task.id}`, syncedAt },
  };
}

const ACTIVITY_KIND: Record<string, Activity['kind']> = { edited: 'updated', completed: 'completed', reopened: 'reopened', new: 'created' };

/**
 * The first line of a comment, as a short note. Drops a leading
 * "Task name:" prefix and adds the PR number when a full PR link is present.
 */
export function commentExcerpt(description: string, taskTitle: string): string {
  const firstLine = description.split('\n').map(l => l.replace(/\s+/g, ' ').trim()).find(Boolean) ?? '';
  let text = firstLine;
  const prefix = taskTitle.trim().toLowerCase();
  if (prefix && text.toLowerCase().startsWith(prefix)) text = text.slice(prefix.length).replace(/^[\s:–—-]+/, '');
  if (text.length > 140) text = `${text.slice(0, 137).replace(/\s+\S*$/, '')}…`;
  text = text.charAt(0).toUpperCase() + text.slice(1);
  const pr = description.match(/github\.com\/[^\s/]+\/[^\s/]+\/pull\/(\d+)/);
  if (pr && !text.includes(`#${pr[1]}`)) text = `${text.replace(/[.\s]+$/, '')} (PR #${pr[1]})`;
  return text;
}

/** Your log entries about tasks and task comments. Time logs, files, and the rest are left out. */
export function normalizeTeamworkActivity(a: TeamworkActivity, config: Config, syncedAt: string): Activity | null {
  if (!a.item) return null;
  const projectId = a.project?.id ? threadlineProjectId(a.project.id, config) : null;
  const base = { id: `tw-act-${a.id}`, at: a.dateTime, projectId, source: { type: 'teamwork' as const, id: String(a.id), url: null, syncedAt } };

  if (a.item.type === 'comments') {
    const taskId = a.itemLink?.match(/^tasks\/(\d+)/)?.[1];
    if (!taskId || !a.description) return null;
    const title = a.extraDescription ?? 'Task';
    return { ...base, kind: 'comment', workItemId: `tw-task-${taskId}`, title, text: commentExcerpt(a.description, title), url: `${config.teamwork.site}/app/tasks/${taskId}` };
  }
  if (a.item.type === 'tasks') {
    const kind = ACTIVITY_KIND[a.activityType];
    if (!kind) return null;
    return { ...base, kind, workItemId: `tw-task-${a.item.id}`, title: a.description ?? 'Task', text: null, url: `${config.teamwork.site}/app/tasks/${a.item.id}` };
  }
  return null;
}

export function normalizeTeamwork(records: TeamworkRecords, config: Config, syncedAt: string) {
  const excluded = new Set(config.teamwork.excludeProjectIds);
  const workItems = [
    ...[...records.openTasks, ...records.completedTasks].map(t => normalizeTeamworkTask(t, records, config, syncedAt)),
    ...records.touchedTasks.map(t => normalizeTeamworkTask(t, records, config, syncedAt, false)),
  ]
    .filter(w => !w.projectId || !isExcludedProject(w.projectId, config, excluded));

  // Only projects where the user actually has work. Membership alone is noise.
  const usedProjectIds = new Set(workItems.filter(w => w.mine).map(w => w.projectId));
  const projects = [...records.projects.values()]
    .filter(p => !excluded.has(String(p.id)))
    .map(p => normalizeTeamworkProject(p, config, syncedAt))
    .filter(p => usedProjectIds.has(p.id));

  // Stage names no rule recognizes fall back to progress. Report them so
  // they can be mapped in teamwork.stageStatus.
  const unrecognizedStages = [...new Set(workItems.map(w => w.stage).filter((s): s is string => !!s && stageMeaning(s, config.teamwork.stageStatus) === null))].sort();

  const activities = records.activities
    .map(a => normalizeTeamworkActivity(a, config, syncedAt))
    .filter((a): a is Activity => a !== null && !(a.projectId && isExcludedProject(a.projectId, config, excluded)));

  return { projects, workItems, unrecognizedStages, activities };
}

function isExcludedProject(projectId: string, config: Config, excluded: Set<string>): boolean {
  for (const id of excluded) if (threadlineProjectId(Number(id), config) === projectId) return true;
  return false;
}
