// Malcolm import file → Threadline Allocation and Leave. Deterministic.

import type { Allocation, Leave } from '../../core/schema/entities.ts';
import type { Config } from '../../core/config.ts';
import { threadlineProjectId } from '../teamwork/normalize.ts';
import type { MalcolmImport } from './schema.ts';

/** Malcolm books time off as allocations on "Leave - …" projects. Those are leave, not work. */
const isLeaveProject = (name: string) => /^leave\b/i.test(name.trim());

export function normalizeMalcolm(data: MalcolmImport, config: Config, syncedAt: string): { allocations: Allocation[]; leave: Leave[] } {
  const projects = new Map(data.projects.map(p => [p.id, p]));
  const source = (id: string) => ({ type: 'malcolm' as const, id, url: null, syncedAt });

  const allocations = data.allocations
    .filter(a => !isLeaveProject(a.project))
    .map((a): Allocation => {
      const project = projects.get(a.project_id);
      return {
        id: `malcolm-alloc-${a.id}`,
        projectId: project?.teamwork_id ? threadlineProjectId(project.teamwork_id, config) : null,
        projectName: a.project,
        startAt: a.start_at.slice(0, 10),
        endAt: a.end_at.slice(0, 10),
        hoursPerDay: a.hours_per_day,
        billable: a.billable ?? true,
        firmness: (a.type ?? '').toLowerCase() === 'soft' ? 'soft' : 'hard',
        manager: project?.project_manager ?? null,
        source: source(String(a.id)),
      };
    });

  const leave = data.leave
    .filter(l => !/denied|rejected|cancel/i.test(l.status ?? ''))
    .map((l, i): Leave => ({
      id: `malcolm-leave-${l.start_date}-${i}`,
      startAt: l.start_date.slice(0, 10),
      endAt: l.end_date.slice(0, 10),
      hours: l.hours,
      kind: l.leave_type.replace(/^Leave\s*-\s*/i, ''),
      status: l.status ?? 'Approved',
      source: source(`leave-${l.start_date}`),
    }));

  return { allocations, leave };
}
