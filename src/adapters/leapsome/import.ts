// npm run import:leapsome
//
// Leapsome's personal API is not available to us, so Claude Code reads your
// goals through the Leapsome connector (see ../claude-import.ts). The result
// is validated and written to data/imports/leapsome.json.

import { mkdir, writeFile } from 'node:fs/promises';
import { loadConfig } from '../../core/config.ts';
import { claudeImport } from '../claude-import.ts';
import { LEAPSOME_IMPORT_PATH, LeapsomeImport } from './schema.ts';

const config = await loadConfig();

const { data, costUsd } = await claudeImport({
  model: config.leapsome.model,
  schema: LeapsomeImport.omit({ importedAt: true, model: true }),
  allowedTools: ['get_self', 'get_goal_list'].map(t => `mcp__claude_ai_Leapsome__${t}`),
  prompt: `Read my goals from Leapsome with the Leapsome tools, then return them in the required JSON shape.

1. get_self. "manager" is the manager's name.
2. get_goal_list with scope="you", states=${JSON.stringify(config.leapsome.includeArchived ? ['live', 'draft', 'approvalPending', 'archived'] : ['live', 'draft', 'approvalPending'])}, limit=50. If hasMore is true, call it again with the next offset.
   For each goal: id is "_id", status is "status", cycle is the cycle name, deadline is "deadline".
   description is the description with HTML tags removed. Keep link text, drop URLs.`,
});

const file = LeapsomeImport.parse({ ...data, importedAt: new Date().toISOString(), model: config.leapsome.model });
await mkdir('data/imports', { recursive: true });
await writeFile(LEAPSOME_IMPORT_PATH, JSON.stringify(file, null, 2));
console.log(`Imported ${file.goals.length} goals from Leapsome ($${costUsd.toFixed(3)}).`);
