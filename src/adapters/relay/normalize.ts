// Relay PRD markdown → Threadline Requirement. Deterministic parsing of the
// Relay PRD template: acceptance criteria checkboxes, the Open Questions
// and Dependencies tables, design links, and Teamwork task URLs.

import type { KnowledgeDocument, Requirement } from '../../core/schema/entities.ts';
import type { Config } from '../../core/config.ts';
import type { RelayListing, RelayPrd } from './adapter.ts';

/** A link into Relay Cloud for a document, or for its project when no document pattern is set. Null without link settings. */
export function relayUrl(config: Config, project: string, path?: string): string | null {
  const template = path && config.relay.documentUrl ? config.relay.documentUrl : config.relay.projectUrl;
  if (!template) return null;
  // Relay's portal serves requirements/01-devops/1-wp-engine-deploy/index.md
  // at /projects/<slug>/docs/01-devops/1-wp-engine-deploy.
  const docPath = (path ?? '').replace(/^requirements\//, '').replace(/\/index\.md$/, '').replace(/\.md$/, '');
  return template.replace('{project}', encodeURIComponent(project)).replace('{path}', docPath);
}

const relayProjectOwner = (config: Config, slug: string) => Object.entries(config.relay.projects).find(([, slugs]) => slugs.includes(slug))?.[0] ?? null;

export function normalizeRelayListing(l: RelayListing, config: Config, syncedAt: string): KnowledgeDocument {
  const title = typeof l.frontmatter.title === 'string' ? l.frontmatter.title : l.path.split('/').slice(-2).join('/').replace(/\.(prd\.)?md$/, '');
  const kind: KnowledgeDocument['kind'] = l.path.endsWith('.prd.md') ? 'prd'
    : l.path.startsWith('requirements/notebooks/') ? 'notebook'
    : /^EPC-/.test(title) ? 'epic'
    : /^DOM-/.test(title) ? 'domain'
    : 'other';
  return {
    id: `relay:${l.project}:${l.path}`,
    projectId: relayProjectOwner(config, l.project),
    space: l.project,
    path: l.path,
    title,
    kind,
    status: typeof l.frontmatter.status === 'string' ? l.frontmatter.status : null,
    updatedAt: l.updatedAt,
    source: { type: 'relay', id: `${l.project}/${l.path}`, url: relayUrl(config, l.project, l.path), syncedAt },
  };
}

/** The body of a "## Heading" section, up to the next "## " heading. */
function section(markdown: string, heading: string): string {
  const lines = markdown.split('\n');
  const start = lines.findIndex(l => new RegExp(`^##\\s+${heading}\\b`, 'i').test(l.trim()));
  if (start < 0) return '';
  const end = lines.findIndex((l, i) => i > start && /^##\s/.test(l.trim()));
  return lines.slice(start + 1, end < 0 ? undefined : end).join('\n');
}

/** Rows of the first markdown table in a section, keyed by lower-case header. */
function tableRows(text: string): Record<string, string>[] {
  const rows = text.split('\n').filter(l => l.trim().startsWith('|'));
  if (rows.length < 2) return [];
  const cells = (l: string) => l.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
  const headers = cells(rows[0]).map(h => h.toLowerCase());
  return rows.slice(2).map(r => Object.fromEntries(cells(r).map((c, i) => [headers[i] ?? String(i), c])));
}

export function parsePrd(content: string) {
  const body = content.replace(/^---[\s\S]*?\n---\n/, '');
  const criteria = [...body.matchAll(/^\s*-\s*\[( |x|X)\]\s*AC-\d+/gm)];
  const openQuestions = tableRows(section(body, 'Open Questions'))
    .filter(r => (r.status ?? '').toLowerCase() === 'open')
    .map(r => r.question ?? Object.values(r)[1] ?? '')
    .filter(Boolean);
  const dependencies = section(body, 'Dependencies');
  const neededDependencies = tableRows(dependencies)
    .filter(r => (r.status ?? '').toLowerCase() === 'needed')
    .map(r => r.dependency ?? Object.values(r)[0] ?? '')
    .filter(Boolean);
  const designLinks = [...new Set(body.match(/https:\/\/(www\.)?figma\.com\/[^\s)>\]]+/g) ?? [])];
  // Task URLs in the Dependencies table name related tasks, not this PRD's own task.
  const ownText = body.replace(dependencies, '');
  const taskIds = [...new Set([...ownText.matchAll(/teamwork\.com\/app\/tasks\/(\d+)/g)].map(m => m[1]))];
  return {
    acceptanceTotal: criteria.length,
    acceptanceDone: criteria.filter(m => m[1].toLowerCase() === 'x').length,
    openQuestions,
    neededDependencies,
    designLinks,
    taskIds,
  };
}

export function normalizeRelayPrd(prd: RelayPrd, config: Config, syncedAt: string): Requirement {
  const fm = prd.frontmatter;
  const projectId = relayProjectOwner(config, prd.project);
  const parsed = parsePrd(prd.content);
  return {
    id: `relay:${prd.project}:${prd.path}`,
    projectId,
    code: typeof fm.code === 'string' ? fm.code : null,
    title: typeof fm.title === 'string' ? fm.title : prd.path.split('/').pop()!.replace('.prd.md', ''),
    status: typeof fm.status === 'string' ? fm.status : 'unknown',
    path: prd.path,
    acceptanceTotal: parsed.acceptanceTotal,
    acceptanceDone: parsed.acceptanceDone,
    openQuestions: parsed.openQuestions,
    neededDependencies: parsed.neededDependencies,
    designLinks: parsed.designLinks,
    workItemIds: parsed.taskIds.map(id => `tw-task-${id}`),
    updatedAt: prd.updatedAt,
    source: { type: 'relay', id: `${prd.project}/${prd.path}`, url: relayUrl(config, prd.project, prd.path), syncedAt },
  };
}

/**
 * Link work items to PRDs: a Teamwork task URL inside the PRD, or a PRD
 * code such as "PRD-03.2.01" in the work item's title.
 */
export function linkRequirements<T extends { id: string; title: string; prdIds: string[] }>(items: T[], requirements: Requirement[]): T[] {
  const byCode = new Map(requirements.filter(r => r.code).map(r => [r.code!.toUpperCase(), r.id]));
  const byItem = new Map<string, string[]>();
  for (const r of requirements) for (const w of r.workItemIds) byItem.set(w, [...(byItem.get(w) ?? []), r.id]);
  return items.map(item => {
    const codes = [...item.title.toUpperCase().matchAll(/PRD-\d{1,2}\.\d{1,2}\.\d{1,2}/g)].map(m => byCode.get(m[0])).filter((x): x is string => !!x);
    const ids = [...new Set([...(byItem.get(item.id) ?? []), ...codes])];
    return ids.length ? { ...item, prdIds: ids } : item;
  });
}
