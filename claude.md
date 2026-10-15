# Threadline

## Project overview

In this directory lives a prototype for **Threadline**, a personal/work operating dashboard designed to reduce coordination overhead, protect attention, preserve project context, and turn completed work into reusable knowledge.

This is not intended to become another task manager.

Threadline sits above the tools where work already happens and creates a normalized view of:

* what needs attention
* what should happen next
* what is coming up
* what is blocked
* what is waiting on someone else
* whether available capacity matches planned work
* whether deadlines and goals are realistically on track
* where active work was left
* what was learned from completed work
* what evidence should be retained for future reviews

The dashboard should function as an **attention firewall** between the user and noisy underlying systems.

The primary user experience should feel calm, deliberate, minimal, and highly focused.

---

# Core product loop

Threadline should support this lifecycle:

```text
NOTICE
  ↓
DECIDE
  ↓
EXECUTE
  ↓
CLOSE
  ↓
LEARN
  ↓
REUSE
```

Or, from the user's perspective:

```text
What matters?
    ↓
What should I do?
    ↓
Do the work
    ↓
What happened?
    ↓
What should I remember?
    ↓
How does this help future work?
```

The system should preserve detail without forcing all detail onto the primary dashboard.

---

# Current prototype

The current prototype is intentionally static and data-driven.

Important files include:

```text
index.html
styles.css
app.js
mock-data.js
threadline-schema.example.json
README.md
```

The UI currently consumes dummy Threadline-shaped data.

The mock data exists intentionally.

Do not replace the UI with source-specific logic.

Instead, begin replacing mocked data by introducing integrations underneath the existing normalized data layer.

The desired evolution is:

```text
mock-data.js
      ↓
Threadline normalized data
      ↓
UI
```

becoming:

```text
external sources
      ↓
adapters
      ↓
normalization
      ↓
Threadline data
      ↓
UI
```

The interface should continue consuming the same conceptual data regardless of where it originated.

---

# Architectural rule

The UI must never need to understand the source system.

Avoid patterns like:

```js
renderSlackMessage()
renderGithubTask()
renderGoogleCalendarEvent()
```

Prefer:

```js
renderAttentionItem()
renderWorkItem()
renderEvent()
renderThread()
renderProject()
```

Source metadata may still be retained:

```json
{
  "source": "slack",
  "sourceId": "...",
  "sourceUrl": "..."
}
```

but source systems should not determine the application model.

Threadline owns the application model.

---

# Integration architecture

Use this general pipeline:

```text
SOURCE
Slack / GitHub / Calendar / Teamwork / Email / Obsidian / etc.
        ↓
ADAPTER
Fetch / subscribe / read source-specific information.
        ↓
NORMALIZER
Convert source records into Threadline entities.
        ↓
ENRICHMENT
Optional rules or AI classification.
        ↓
STORAGE
Persist normalized entities and state.
        ↓
PROJECTION
Calculate what matters now.
        ↓
UI
Render Threadline state.
```

MCP is one integration mechanism.

It is not the Threadline architecture itself.

An integration may use:

* MCP
* REST API
* GraphQL
* webhook
* local filesystem
* database
* CLI
* scheduled import
* manual input

All should normalize into the same internal schema.

---

# Integration principles

## 1. Deterministic data before AI

Use deterministic logic whenever the source already knows the answer.

Examples:

Google Calendar knows:

* event title
* start time
* end time
* participants

GitHub knows:

* PR status
* reviewers
* comments
* commits
* timestamps

Do not ask an LLM to infer information that can be obtained reliably from structured data.

Use AI for ambiguity and synthesis.

Examples:

* does this Slack message require a response?
* how important is this relative to current goals?
* what changed while the user was away?
* what accomplishment came from this completed task?
* what lesson should be retained?

---

## 2. AI enriches state; it does not own state

Avoid:

```text
UI → prompt Claude → dashboard response
```

Prefer:

```text
data → normalized state → AI enrichment → stored result → UI
```

AI-generated fields should be attributable and replaceable.

For important classifications, consider storing:

```json
{
  "value": "response_needed",
  "confidence": 0.91,
  "generatedBy": "claude",
  "generatedAt": "..."
}
```

---

## 3. Static JSON must always remain a valid input

Every major view should remain renderable from static JSON fixtures.

This gives us:

* easy development
* reproducible states
* testability
* demo environments
* independence from integrations
* protection against service outages

Useful fixture states will eventually include:

```text
quiet-day
normal-day
busy-day
overloaded
blocked-project
returning-after-weekend
project-close
review-period
```

---

# Core domain concepts

Start with a small number of primitives.

## Project

A sustained body of work.

Examples:

* Northwind
* Juniper
* Atlas
* Threadline

A project may contain:

* threads
* tasks
* events
* milestones
* decisions
* learnings
* accomplishments
* goals
* people
* evidence

---

## Thread

A persistent context around a piece of work.

A Threadline thread is NOT necessarily a Slack thread.

It is a continuing line of work that can span systems.

Example:

```text
Navigation behavior
  ├─ Slack discussion
  ├─ Figma design
  ├─ GitHub PR
  ├─ accessibility finding
  ├─ task
  └─ final decision
```

The thread is the context container.

---

## Work item

Something actionable.

Examples:

* review PR #184
* finalize navigation behavior
* respond to Dana
* prepare talking points

Useful fields include:

```text
id
projectId
threadId
title
status
priority
due
estimatedEffort
nextAction
blockedBy
source
```

---

## Event

Something happening at a particular time.

Examples:

* meeting
* deadline
* focus block
* review
* appointment

Events should normally come from deterministic calendar data.

---

## Signal

Something that may deserve attention.

Examples:

```text
response_needed
deadline_risk
blocked
waiting
review_requested
schedule_conflict
goal_risk
capacity_risk
important_change
```

Signals are a major part of the attention firewall.

They may originate from raw source data or be generated through rules/AI.

---

# Attention model

The dashboard should not display everything.

Incoming information should be classified into a small number of attention buckets.

Recommended:

```text
NOW
Needs intervention or awareness immediately.

NEXT
Likely deserves action soon.

WATCH
Not actionable yet, but worth monitoring.

LATER
Valid work that does not currently deserve attention.

FYI
Useful context with no action required.
```

The system should be conservative about promoting things into `NOW`.

The homepage should stay calm.

---

# Primary dashboard purpose

The homepage should answer:

```text
What matters now?

What should I do next?

What is coming?

Is anything going wrong?

Do I realistically have enough capacity?
```

It should not attempt to summarize the entire workplace.

The homepage is an execution surface.

Detail belongs behind the primary view.

---

# Continuity

Continuity is a first-class feature.

A user should be able to stop working on something Friday and return Monday without reconstructing their mental state.

Each active thread/project should maintain a continuity snapshot.

Suggested shape:

```json
{
  "continuity": {
    "lastActiveAt": "...",
    "lastAction": "...",
    "currentIntent": "...",
    "whereYouWere": "...",
    "openQuestions": [],
    "waitingOn": [],
    "recentDecisions": [],
    "changedSince": [],
    "nextAction": "...",
    "restartContext": "..."
  }
}
```

When returning after a meaningful gap, Threadline should be able to provide:

```text
WHERE YOU LEFT OFF

WHAT CHANGED

WHAT IS STILL OPEN

WHAT TO DO NEXT
```

Example:

```text
You last worked here Friday afternoon.

Where you left off
Responsive navigation was finalized.
Keyboard focus return remained unresolved.

Since then
PR #184 received two comments.
Dana replied about the environment.

Next best action
Resolve the PR comments, then confirm the environment.
```

This information should be derived from actual project activity wherever possible.

---

# Notes and working context

Threads and projects need working notes.

Notes may include:

* observations
* rough thinking
* questions
* references
* implementation detail
* investigation findings

Not every note should become permanent knowledge.

Notes are temporary working memory unless promoted.

---

# Memory model

Threadline should progressively refine information.

Think of memory as:

```text
raw activity
    ↓
working context
    ↓
finding
    ↓
decision / accomplishment / learning
    ↓
project memory
    ↓
reusable knowledge
```

Avoid dumping all activity into a permanent knowledge base.

Promote only information with future value.

---

# Task completion

Completing a task should do more than set:

```json
{
  "complete": true
}
```

Task completion is the first reflection boundary.

When useful, capture:

```text
Outcome
Accomplishment
Decision
Learning
Follow-up
```

AI should propose this based on the task history.

The user should normally only need to confirm or edit.

Example:

```text
Outcome
Mobile navigation behavior finalized.

Accomplishment
Defined and validated responsive navigation interaction before engineering handoff.

Learning
Keyboard semantics should be agreed upon during design exploration rather than after implementation.

Follow-up
Verify implementation after merge.
```

---

# Weekly project reflection

Each active project should maintain a weekly synthesis.

Example structure:

```text
Project
Week

Progress

Accomplishments

Important decisions

Learnings

Problems encountered

Risks

Waiting on

Next week
```

This should primarily be generated from existing project activity.

The user should not have to write a status report from scratch.

---

# Project close

When a project completes, retain a durable project record.

Capture:

```text
Project objective

User's role

Timeline

Major contributions

Problems solved

Architecture / implementation decisions

Accomplishments

Measured outcomes

What worked

What did not work

Problems to avoid next time

Reusable approaches

Important collaborators

Lessons learned

Future opportunities
```

This becomes long-term project memory.

---

# Knowledge types

Do not treat all retained knowledge identically.

Useful categories include:

```text
learning
decision
accomplishment
approach
pattern
problem_to_avoid
technical_finding
process_improvement
leadership_example
goal_evidence
```

Each knowledge object should ideally retain provenance:

```json
{
  "projectId": "...",
  "threadId": "...",
  "workItemId": "...",
  "sourceRefs": [],
  "createdAt": "...",
  "confidence": 1
}
```

We should always be able to understand why Threadline believes something.

---

# Goals

Threadline should support SMART goals as part of execution, not as a separate productivity system.

A goal should connect:

```text
desired outcome
measurement
deadline
projects
milestones
evidence
```

Example:

```text
Goal:
Increase ownership of technical architecture

Measurement:
Lead architecture/discovery on at least 3 projects

Deadline:
December 31

Evidence:
✓ Northwind architecture
✓ Atlas technical review
◐ Juniper environment strategy
```

Threadline should detect when planned work no longer makes a goal realistic.

Goal monitoring should therefore contribute signals to the attention system.

---

# Performance-review evidence

One downstream goal is to make mid-year and annual review preparation much easier.

The system should accumulate evidence over time rather than relying on memory at review time.

Useful evidence dimensions include:

```text
architecture
leadership
delivery
team enablement
ambiguity reduction
cross-functional collaboration
process improvements
problems prevented
technical contributions
design contributions
business outcomes
mentorship
ownership
```

Each claim should ideally link back to actual projects, tasks, decisions, or source activity.

Threadline should eventually be able to answer questions such as:

```text
What did I accomplish this year?

Where did I demonstrate leadership?

What architecture did I own?

Which projects show ambiguity reduction?

What measurable impact did I create?

What recurring strengths appear across projects?

What problems did I prevent?
```

---

# UI philosophy

The interface intentionally favors:

* whitespace
* calm hierarchy
* bold modern typography
* limited visible information
* progressive disclosure
* subtle status indicators
* restrained animation
* low cognitive load

Do not gradually turn the homepage into a traditional enterprise dashboard.

If more information becomes available, prefer:

```text
better prioritization
```

over:

```text
more widgets
```

Threadline should hide complexity intelligently.

---

# Current integration target

The first engineering goal is not to integrate every tool.

The first goal is to prove the adapter/normalization architecture.

Choose one or two low-risk sources.

Good first candidates:

```text
Google Calendar
GitHub
```

Calendar is useful because its data is mostly deterministic.

GitHub is useful because it introduces richer activity and relationships.

Once those are normalized successfully, add communication systems such as Slack where AI classification becomes more useful.

---

# Suggested integration directory structure

As the prototype grows, prefer a structure similar to:

```text
src/
  core/
    schema/
    projections/
    rules/
    scoring/

  adapters/
    calendar/
    github/
    slack/
    teamwork/
    email/
    obsidian/

  intelligence/
    classify/
    summarize/
    reflect/
    prioritize/

  storage/

  fixtures/

  ui/
```

Do not reorganize purely for aesthetic reasons.

Move toward this incrementally as real application code begins replacing the static prototype.

---

# Adapter contract

An adapter should retrieve source-specific records.

Conceptually:

```ts
interface Adapter {
  sync(): Promise<SourceRecord[]>;
}
```

Then a normalizer transforms those records.

Example:

```ts
normalizeCalendarEvent(record): ThreadlineEvent
normalizeGithubPR(record): ThreadlineWorkItem
normalizeSlackMessage(record): ThreadlineActivity
```

Do not combine fetching, AI analysis, storage, and UI rendering into one integration function.

Keep the boundaries explicit.

---

# Provenance

Every normalized entity should retain enough metadata to trace it back to its source.

Recommended:

```json
{
  "source": {
    "type": "github",
    "id": "184",
    "url": "...",
    "syncedAt": "..."
  }
}
```

For AI-derived fields, retain their derivation separately when appropriate.

This will matter for debugging and for user trust.

---

# Derived state / projections

The UI should not query hundreds of records and decide independently what matters.

Create projections.

Examples:

```text
currentFocus
nextActions
attention
todaySchedule
waitingOn
blocked
projectPulse
capacity
goalRisks
continuity
```

For example:

```ts
attention = deriveAttention(allState);
currentFocus = deriveCurrentFocus(allState);
today = deriveToday(events, workItems);
```

This is where deterministic prioritization rules should live.

AI may assist, but the projection layer should remain explicit.

---

# Data ownership

Threadline's normalized state is the product's source of truth for presentation.

External services remain authoritative for their native records.

Example:

GitHub owns:

```text
PR open/closed state
```

Threadline owns:

```text
"This PR currently deserves the user's attention."
```

These are different responsibilities.

## Read-only toward sources

Threadline is a dashboard for viewing and linking information. It never writes to a source system: not Teamwork, GitHub, Calendar, Malcolm, Leapsome, or Relay Cloud.

* Read source records, normalize them, and link back to them.
* Keep anything the user confirms in Threadline, such as knowledge, completion notes, and to-dos, in Threadline's own local storage.
* Do not add "promote to …", "sync back", or any other action that changes a source because of how Threadline is used.

Relay Cloud is the team's knowledge base for tickets: PRDs, epics, and notebooks. Threadline shows it and links into it. It does not copy Relay content into its own knowledge store, and it never writes to Relay.

---

# Integration behavior

When implementing a connection:

1. Inspect the existing normalized mock data.
2. Identify which Threadline entity the source should populate.
3. Build the source adapter.
4. Normalize the source record.
5. Preserve provenance.
6. Add deterministic rules.
7. Add AI enrichment only where useful.
8. Feed the normalized result into the existing UI.
9. Keep the static fixture functioning.
10. Document any new schema fields.

Avoid implementing special UI just because one source exposes unusual metadata.

---

# Immediate development priorities

Start here.

## Phase 1 — Formalize schema

Translate the prototype data model into TypeScript types and/or Zod schemas.

Establish stable primitives for:

```text
Project
Thread
WorkItem
Event
Signal
Knowledge
Goal
ContinuityState
```

Keep the first version intentionally small.

---

## Phase 2 — Preserve fixture mode

Move current dummy content into clean fixtures.

The entire product should still be usable without external services.

---

## Phase 3 — Calendar integration

Normalize calendar events.

Use them to populate:

```text
today
upcoming
availability
focus windows
capacity
deadline awareness
```

Do not involve AI unless needed for optional interpretation.

---

## Phase 4 — GitHub integration

Normalize:

```text
PRs
reviews
comments
issues
commits
requested reviews
recent activity
```

Connect them to Projects and Threads.

Derive relevant attention signals.

---

## Phase 5 — Continuity engine

Use project/thread activity to maintain:

```text
whereYouWere
whatChanged
waitingOn
openQuestions
nextAction
restartContext
```

This should become one of the strongest features in the system.

---

## Phase 6 — Communication sources

Introduce Slack/email/Teamwork.

These sources will require more classification.

Potential pipeline:

```text
message
   ↓
deterministic metadata
   ↓
AI classification
   ↓
activity
   ↓
optional signal
```

Do not surface every communication event.

---

## Phase 7 — Reflection and memory

Introduce task close, weekly reflection, project close, and knowledge promotion.

AI should propose summaries and learnings based on retained evidence.

---

# Important constraint

Do not optimize Threadline for capturing more information.

Optimize it for **requiring less attention from the user while retaining more useful context underneath**.

That distinction is fundamental.

The product succeeds when the user can open it and quickly understand:

```text
what matters
why it matters
what to do
what can wait
```

and then return days later without needing to reconstruct what happened.

---

# Working philosophy for Claude

When modifying this project:

* preserve the normalized-data architecture
* avoid source-specific UI coupling
* prefer simple explicit schemas
* preserve provenance
* prefer deterministic data over AI inference
* use AI primarily for classification, synthesis, prioritization, and reflection
* keep fixtures working
* keep the homepage calm
* preserve progressive disclosure
* treat continuity and memory as first-class features
* avoid introducing unnecessary dependencies
* document schema changes
* favor incremental integrations over large rewrites

If something could make the interface technically richer but cognitively noisier, default against it.

The application should absorb complexity so the user does not have to.
