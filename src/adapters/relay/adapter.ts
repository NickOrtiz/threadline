// Relay Cloud adapter: fetch PRDs. No parsing, no linking.
//
// Lists each mapped project's requirements, then reads only the PRDs whose
// version changed since the last sync. Versions are content hashes, so the
// cache in data/relay-cache.json stays exact.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { McpHttpClient } from './mcp-client.ts';

const CACHE_PATH = 'data/relay-cache.json';

export interface RelayListing { project: string; path: string; updatedAt: string; frontmatter: Record<string, unknown> }

export interface RelayPrd {
  project: string;
  path: string;
  version: string;
  updatedAt: string;
  frontmatter: Record<string, unknown>;
  content: string;
}

interface ListResult { files: { path: string; version: string; updated_at: string; deleted: boolean; frontmatter: Record<string, unknown> }[]; pagination: { returned: number } }
interface ReadResult { files: { path: string; found: boolean; content?: string; version?: string }[] }

export class RelayAdapter {
  private readonly url: string;
  private readonly apiKey: string;
  private readonly slugs: string[];

  constructor(url: string, apiKey: string, slugs: string[]) {
    this.url = url;
    this.apiKey = apiKey;
    this.slugs = slugs;
  }

  async sync(): Promise<{ prds: RelayPrd[]; listings: RelayListing[]; fetched: number }> {
    const client = new McpHttpClient(this.url, this.apiKey);
    await client.connect();
    const cache = await loadCache();
    const prds: RelayPrd[] = [];
    const listings: RelayListing[] = [];
    let fetched = 0;

    for (const project of this.slugs) {
      const files: ListResult['files'] = [];
      for (let offset = 0; offset < 5000; offset += 500) {
        const page = await client.callTool<ListResult>('relay_cloud_list', { project, prefix: 'requirements/', limit: 500, offset });
        files.push(...page.files);
        if (page.pagination.returned < 500) break;
      }
      for (const f of files) if (!f.deleted) listings.push({ project, path: f.path, updatedAt: f.updated_at, frontmatter: f.frontmatter ?? {} });
      const wanted = files.filter(f => !f.deleted && f.path.endsWith('.prd.md'));
      const stale = wanted.filter(f => cache[`${project}:${f.path}`]?.version !== f.version);

      for (let i = 0; i < stale.length; i += 20) {
        const res = await client.callTool<ReadResult>('relay_cloud_read', { project, paths: stale.slice(i, i + 20).map(f => f.path) });
        for (const f of res.files) {
          if (f.found && f.content && f.version) cache[`${project}:${f.path}`] = { version: f.version, content: f.content };
        }
        fetched += res.files.length;
      }

      for (const f of wanted) {
        const cached = cache[`${project}:${f.path}`];
        if (cached) prds.push({ project, path: f.path, version: f.version, updatedAt: f.updated_at, frontmatter: f.frontmatter, content: cached.content });
      }
    }

    await mkdir('data', { recursive: true });
    await writeFile(CACHE_PATH, JSON.stringify(cache));
    return { prds, listings, fetched };
  }
}

async function loadCache(): Promise<Record<string, { version: string; content: string }>> {
  try {
    return JSON.parse(await readFile(CACHE_PATH, 'utf8'));
  } catch {
    return {};
  }
}
