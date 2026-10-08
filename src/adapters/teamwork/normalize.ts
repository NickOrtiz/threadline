// Teamwork records → Threadline Project and WorkItem.
//
// Deterministic only. Teamwork already knows titles, dates, estimates,
// and completion, so nothing here guesses.

import type { Project, WorkItem } from '../../core/schema/entities.ts';
import type { Config } from '../../core/config.ts';
import type { TeamworkProject, TeamworkRecords, TeamworkTask } from './adapter.ts';

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

export function normalizeTeamworkTask(task: TeamworkTask, records: TeamworkRecords, config: Config, syncedAt: string): WorkItem {
  const tasklistId = task.tasklistId ?? task.tasklist?.id;
  const tasklist = tasklistId ? records.tasklists.get(tasklistId) : undefined;
  const twProjectId = task.projectId ?? tasklist?.projectId ?? task.tasklist?.meta?.projectId;
  const parentId = task.parentTaskId ?? task.parentTask?.id ?? null;
  const done = task.status === 'completed';

  return {
    id: `tw-task-${task.id}`,
    projectId: twProjectId ? threadlineProjectId(twProjectId, config) : null,
    threadId: null,
    title: task.name,
    kind: 'task',
    status: done ? 'done' : (task.progress ?? 0) > 0 ? 'in_progress' : 'open',
    priority: task.priority ? PRIORITY[task.priority] ?? null : null,
    group: tasklist?.name ?? task.tasklist?.meta?.name ?? null,
    parentId: parentId ? `tw-task-${parentId}` : null,
    startAt: dateOnly(task.startDate),
    dueAt: dateOnly(task.dueDate),
    completedAt: task.completedAt ?? null,
    estimatedMinutes: task.estimateMinutes || null,
    nextAction: null,
    blockedBy: [],
    codeReview: null,
    updatedAt: task.updatedAt,
    source: { type: 'teamwork', id: String(task.id), url: `${config.teamwork.site}/app/tasks/${task.id}`, syncedAt },
  };
}

export function normalizeTeamwork(records: TeamworkRecords, config: Config, syncedAt: string) {
  const excluded = new Set(config.teamwork.excludeProjectIds);
  const workItems = [...records.openTasks, ...records.completedTasks]
    .map(t => normalizeTeamworkTask(t, records, config, syncedAt))
    .filter(w => !w.projectId || !isExcludedProject(w.projectId, config, excluded));

  // Only projects where the user actually has work. Membership alone is noise.
  const usedProjectIds = new Set(workItems.map(w => w.projectId));
  const projects = [...records.projects.values()]
    .filter(p => !excluded.has(String(p.id)))
    .map(p => normalizeTeamworkProject(p, config, syncedAt))
    .filter(p => usedProjectIds.has(p.id));

  return { projects, workItems };
}

function isExcludedProject(projectId: string, config: Config, excluded: Set<string>): boolean {
  for (const id of excluded) if (threadlineProjectId(Number(id), config) === projectId) return true;
  return false;
}
