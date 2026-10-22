// GitHub records → Threadline WorkItem. Deterministic only.
//
// Only repos on the connection's allowlist become work items. Everything
// else is dropped here and reported by name, never stored.

import type { CodeReviewState, WorkItem } from '../../core/schema/entities.ts';
import type { CodeHost } from '../../core/config.ts';
import type { GithubIssue, GithubPullRequest, GithubRecords } from './adapter.ts';

/**
 * Match "owner/repo" against the allowlist. Patterns may use * as a
 * wildcard ("acme/*", "acme/site-*"). An exact name wins; otherwise the
 * longest matching pattern wins. Returns undefined when unlisted.
 */
export function matchRepo(repo: string, repos: CodeHost['repos']): string | null | undefined {
  const key = repo.toLowerCase();
  let best: { length: number; projectId: string | null } | undefined;
  for (const [pattern, projectId] of Object.entries(repos)) {
    const p = pattern.toLowerCase();
    if (p === key) return projectId;
    if (!p.includes('*')) continue;
    const re = new RegExp(`^${p.split('*').map(part => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')}$`);
    if (re.test(key) && (!best || p.length > best.length)) best = { length: p.length, projectId };
  }
  return best?.projectId;
}

function checksState(pr: GithubPullRequest): CodeReviewState['checks'] {
  const state = pr.commits.nodes[0]?.commit.statusCheckRollup?.state;
  if (!state) return null;
  if (state === 'SUCCESS') return 'passing';
  if (state === 'FAILURE' || state === 'ERROR') return 'failing';
  return 'pending';
}

/**
 * GitHub keeps "changes requested" until the reviewer reviews again, even
 * after the author pushes fixes. Commits or a fresh review request after
 * that review mean the PR waits on the reviewer.
 */
function addressedSince(pr: GithubPullRequest): string | null {
  const reviewedAt = [...(pr.changesRequested?.nodes ?? []), ...pr.latestReviews.nodes.filter(r => r.state === 'CHANGES_REQUESTED')]
    .map(r => r.submittedAt).filter((d): d is string => !!d).sort().at(-1);
  if (!reviewedAt) return null;
  const after = [pr.commits.nodes[0]?.commit.committedDate, pr.timelineItems?.nodes?.[0]?.createdAt].filter((d): d is string => !!d && d > reviewedAt).sort();
  return after.at(-1) ?? null;
}

function reviewState(pr: GithubPullRequest): CodeReviewState['state'] {
  if (pr.state === 'MERGED') return 'merged';
  if (pr.state === 'CLOSED') return 'closed';
  if (pr.isDraft) return 'draft';
  if (pr.reviewDecision === 'CHANGES_REQUESTED') return addressedSince(pr) ? 'awaiting_review' : 'changes_requested';
  if (pr.reviewDecision === 'APPROVED') return 'approved';
  return 'awaiting_review';
}

const NEXT_ACTION: Record<CodeReviewState['state'], string> = {
  draft: 'Finish the draft and request review.',
  awaiting_review: 'Wait for review.',
  changes_requested: 'Address the requested changes.',
  approved: 'Merge it.',
  merged: 'Nothing to do. It is merged.',
  closed: 'Nothing to do. It was closed.',
};

function base(connection: CodeHost, url: string, id: string, syncedAt: string) {
  return {
    threadId: null, priority: null, parentId: null, startAt: null, completedAt: null,
    estimatedMinutes: null, stage: null, needsResponse: false, mine: true, prdIds: [], source: { type: 'github' as const, id: `${connection.host}/${id}`, url, syncedAt },
  };
}

export function normalizeGithubPullRequest(pr: GithubPullRequest, role: 'author' | 'reviewer', projectId: string | null, connection: CodeHost, syncedAt: string): WorkItem {
  const ref = `${pr.repository.nameWithOwner} #${pr.number}`;
  const checks = checksState(pr);
  const state = reviewState(pr);
  const waiting = role === 'author' && state === 'awaiting_review' && checks !== 'failing';

  let nextAction = role === 'reviewer' ? 'Review the PR.' : NEXT_ACTION[state];
  if (role === 'author' && checks === 'failing') nextAction = 'Fix the failing checks.';

  return {
    ...base(connection, pr.url, `${pr.repository.nameWithOwner}/pull/${pr.number}/${role}`, syncedAt),
    id: `gh-${role === 'reviewer' ? 'review' : 'pr'}-${pr.repository.nameWithOwner.replace('/', '-')}-${pr.number}`,
    projectId,
    title: role === 'reviewer' ? `Review: ${pr.title}` : pr.title,
    kind: role === 'reviewer' ? 'review' : 'pull_request',
    status: state === 'merged' || state === 'closed' ? 'done' : waiting ? 'waiting' : state === 'draft' ? 'in_progress' : 'open',
    group: ref,
    dueAt: null,
    nextAction,
    blockedBy: waiting ? ['Reviewer'] : [],
    codeReview: {
      role, state, checks, ref,
      reviewers: (pr.reviewRequests?.nodes ?? []).map(n => n.requestedReviewer?.name || n.requestedReviewer?.login).filter((x): x is string => !!x),
      waitingSince: state === 'draft' ? null : addressedSince(pr) ?? pr.timelineItems?.nodes?.[0]?.createdAt ?? pr.createdAt,
    },
    completedAt: pr.mergedAt ?? pr.closedAt ?? null,
    updatedAt: pr.updatedAt,
  };
}

export function normalizeGithubIssue(issue: GithubIssue, projectId: string | null, connection: CodeHost, syncedAt: string): WorkItem {
  return {
    ...base(connection, issue.url, `${issue.repository.nameWithOwner}/issues/${issue.number}`, syncedAt),
    id: `gh-issue-${issue.repository.nameWithOwner.replace('/', '-')}-${issue.number}`,
    projectId,
    title: issue.title,
    kind: 'issue',
    status: 'open',
    group: `${issue.repository.nameWithOwner} #${issue.number}`,
    dueAt: issue.milestone?.dueOn?.slice(0, 10) ?? null,
    nextAction: null,
    blockedBy: [],
    codeReview: null,
    updatedAt: issue.updatedAt,
  };
}

export function normalizeGithub(records: GithubRecords, syncedAt: string): { workItems: WorkItem[]; ignoredRepos: string[] } {
  const { connection } = records;
  const ignored = new Set<string>();
  const workItems: WorkItem[] = [];

  const allow = (repo: string): { ok: boolean; projectId: string | null } => {
    const projectId = matchRepo(repo, connection.repos);
    if (projectId === undefined) { ignored.add(repo); return { ok: false, projectId: null }; }
    return { ok: true, projectId };
  };

  for (const pr of records.authored) {
    const m = allow(pr.repository.nameWithOwner);
    if (m.ok) workItems.push(normalizeGithubPullRequest(pr, 'author', m.projectId, connection, syncedAt));
  }
  for (const pr of records.reviewRequests) {
    const m = allow(pr.repository.nameWithOwner);
    if (m.ok) workItems.push(normalizeGithubPullRequest(pr, 'reviewer', m.projectId, connection, syncedAt));
  }
  for (const issue of records.issues) {
    const m = allow(issue.repository.nameWithOwner);
    if (m.ok) workItems.push(normalizeGithubIssue(issue, m.projectId, connection, syncedAt));
  }
  return { workItems, ignoredRepos: [...ignored].sort() };
}
