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

export interface TeamworkRecords {
  me: TeamworkPerson;
  openTasks: TeamworkTask[];
  completedTasks: TeamworkTask[];
  tasklists: Map<number, TeamworkTasklist>;
  projects: Map<number, TeamworkProject>;
}

export interface TeamworkAdapterOptions {
  site: string;
  apiKey: string;
  completedLookbackDays: number;
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
    return { me, openTasks, completedTasks, tasklists, projects };
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

/** Teamwork sideloads arrive as an object keyed by id; accept arrays too. */
function values<T>(collection: unknown): T[] {
  if (!collection) return [];
  return (Array.isArray(collection) ? collection : Object.values(collection as object)) as T[];
}
