// The Malcolm import file: raw Malcolm records, as its tools return them.

import { z } from 'zod';

export const MALCOLM_IMPORT_PATH = 'data/imports/malcolm.json';

const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}/);

export const MalcolmImport = z.object({
  importedAt: z.string(),
  /** The Claude model that ran the import, for provenance. */
  model: z.string(),
  from: Day,
  to: Day,
  employee: z.object({
    id: z.number().int(),
    email: z.string(),
    contracted_hours_per_day: z.number().nullable(),
    working_days: z.array(z.string()).nullable(),
  }),
  allocations: z.array(z.object({
    id: z.number().int(),
    project: z.string(),
    project_id: z.number().int(),
    billable: z.boolean().nullable(),
    type: z.string().nullable(),
    hours_per_day: z.number(),
    start_at: Day,
    end_at: Day,
  })),
  projects: z.array(z.object({
    id: z.number().int(),
    name: z.string(),
    teamwork_id: z.number().int().nullable(),
    project_manager: z.string().nullable(),
  })),
  leave: z.array(z.object({
    leave_type: z.string(),
    status: z.string().nullable(),
    start_date: Day,
    end_date: Day,
    hours: z.number().nullable(),
  })),
});
export type MalcolmImport = z.infer<typeof MalcolmImport>;
