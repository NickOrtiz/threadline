// GitHub adapter: fetch only.
//
// One GraphQL call per connection returns your open PRs, review requests,
// and assigned issues. The search covers every repo the token can see, so
// work/personal filtering happens in the normalizer, against the allowlist.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { CodeHost } from '../../core/config.ts';

const run = promisify(execFile);

export interface GithubPullRequest {
  number: number;
  title: string;
  url: string;
  isDraft: boolean;
  createdAt: string;
  updatedAt: string;
  reviewDecision: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null;
  state: 'OPEN' | 'MERGED' | 'CLOSED';
  mergedAt: string | null;
  closedAt: string | null;
  repository: { nameWithOwner: string };
  latestReviews: { nodes: { state: string; submittedAt: string | null }[] };
  commits: { nodes: { commit: { statusCheckRollup: { state: string } | null } }[] };
}

export interface GithubIssue {
  number: number;
  title: string;
  url: string;
  createdAt: string;
  updatedAt: string;
  repository: { nameWithOwner: string };
  milestone: { dueOn: string | null } | null;
}

export interface GithubRecords {
  connection: CodeHost;
  login: string;
  authored: GithubPullRequest[];
  reviewRequests: GithubPullRequest[];
  issues: GithubIssue[];
}

const QUERY = `
query($authored: String!, $review: String!, $issues: String!) {
  viewer { login }
  authored: search(query: $authored, type: ISSUE, first: 100) { nodes { ...PR } }
  review: search(query: $review, type: ISSUE, first: 100) { nodes { ...PR } }
  issues: search(query: $issues, type: ISSUE, first: 100) {
    nodes { ... on Issue { number title url createdAt updatedAt repository { nameWithOwner } milestone { dueOn } } }
  }
}
fragment PR on PullRequest {
  number title url isDraft createdAt updatedAt reviewDecision state mergedAt closedAt
  repository { nameWithOwner }
  latestReviews(first: 10) { nodes { state submittedAt } }
  commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
}`;

export class GithubAdapter {
  private readonly connection: CodeHost;
  constructor(connection: CodeHost) {
    this.connection = connection;
  }

  async sync(): Promise<GithubRecords> {
    const token = await resolveToken(this.connection);
    const endpoint = this.connection.host === 'github.com'
      ? 'https://api.github.com/graphql'
      : `https://${this.connection.host}/api/graphql`;

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: QUERY,
        variables: {
          // Open PRs, plus any closed or merged in the last 14 days, so threads can show them.
          authored: `is:pr author:@me archived:false updated:>=${new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10)}`,
          review: 'is:open is:pr review-requested:@me archived:false',
          issues: 'is:open is:issue assignee:@me archived:false',
        },
      }),
    });
    if (!res.ok) throw new Error(`GitHub ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const body = await res.json() as {
      data?: {
        viewer: { login: string };
        authored: { nodes: GithubPullRequest[] };
        review: { nodes: GithubPullRequest[] };
        issues: { nodes: GithubIssue[] };
      };
      errors?: { message: string }[];
    };
    if (!body.data) throw new Error(`GitHub: ${body.errors?.map(e => e.message).join('; ') ?? 'no data'}`);

    // Search can return empty nodes for types the fragment does not match.
    const real = <T extends { number?: number }>(nodes: T[]) => nodes.filter(n => n.number);
    return {
      connection: this.connection,
      login: body.data.viewer.login,
      authored: real(body.data.authored.nodes),
      reviewRequests: real(body.data.review.nodes),
      issues: real(body.data.issues.nodes),
    };
  }
}

async function resolveToken(connection: CodeHost): Promise<string> {
  const { auth } = connection;
  if ('env' in auth) {
    const token = process.env[auth.env];
    if (!token) throw new Error(`${auth.env} is not set in .env`);
    return token;
  }
  const args = ['auth', 'token', '--hostname', connection.host];
  if (auth.gh.user) args.push('--user', auth.gh.user);
  try {
    return (await run('gh', args)).stdout.trim();
  } catch {
    throw new Error(`No GitHub CLI login for ${auth.gh.user ?? 'the active account'} on ${connection.host}. Run: gh auth login --hostname ${connection.host}`);
  }
}
