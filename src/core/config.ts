import { readFile } from 'node:fs/promises';
import { z } from 'zod';

const HourMinute = z.string().regex(/^\d{2}:\d{2}$/);

/**
 * Where a code host token comes from. Use one:
 *   { "env": "GITHUB_TOKEN_CLIENT" }      a variable in .env
 *   { "gh": { "user": "octocat" } }       a GitHub CLI login (gh auth token)
 */
const TokenSource = z.union([
  z.object({ env: z.string() }),
  z.object({ gh: z.object({ user: z.string().optional() }) }),
]);

export const CodeHost = z.object({
  /** A name for this connection, shown in sync output. */
  id: z.string(),
  type: z.literal('github'),
  /** "github.com", or the hostname of a GitHub Enterprise server. */
  host: z.string().default('github.com'),
  auth: TokenSource,
  /**
   * Allowlist. "owner/repo" or "owner/*" → Threadline project id, or null
   * for work that belongs to no project. Unlisted repos are ignored.
   */
  repos: z.record(z.string(), z.string().nullable()),
});
export type CodeHost = z.infer<typeof CodeHost>;

export const Config = z.object({
  workspace: z.object({ id: z.string(), name: z.string(), mode: z.string() }),
  /** What Threadline calls you. Defaults to your first name in Teamwork. */
  displayName: z.string().optional(),
  /** IANA time zone for "today" and workday hours. Defaults to the system zone. */
  timezone: z.string().optional(),
  workday: z.object({ start: HourMinute, end: HourMinute }),
  teamwork: z.object({
    site: z.string().url(),
    completedLookbackDays: z.number().int().positive().default(30),
    excludeProjectIds: z.array(z.string()).default([]),
    /** Teamwork project id → stable Threadline id and short display name. */
    projects: z.record(z.string(), z.object({ id: z.string(), name: z.string() })).default({}),
    /**
     * Stage name → status, for stages the built-in rules read wrong.
     * "needs_response" means the task came back to you.
     */
    stageStatus: z.record(z.string(), z.enum(['open', 'in_progress', 'blocked', 'waiting', 'done', 'needs_response'])).default({}),
  }),
  calendar: z.object({
    calendarIds: z.array(z.string()).default(['primary']),
    lookaheadDays: z.number().int().positive().default(7),
  }),
  codeHosts: z.array(CodeHost).default([]),
  report: z.object({
    /** How many days back the report page covers, today included. */
    days: z.number().int().min(1).max(30).default(7),
  }).default({ days: 7 }),
  continuity: z.object({
    /** A gap at least this long between sessions shows "while you were away". */
    awayHours: z.number().positive().default(8),
  }).default({ awayHours: 8 }),
  server: z.object({
    port: z.number().int().default(8080),
    /** How often `npm start` re-runs the sync. */
    syncIntervalMinutes: z.number().positive().default(15),
  }).default({ port: 8080, syncIntervalMinutes: 15 }),
});
export type Config = z.infer<typeof Config>;

export async function loadConfig(path = 'threadline.config.json'): Promise<Config> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`${path} not found. Copy threadline.config.example.json to threadline.config.json and edit it.`);
    }
    throw err;
  }
  return Config.parse(JSON.parse(text));
}
