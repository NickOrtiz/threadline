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

/** A PRD reduced to what helps while doing the work. */
export const PrdSummary = z.object({
  code: z.string().nullable(),
  /** Link into the knowledge base, such as Relay Cloud. */
  url: z.string().nullable().optional(),
  title: z.string(),
  status: z.string(),
  acceptanceTotal: z.number(),
  acceptanceDone: z.number(),
  openQuestions: z.array(z.string()),
  neededDependencies: z.array(z.string()),
  designLinks: z.array(z.string()),
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
  /** Set when the focus is one of your own to-dos, so the UI can complete it. */
  todoId: z.string().optional(),
  /** PRDs that describe this work. */
  prds: z.array(PrdSummary).optional(),
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
  todoId: z.string().optional(),
  /** The first PRD for this work, when there is one. */
  prd: z.object({ code: z.string().nullable(), title: z.string(), openQuestions: z.number() }).optional(),
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
  /** The project's knowledge base (read-only), such as Relay Cloud. */
  knowledgeBase: z.object({
    spaces: z.array(z.object({ name: z.string(), url: z.string() })),
    counts: z.record(z.string(), z.number()),
    /** PRDs still in play (draft, approved, in progress), linked ones first. */
    active: z.array(z.object({ code: z.string().nullable(), title: z.string(), status: z.string(), url: z.string().nullable(), openQuestions: z.number(), linked: z.boolean() })),
    implemented: z.number(),
    notebooks: z.array(z.object({ title: z.string(), url: z.string().nullable(), updatedAt: z.string() })),
  }).optional(),
  /** Recent entries from the work journal for this project. */
  record: z.array(z.object({ date: z.string(), kind: z.string(), title: z.string(), detail: z.string().nullable(), url: z.string().nullable() })).optional(),
  /** This week's booked hours against logged hours. Absent without bookings. */
  week: z.object({
    booked: z.number(), logged: z.number(), remaining: z.number(),
    status: z.enum(['behind', 'on_pace', 'done', 'over']),
    manager: z.string().nullable(),
  }).optional(),
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
  /** The source's board stage, such as "In Review". */
  stage: z.string().nullable().optional(),
  /** In code review: "in_review" waits on a reviewer; "merged" means the PR merged while the ticket is still in review. */
  reviewState: z.enum(['in_review', 'merged']).nullable().optional(),
  /** Links across systems: the task, pull requests, PRDs, and designs. */
  links: z.array(z.object({ label: z.string(), url: z.string(), kind: z.string(), state: z.string().nullable() })).optional(),
  /** What happened on this work, newest first. */
  timeline: z.array(z.object({ date: z.string(), kind: z.string(), text: z.string(), url: z.string().nullable() })).optional(),
  /** Hours you logged on it in the recent time logs. */
  hours: z.number().optional(),
  prds: z.array(PrdSummary).optional(),
  sourceUrl: z.string().nullable().optional(),
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
  sourceUrl: z.string().nullable().optional(),
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

export const TodoView = z.object({
  id: z.string(),
  title: z.string(),
  projectId: z.string().nullable(),
  dueAt: z.string().nullable(),
  due: z.string(),
  estimatedMinutes: z.number().nullable(),
  status: z.enum(['open', 'done']),
  completedAt: z.string().nullable(),
});

export const ContinuityView = z.object({
  /** When you left, as an ISO time. */
  since: z.string(),
  /** "Friday 5:10 PM". */
  sinceLabel: z.string(),
  /** "3 days". */
  awayLabel: z.string(),
  changes: z.array(z.object({
    id: z.string(),
    projectId: z.string().nullable(),
    kind: z.string(),
    text: z.string(),
    url: z.string().nullable(),
  })),
});

const ReportLine = z.object({ workItemId: z.string().nullable(), title: z.string(), detail: z.string(), url: z.string().nullable() });

export const DayReportView = z.object({
  date: z.string(),
  /** "Today", "Yesterday", or "Wednesday, Oct 7". */
  label: z.string(),
  projects: z.array(z.object({
    projectId: z.string().nullable(),
    name: z.string(),
    lines: z.array(ReportLine),
    next: z.array(z.string()),
    waiting: z.array(z.string()),
    /** Slack-formatted text for this project alone. */
    text: z.string(),
  })),
  /** Slack-formatted text for every project that day. */
  text: z.string(),
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
    /** This week's booked hours against your working hours. Absent without bookings. */
    week: z.object({ booked: z.number(), logged: z.number(), available: z.number() }).optional(),
    /** Claude plan usage from Claude Code's status line. Absent until Claude Code reports it. */
    claude: z.object({
      /** When Claude Code last reported usage. Old readings mean no session has run since. */
      capturedAt: z.string(),
      /** True when the reading is old enough that usage elsewhere may have changed it. */
      stale: z.boolean().optional(),
      windows: z.array(z.object({
        label: z.string(),
        usedPercent: z.number(),
        resetsAt: z.string().nullable(),
      })),
    }).optional(),
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
  /** Your own to-dos, open and recently done. Absent in older fixtures. */
  todos: z.array(TodoView).optional(),
  /** "While you were away". Present only after a meaningful gap. */
  continuity: ContinuityView.nullable().optional(),
  /** Your pull requests waiting on reviewers, longest wait first. */
  reviewQueue: z.array(z.object({
    id: z.string(), ref: z.string(), number: z.string(), title: z.string(), url: z.string().nullable(),
    projectId: z.string().nullable(), reviewers: z.array(z.string()), waitingSince: z.string(),
    waitingDays: z.number(), tier: z.enum(['fresh', 'aging', 'stale']), checks: z.string().nullable(),
  })).optional(),
  /** Pull requests where the next move is yours. */
  reviewActions: z.array(z.object({
    id: z.string(), ref: z.string(), number: z.string(), title: z.string(), url: z.string().nullable(), projectId: z.string().nullable(),
    kind: z.enum(['changes', 'checks', 'approved', 'review_request']), days: z.number(),
  })).optional(),
  /** Related tickets worth doing together: in parallel, or back to back. */
  batches: z.array(z.object({
    id: z.string(),
    projectId: z.string(),
    title: z.string(),
    kind: z.enum(['parallel', 'back_to_back']),
    slots: z.number(),
    items: z.array(z.object({ id: z.string(), title: z.string(), url: z.string().nullable(), estimate: z.string(), ready: z.boolean().nullable(), reason: z.string() })),
    estimateMinutes: z.number(),
    unestimated: z.number(),
    rampSavedMinutes: z.tuple([z.number(), z.number()]),
    notes: z.array(z.string()),
    /** Plain text to paste into a worktree or agent tool. */
    brief: z.string(),
  })).optional(),
  /** Daily status reports, newest first. Absent in older fixtures. */
  reports: z.array(DayReportView).optional(),
});
export type ThreadlineView = z.infer<typeof ThreadlineView>;
export type AttentionItem = z.infer<typeof AttentionItem>;
export type ProjectView = z.infer<typeof ProjectView>;
export type ScheduleItem = z.infer<typeof ScheduleItem>;
export type NextUpItem = z.infer<typeof NextUpItem>;
export type Focus = z.infer<typeof Focus>;
