// The Leapsome import file: your goals and key results, as Leapsome returns them.

import { z } from 'zod';

export const LEAPSOME_IMPORT_PATH = 'data/imports/leapsome.json';

export const LeapsomeImport = z.object({
  importedAt: z.string(),
  /** The Claude model that ran the import, for provenance. */
  model: z.string(),
  manager: z.string().nullable(),
  goals: z.array(z.object({
    id: z.string(),
    name: z.string(),
    /** Plain text, without HTML. */
    description: z.string().nullable(),
    progress: z.number().nullable(),
    /** "live", "draft", "approvalPending", or "archived". */
    status: z.string(),
    deadline: z.string().nullable(),
    cycle: z.string().nullable(),
    keyResults: z.array(z.object({ name: z.string(), progress: z.number().nullable() })),
  })),
});
export type LeapsomeImport = z.infer<typeof LeapsomeImport>;
