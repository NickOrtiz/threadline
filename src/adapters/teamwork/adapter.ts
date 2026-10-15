// Teamwork adapter: fetch only. No normalization, no scoring.
//
// Auth: Teamwork accepts HTTP Basic with the API key as the username.
// Docs: https://apidocs.teamwork.com/docs/teamwork/v3/tasks/get-projects-api-v3-tasks-json

export interface TeamworkPerson { id: number; firstName: string; lastName: string; email?: string }

/** The subset of a v3 task record that Threadline reads. */
export interface TeamworkTask {
  id: number;
  name: string;
  priority: string | null;
  progress: number | null;
  status: string; // "new" | "reopened" | "completed" | ...
  startDate: string | null;
  dueDate: string | null;
  estimateMinutes: number | null;
  tasklistId?: number;
  tasklist?: { id: number; meta?: { name?: string; projectId?: number } };
  parentTaskId?: number | null;
  parentTask?: { id: number } | null;
  projectId?: number;
  /** The board column(s) the task sits in. stageId 0 means not on a board. */
  workflowStages?: { workflowId: number; stageId: number }[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string | null;
}

export interface TeamworkTasklist { id: number; name: string; projectId: number }
export interface TeamworkProject {
  id: number;
  name: string;
  description?: string | null;
  startAt?: string | null;
  endAt?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  companyId?: number;
  company?: { id: number; name?: string } | null;
}

/** One time log entry. */
export interface TeamworkTimelog {
  id: number;
  minutes: number;
  timeLogged: string;
  isBillable?: boolean;
  billable?: boolean;
  projectId: number | null;
  taskId: number | null;
}

/** One entry in Teamwork's activity log. */
export interface TeamworkActivity {
  id: number;
  activityType: string; // "new" | "edited" | "completed" | "reopened" | "deleted" | ...
  dateTime: string;
  description: string | null;
  extraDescription: string | null;
  item: { id: number; type: string } | null; // type: "tasks" | "comments" | "timelogs" | ...
  itemLink: string | null; // "tasks/19799105" for a comment on that task
  project: { id: number } | null;
}

export interface TeamworkRecords {
  me: TeamworkPerson;
  openTasks: TeamworkTask[];
  completedTasks: TeamworkTask[];
  tasklists: Map<number, TeamworkTasklist>;
  projects: Map<number, TeamworkProject>;
  /** Workflow stage id → stage name, for every board your tasks use. */
  stages: Map<number, string>;
  /** Your own activity log entries, newest first. */
  activities: TeamworkActivity[];
  /** Tasks in your activity that are no longer assigned to you, such as handed-off reviews. */
  touchedTasks: TeamworkTask[];
  /** Your time logs since activitySince. */
  timelogs: TeamworkTimelog[];
}

export interface TeamworkAdapterOptions {
  site: string;
  apiKey: string;
  completedLookbackDays: number;
  /** Your activity from this moment on is fetched, for daily reports. */
  activitySince: Date;
}

export class TeamworkAdapter {
  private readonly opts: TeamworkAdapterOptions;
  constructor(opts: TeamworkAdapterOptions) {
    this.opts = opts;
  }

  async sync(): Promise<TeamworkRecords> {
    const me = (await this.get<{ person: TeamworkPerson }>('/projects/api/v3/me.json')).person;
    const since = new Date(Date.now() - this.opts.completedLookbackDays * 86_400_000).toISOString();
    const base = { responsiblePartyIds: String(me.id), include: 'projects,tasklists', pageSize: '250' };

    const tasklists = new Map<number, TeamworkTasklist>();
    const projects = new Map<number, TeamworkProject>();
    const openTasks = await this.listTasks(base, tasklists, projects);
    const completedTasks = await this.listTasks({ ...base, completedOnly: 'true', completedAfter: since }, tasklists, projects);

    const activities: TeamworkActivity[] = [];
    for (let page = 1; page <= 10; page++) {
      const res = await this.get<{ activities: TeamworkActivity[]; meta?: { page?: { hasMore?: boolean } } }>(
        '/projects/api/v3/latestactivity.json',
        { userIds: String(me.id), startDate: this.opts.activitySince.toISOString(), pageSize: '200', page: String(page) },
      );
      activities.push(...res.activities);
      if (!res.meta?.page?.hasMore) break;
    }

    // Tasks you worked on that are no longer assigned to you.
    const known = new Set([...openTasks, ...completedTasks].map(t => t.id));
    const touchedIds = [...new Set(activities.map(a =>
      a.item?.type === 'tasks' ? a.item.id : Number(a.itemLink?.match(/^tasks\/(\d+)/)?.[1] ?? NaN),
    ))].filter(id => Number.isFinite(id) && !known.has(id));
    const touchedTasks: TeamworkTask[] = [];
    for (let i = 0; i < touchedIds.length; i += 50) {
      const res = await this.get<{ tasks: TeamworkTask[]; included?: { tasklists?: unknown; projects?: unknown } }>('/projects/api/v3/tasks.json', {
        ids: touchedIds.slice(i, i + 50).join(','), includeCompletedTasks: 'true', include: 'projects,tasklists', pageSize: '50',
      });
      touchedTasks.push(...res.tasks);
      for (const tl of values<TeamworkTasklist>(res.included?.tasklists)) tasklists.set(Number(tl.id), tl);
      for (const p of values<TeamworkProject>(res.included?.projects)) projects.set(Number(p.id), p);
    }

    const workflowIds = new Set([...openTasks, ...touchedTasks].flatMap(t => (t.workflowStages ?? []).map(s => s.workflowId)));
    const stages = new Map<number, string>();
    for (const id of workflowIds) {
      const res = await this.get<{ stages: { id: number; name: string }[] }>(`/projects/api/v3/workflows/${id}/stages.json`, { pageSize: '100' });
      for (const s of res.stages) stages.set(s.id, s.name.trim());
    }
    const timelogs: TeamworkTimelog[] = [];
    for (let page = 1; page <= 10; page++) {
      const res = await this.get<{ timelogs: TeamworkTimelog[]; meta?: { page?: { hasMore?: boolean } } }>('/projects/api/v3/time.json', {
        assignedToUserIds: String(me.id), startDate: localDay(this.opts.activitySince), endDate: localDay(new Date()), pageSize: '500', page: String(page),
      });
      timelogs.push(...res.timelogs);
      if (!res.meta?.page?.hasMore) break;
    }
    return { me, openTasks, completedTasks, tasklists, projects, stages, activities, touchedTasks, timelogs };
  }

  private async listTasks(
    params: Record<string, string>,
    tasklists: Map<number, TeamworkTasklist>,
    projects: Map<number, TeamworkProject>,
  ): Promise<TeamworkTask[]> {
    const tasks: TeamworkTask[] = [];
    for (let page = 1; page <= 20; page++) {
      const res = await this.get<{
        tasks: TeamworkTask[];
        included?: { tasklists?: unknown; projects?: unknown };
        meta?: { page?: { hasMore?: boolean } };
      }>('/projects/api/v3/tasks.json', { ...params, page: String(page) });
      tasks.push(...res.tasks);
      for (const tl of values<TeamworkTasklist>(res.included?.tasklists)) tasklists.set(Number(tl.id), tl);
      for (const p of values<TeamworkProject>(res.included?.projects)) projects.set(Number(p.id), p);
      if (!res.meta?.page?.hasMore) break;
    }
    return tasks;
  }

  private async get<T>(path: string, params: Record<string, string> = {}): Promise<T> {
    const url = new URL(path, this.opts.site);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const res = await fetch(url, {
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.opts.apiKey}:x`).toString('base64')}`,
        Accept: 'application/json',
      },
    });
    if (!res.ok) throw new Error(`Teamwork ${res.status} on ${url.pathname}: ${(await res.text()).slice(0, 200)}`);
    return res.json() as Promise<T>;
  }
}

const localDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Teamwork sideloads arrive as an object keyed by id; accept arrays too. */
function values<T>(collection: unknown): T[] {
  if (!collection) return [];
  return (Array.isArray(collection) ? collection : Object.values(collection as object)) as T[];
}
