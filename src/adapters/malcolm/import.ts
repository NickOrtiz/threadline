// npm run import:malcolm
//
// Malcolm has no personal API token yet. Until it does, Claude Code reads
// your allocations and leave through the Malcolm connector (see
// ../claude-import.ts). The result is validated and written to
// data/imports/malcolm.json, which the sync reads like any other source.
// Each run costs about one or two cents with the default Haiku model.

import { mkdir, writeFile } from 'node:fs/promises';
import { loadConfig } from '../../core/config.ts';
import { addDays, localDate, weekStart } from '../../core/time.ts';
import { claudeImport } from '../claude-import.ts';
import { MALCOLM_IMPORT_PATH, MalcolmImport } from './schema.ts';

const config = await loadConfig();
if (config.timezone) process.env.TZ = config.timezone;
const email = config.malcolm.email ?? process.env.MALCOLM_EMAIL;
if (!email) {
  console.error('Set malcolm.email in threadline.config.json, or MALCOLM_EMAIL in .env.');
  process.exit(1);
}

const today = localDate(new Date());
const from = weekStart(today);
const to = addDays(from, 34); // this week plus four more

const { data, costUsd } = await claudeImport({
  model: config.malcolm.model,
  schema: MalcolmImport.omit({ importedAt: true, model: true, from: true, to: true }),
  allowedTools: ['get-employees-tool', 'get-allocations-tool', 'get-projects-tool', 'get-upcoming-pto-tool'].map(t => `mcp__claude_ai_Malcolm__${t}`),
  prompt: `Read data from Malcolm with the Malcolm tools, then return it in the required JSON shape.

1. get-employees-tool with search="${email}", exact=true, fields=[id,email,contracted_hours_per_day,working_days]. This is "employee".
2. get-allocations-tool with employee_id=<that id>, start_date="${from}", end_date="${to}", limit=200, fields=[id,project,project_id,billable,type,hours_per_day,start_at,end_at]. These are "allocations".
3. get-projects-tool once for each distinct project_id from step 2 (use id=<project_id>, include_closed=true), fields=[id,name,teamwork_id,project_manager]. These are "projects".
4. get-upcoming-pto-tool with scope="me", start_date="${addDays(from, -7)}", end_date="${addDays(today, 60)}", include_pending=true, fields=[leave_type,status,start_date,end_date,hours]. These are "leave".`,
});

const file = MalcolmImport.parse({ ...data, importedAt: new Date().toISOString(), model: config.malcolm.model, from, to });
await mkdir('data/imports', { recursive: true });
await writeFile(MALCOLM_IMPORT_PATH, JSON.stringify(file, null, 2));
console.log(`Imported ${file.allocations.length} allocations and ${file.leave.length} leave requests from Malcolm ($${costUsd.toFixed(3)}).`);
