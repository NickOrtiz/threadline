// The view contract: the exact shape app.js renders.
//
// Fixtures in /fixtures and the live data/state.json must both pass
// ThreadlineView. Projections turn domain entities (./entities.ts) into this.

import { z } from 'zod';
import { AttentionLevel } from './entities.ts';

const Continuity = z.object({
  lastActive: z.string(),
  lastAction: z.string().optional(),
  whereYouWere: z.string().optional(),
  openQuestions: z.array(z.string()).optional(),
  changedSince: z.array(z.string()).optional(),
  restart: z.string(),
});

export const AttentionItem = z.object({
  id: z.string(),
  level: AttentionLevel,
  source: z.string(),
  sourceRef: z.string(),
  sourceUrl: z.string().nullable().optional(),
  projectId: z.string().nullable(),
  title: z.string(),
  detail: z.string(),
  why: z.string(),
  due: z.string(),
  action: z.string(),
  estimatedEffort: z.string(),
  status: z.string(),
});

export const Focus = z.object({
  id: z.string(),
  projectId: z.string(),
  threadId: z.string().nullable(),
  sourceUrl: z.string().nullable().optional(),
  title: z.string(),
  description: z.string(),
  reason: z.string(),
  effort: z.string(),
  status: z.string(),
  blockers: z.array(z.string()),
  nextAction: z.string(),
  continuity: Continuity,
});

export const ScheduleItem = z.object({
  id: z.string(),
  time: z.string(),
  title: z.string(),
  meta: z.string(),
  kind: z.enum(['focus', 'meeting', 'open', 'personal']),
});

export const NextUpItem = z.object({
  id: z.string(),
  title: z.string(),
  source: z.string(),
  sourceUrl: z.string().nullable().optional(),
  estimate: z.string(),
  projectId: z.string().nullable(),
  status: z.string(),
});

export const ProjectView = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  status: z.string(),
  progress: z.number().min(0).max(100),
  due: z.string(),
  role: z.string(),
  objective: z.string(),
  nextMilestone: z.string(),
  sourceUrl: z.string().nullable().optional(),
  health: z.record(z.string(), z.string()),
  goals: z.array(z.string()),
  accomplishments: z.array(z.string()),
  decisions: z.array(z.object({ id: z.string(), title: z.string(), date: z.string(), rationale: z.string() })),
  learnings: z.array(z.object({ id: z.string(), type: z.string(), title: z.string(), detail: z.string(), reusable: z.boolean() })),
  weekly: z.object({
    period: z.string(),
    summary: z.string(),
    wins: z.array(z.string()),
    risks: z.array(z.string()),
    next: z.array(z.string()),
  }),
});

export const ThreadView = z.object({
  id: z.string(),
  projectId: z.string(),
  title: z.string(),
  status: z.string(),
  objective: z.string(),
  nextAction: z.string(),
  updated: z.string(),
  notes: z.array(z.object({ id: z.string(), at: z.string(), body: z.string() })),
  openQuestions: z.array(z.string()),
  waitingOn: z.array(z.string()),
  linked: z.array(z.string()),
  continuity: Continuity,
  candidateLearnings: z.array(z.string()),
});

export const GoalView = z.object({
  id: z.string(),
  title: z.string(),
  type: z.string(),
  status: z.string(),
  progress: z.number(),
  target: z.string(),
  measure: z.string(),
  current: z.string(),
  due: z.string(),
  linkedProjects: z.array(z.string()),
  evidence: z.array(z.object({ title: z.string(), detail: z.string(), strength: z.string() })),
  risk: z.string(),
});

export const KnowledgeView = z.object({
  id: z.string(),
  kind: z.string(),
  title: z.string(),
  body: z.string(),
  projectId: z.string().nullable(),
  created: z.string(),
  reusable: z.boolean(),
  tags: z.array(z.string()),
});

export const ReviewView = z.object({
  period: z.string(),
  themes: z.array(z.object({ label: z.string(), count: z.number(), note: z.string() })),
  narrative: z.string(),
});

export const ThreadlineView = z.object({
  meta: z.object({
    workspace: z.object({ id: z.string(), name: z.string(), mode: z.string() }),
    user: z.object({ id: z.string(), name: z.string(), initials: z.string() }),
    generatedAt: z.string(),
    /** "fixture" or "live". Live views also list each source's sync result. */
    dataMode: z.enum(['fixture', 'live']).optional(),
    /** IANA zone the UI uses for the live greeting and date. */
    timezone: z.string().optional(),
    sources: z.array(z.object({ type: z.string(), ok: z.boolean(), message: z.string() })).optional(),
  }),
  daily: z.object({
    /** Snapshot text. Live views recompute both in the browser from greetingName. */
    date: z.string(),
    headline: z.string(),
    /** The name in the greeting, such as "Alex". */
    greetingName: z.string().optional(),
    subhead: z.string(),
    summary: z.string(),
    capacity: z.object({
      focusHours: z.number(),
      meetingsHours: z.number(),
      allocation: z.number(),
      status: z.string(),
    }),
  }),
  focus: Focus.nullable(),
  attention: z.array(AttentionItem),
  schedule: z.array(ScheduleItem),
  nextUp: z.array(NextUpItem),
  projects: z.array(ProjectView),
  threads: z.array(ThreadView),
  goals: z.array(GoalView),
  knowledge: z.array(KnowledgeView),
  review: ReviewView,
});
export type ThreadlineView = z.infer<typeof ThreadlineView>;
export type AttentionItem = z.infer<typeof AttentionItem>;
export type ProjectView = z.infer<typeof ProjectView>;
export type ScheduleItem = z.infer<typeof ScheduleItem>;
export type NextUpItem = z.infer<typeof NextUpItem>;
export type Focus = z.infer<typeof Focus>;
