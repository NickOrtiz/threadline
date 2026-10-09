// npm run check: every fixture, the memory file, and the last live state
// must match the schema. Static JSON must always stay a valid input.

import { readdir, readFile } from 'node:fs/promises';
import { ThreadlineView } from './core/schema/view.ts';
import { Memory, MEMORY_PATH } from './storage/memory.ts';
import { TodoFile, TODOS_PATH } from './storage/todos.ts';
import { loadConfig } from './core/config.ts';
import type { z } from 'zod';

const targets: [string, z.ZodType][] = [
  ...(await readdir('fixtures')).filter(f => f.endsWith('.json')).map((f): [string, z.ZodType] => [`fixtures/${f}`, ThreadlineView]),
  [MEMORY_PATH, Memory],
  ['memory/threadline-memory.example.json', Memory],
  [TODOS_PATH, TodoFile],
  ['data/state.json', ThreadlineView],
];

let failed = false;
for (const path of ['threadline.config.example.json', 'threadline.config.json']) {
  await loadConfig(path).then(
    () => console.log(`✓ ${path}`),
    err => {
      if (path === 'threadline.config.json' && /not found/.test(err.message)) { console.log(`- ${path} (not present)`); return; }
      failed = true;
      console.log(`✗ ${path}`, err.message);
    },
  );
}

for (const [path, schema] of targets) {
  let json: unknown;
  try {
    json = JSON.parse(await readFile(path, 'utf8'));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') { console.log(`- ${path} (not present)`); continue; }
    throw err;
  }
  const result = schema.safeParse(json);
  if (result.success) console.log(`✓ ${path}`);
  else { failed = true; console.log(`✗ ${path}`, JSON.stringify(result.error.issues.slice(0, 5), null, 2)); }
}
process.exitCode = failed ? 1 : 0;
