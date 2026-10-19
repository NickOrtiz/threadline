// Claude plan usage, as Claude Code last reported it to the status line
// script (scripts/claude-statusline.cjs). Read-only here.

import { readFile } from 'node:fs/promises';
import { z } from 'zod';

export const CLAUDE_USAGE_PATH = 'data/claude-usage.json';

const Window = z.object({ usedPercent: z.number(), resetsAt: z.string().nullable() }).nullable();

export const ClaudeUsage = z.object({
  capturedAt: z.string(),
  claudeCodeVersion: z.string().nullable(),
  fiveHour: Window,
  sevenDay: Window,
});
export type ClaudeUsage = z.infer<typeof ClaudeUsage>;

export async function loadClaudeUsage(path = CLAUDE_USAGE_PATH): Promise<ClaudeUsage | null> {
  try {
    return ClaudeUsage.parse(JSON.parse(await readFile(path, 'utf8')));
  } catch {
    return null;
  }
}
