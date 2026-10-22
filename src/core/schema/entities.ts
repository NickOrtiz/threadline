// Threadline domain entities, schema v0.1.
//
// Adapters produce these. Projections read them. The UI never sees them
// directly; it reads the view contract in ./view.ts.

import { z } from 'zod';

export const SourceType = z.enum(['teamwork', 'google-calendar', 'github', 'gitlab', 'malcolm', 'relay', 'leapsome', 'slack', 'email', 'manual', 'fixture']);
export type SourceType = z.infer<typeof SourceType>;

/** Provenance: enough to trace any entity back to the record it came from. */
export const SourceRef = z.object({
  type: SourceType,
  id: z.string(),
  url: z.string().url().nullable(),
  syncedAt: z.string().datetime({ offset: true }),
});
export type SourceRef = z.infer<typeof SourceRef>;

/** A value that a rule or an AI model produced, kept separate from source facts. */
export const Derivation = z.object({
  generatedBy: z.string(), // e.g. "rule:overdue" or "claude"
  generatedAt: z.string().datetime({ offset: true }),
  confidence: z.number().min(0).max(1),
});
export type Derivation = z.infer<typeof Derivation>;

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const IsoDateTime = z.string().datetime({ offset: true });

export const Project = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  client: z.string().nullable(),
  startAt: IsoDate.nullable(),
  endAt: IsoDate.nullable(),
  source: SourceRef,
});
export type Project = z.infer<typeof Project>;

export const WorkItemStatus = z.enum(['open', 'in_progress', 'blocked', 'waiting', 'done']);
export const Priority = z.enum(['low', 'normal', 'high', 'urgent']);
export const WorkItemKind = z.enum(['task', 'pull_request', 'review', 'issue']);

/**
 * Code review state, for pull requests (GitHub) and merge requests (GitLab).
 * Source-neutral, so attention rules never read host-specific fields.
 */
export const CodeReviewState = z.object({
  /** "author": your PR. "reviewer": someone asked you to review theirs. */
  role: z.enum(['author', 'reviewer']),
  state: z.enum(['draft', 'awaiting_review', 'changes_requested', 'approved', 'merged', 'closed']),
  checks: z.enum(['passing', 'failing', 'pending']).nullable(),
  /** Repository and number, e.g. "acme/website #42". */
  ref: z.string(),
  /** People or teams the review waits on. */
  reviewers: z.array(z.string()).default([]),
  /** When review was last requested, or when the PR opened. Null for drafts. */
  waitingSince: z.string().nullable().default(null),
});
export type CodeReviewState = z.infer<typeof CodeReviewState>;

export const WorkItem = z.object({
  id: z.string(),
  projectId: z.string().nullable(),
  threadId: z.string().nullable(),
  title: z.string(),
  kind: WorkItemKind.default('task'),
  status: WorkItemStatus,
  priority: Priority.nullable(),
  /** Grouping inside the source, e.g. a Teamwork tasklist. */
  group: z.string().nullable(),
  parentId: z.string().nullable(),
  startAt: IsoDate.nullable(),
  dueAt: IsoDate.nullable(),
  completedAt: IsoDateTime.nullable(),
  estimatedMinutes: z.number().int().nonnegative().nullable(),
  nextAction: z.string().nullable(),
  blockedBy: z.array(z.string()),
  codeReview: CodeReviewState.nullable().default(null),
  /** The board column or workflow stage, named as the source names it ("In Review"). */
  stage: z.string().nullable().default(null),
  /** The source handed this back to you for a response, such as a "Needs feedback" stage. */
  needsResponse: z.boolean().default(false),
  /**
   * False for work you touched but that is no longer assigned to you, such
   * as a task handed to reviewers. Reports use it; focus and capacity do not.
   */
  mine: z.boolean().default(true),
  /** Requirement documents (PRDs) that describe this work. */
  prdIds: z.array(z.string()).default([]),
  updatedAt: IsoDateTime,
  source: SourceRef,
});
export type WorkItem = z.infer<typeof WorkItem>;

export const EventKind = z.enum(['meeting', 'focus', 'personal', 'out_of_office', 'all_day', 'other']);

export const Event = z.object({
  id: z.string(),
  projectId: z.string().nullable(),
  title: z.string(),
  kind: EventKind,
  startAt: IsoDateTime,
  endAt: IsoDateTime,
  allDay: z.boolean(),
  /** False when the event does not block time (free/transparent, or declined). */
  busy: z.boolean(),
  attendeeCount: z.number().int().nonnegative(),
  source: SourceRef,
});
export type Event = z.infer<typeof Event>;

export const SignalType = z.enum([
  'response_needed', 'deadline_risk', 'overdue', 'stale', 'blocked', 'waiting',
  'review_requested', 'schedule_conflict', 'goal_risk', 'capacity_risk', 'important_change',
]);
export const AttentionLevel = z.enum(['now', 'next', 'watch', 'later', 'fyi']);
export type AttentionLevel = z.infer<typeof AttentionLevel>;

export const Signal = z.object({
  id: z.string(),
  type: SignalType,
  level: AttentionLevel,
  subject: z.object({ kind: z.enum(['workItem', 'event', 'project', 'goal', 'capacity']), id: z.string() }),
  projectId: z.string().nullable(),
  title: z.string(),
  detail: z.string(),
  why: z.string(),
  action: z.string(),
  dueAt: IsoDate.nullable(),
  derivation: Derivation,
});
export type Signal = z.infer<typeof Signal>;

export const ContinuityState = z.object({
  lastActiveAt: IsoDateTime.nullable(),
  lastAction: z.string().nullable(),
  currentIntent: z.string().nullable(),
  whereYouWere: z.string().nullable(),
  openQuestions: z.array(z.string()),
  waitingOn: z.array(z.string()),
  recentDecisions: z.array(z.string()),
  changedSince: z.array(z.string()),
  nextAction: z.string().nullable(),
  restartContext: z.string().nullable(),
});
export type ContinuityState = z.infer<typeof ContinuityState>;

export const KnowledgeType = z.enum([
  'learning', 'decision', 'accomplishment', 'approach', 'pattern', 'problem_to_avoid',
  'technical_finding', 'process_improvement', 'leadership_example', 'goal_evidence',
]);

export const Knowledge = z.object({
  id: z.string(),
  type: KnowledgeType,
  title: z.string(),
  body: z.string(),
  projectId: z.string().nullable(),
  threadId: z.string().nullable(),
  workItemId: z.string().nullable(),
  sourceRefs: z.array(SourceRef),
  tags: z.array(z.string()),
  createdAt: IsoDateTime,
  confidence: z.number().min(0).max(1),
});
export type Knowledge = z.infer<typeof Knowledge>;

export const Goal = z.object({
  id: z.string(),
  title: z.string(),
  /** The desired outcome, in plain text. */
  outcome: z.string().nullable(),
  /** "live", "draft", "approvalPending", or "archived". */
  status: z.string(),
  /** 0–100, as the source reports it. */
  progress: z.number().nullable(),
  deadline: IsoDate.nullable(),
  /** The goal cycle, such as "2026". */
  cycle: z.string().nullable(),
  /** How the goal is measured. */
  keyResults: z.array(z.object({ name: z.string(), progress: z.number().nullable() })),
  manager: z.string().nullable(),
  projectIds: z.array(z.string()).default([]),
  /** Journal or knowledge entries that support the goal. */
  evidenceIds: z.array(z.string()).default([]),
  source: SourceRef,
});
export type Goal = z.infer<typeof Goal>;

/** Something you did in a source: a comment, an update, a completion. */
export const Activity = z.object({
  id: z.string(),
  at: IsoDateTime,
  projectId: z.string().nullable(),
  /** The work item it concerns, when there is one. */
  workItemId: z.string().nullable(),
  kind: z.enum(['comment', 'updated', 'completed', 'reopened', 'created']),
  /** The item's title, such as the task name. */
  title: z.string(),
  /** A short excerpt, such as the first line of a comment. */
  text: z.string().nullable(),
  /** Full links found in the activity, such as pull request URLs. */
  links: z.array(z.string()).default([]),
  url: z.string().nullable(),
  source: SourceRef,
});
export type Activity = z.infer<typeof Activity>;

/** Planned time: hours per working day booked on a project for a date range. */
export const Allocation = z.object({
  id: z.string(),
  projectId: z.string().nullable(),
  projectName: z.string(),
  startAt: IsoDate,
  endAt: IsoDate,
  hoursPerDay: z.number().nonnegative(),
  billable: z.boolean(),
  /** "hard" is confirmed, "soft" is tentative. */
  firmness: z.enum(['hard', 'soft']),
  /** Who manages the project, when the source knows. */
  manager: z.string().nullable(),
  source: SourceRef,
});
export type Allocation = z.infer<typeof Allocation>;

/** Approved or requested time off. */
export const Leave = z.object({
  id: z.string(),
  startAt: IsoDate,
  endAt: IsoDate,
  hours: z.number().nonnegative().nullable(),
  kind: z.string(),
  status: z.string(),
  source: SourceRef,
});
export type Leave = z.infer<typeof Leave>;

/** Time you logged against a project. */
export const TimeLog = z.object({
  id: z.string(),
  projectId: z.string().nullable(),
  workItemId: z.string().nullable(),
  date: IsoDate,
  minutes: z.number().nonnegative(),
  billable: z.boolean(),
  source: SourceRef,
});
export type TimeLog = z.infer<typeof TimeLog>;

/** A requirement document (PRD), reduced to what helps while doing the work. */
export const Requirement = z.object({
  id: z.string(),
  projectId: z.string().nullable(),
  code: z.string().nullable(),
  title: z.string(),
  status: z.string(),
  path: z.string(),
  acceptanceTotal: z.number().int().nonnegative(),
  acceptanceDone: z.number().int().nonnegative(),
  openQuestions: z.array(z.string()),
  /** Dependencies the PRD marks as still needed. */
  neededDependencies: z.array(z.string()),
  designLinks: z.array(z.string()),
  /** Work item ids this PRD names, such as the Teamwork task it was written for. */
  workItemIds: z.array(z.string()),
  updatedAt: IsoDateTime,
  source: SourceRef,
});
export type Requirement = z.infer<typeof Requirement>;

/** One document in a knowledge base, such as a Relay PRD, epic, or notebook page. Metadata only. */
export const KnowledgeDocument = z.object({
  id: z.string(),
  projectId: z.string().nullable(),
  /** The knowledge base's own project, such as a Relay slug. */
  space: z.string(),
  path: z.string(),
  title: z.string(),
  kind: z.enum(['prd', 'epic', 'domain', 'notebook', 'other']),
  status: z.string().nullable(),
  updatedAt: IsoDateTime,
  source: SourceRef,
});
export type KnowledgeDocument = z.infer<typeof KnowledgeDocument>;

/** Everything one sync run produced, before projection. */
export const EntityStore = z.object({
  syncedAt: IsoDateTime,
  user: z.object({ id: z.string(), name: z.string(), initials: z.string() }),
  projects: z.array(Project),
  workItems: z.array(WorkItem),
  events: z.array(Event),
  /** Your own recent activity, for daily reports. Absent in older syncs. */
  activities: z.array(Activity).default([]),
  allocations: z.array(Allocation).default([]),
  leave: z.array(Leave).default([]),
  timeLogs: z.array(TimeLog).default([]),
  requirements: z.array(Requirement).default([]),
  documents: z.array(KnowledgeDocument).default([]),
  goals: z.array(Goal).default([]),
  /** Sources that failed or were skipped this run, so the UI can say so. */
  sourceStatus: z.array(z.object({ type: SourceType, ok: z.boolean(), message: z.string() })),
});
export type EntityStore = z.infer<typeof EntityStore>;
