// Shared helper for sources with no personal API token yet (Malcolm, Leapsome).
//
// It asks Claude Code to read the source through its claude.ai connector and
// return JSON that matches a fixed schema. Claude Code validates the output
// against the schema, and the caller validates it again with Zod. The run
// happens in a temporary folder, so no project instructions are loaded.

import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { z } from 'zod';

export interface ClaudeImportOptions<T extends z.ZodType> {
  prompt: string;
  schema: T;
  /** Exact tool names Claude may call. Everything else is denied. */
  allowedTools: string[];
  model: string;
}

export async function claudeImport<T extends z.ZodType>(opts: ClaudeImportOptions<T>): Promise<{ data: z.infer<T>; costUsd: number }> {
  // The CLI's validator rejects the $schema header Zod adds, so drop it.
  const { $schema: _dialect, ...jsonSchema } = z.toJSONSchema(opts.schema) as Record<string, unknown>;
  const args = [
    '-p', `${opts.prompt}\n\nCopy every value exactly as a tool returns it. Do not estimate, round, or invent anything. Use null when a tool gives no value.`,
    '--model', opts.model,
    '--output-format', 'json',
    '--json-schema', JSON.stringify(jsonSchema),
    '--allowedTools', opts.allowedTools.join(','),
  ];

  const output = await new Promise<string>((resolve, reject) => {
    const child = spawn('claude', args, { cwd: tmpdir(), stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.on('data', c => { out += c; });
    child.stderr.on('data', c => { err += c; });
    child.on('error', () => reject(new Error('The claude CLI was not found. Install Claude Code and log in.')));
    child.on('close', code => (code === 0 ? resolve(out) : reject(new Error(`claude exited with ${code}: ${(err || out).slice(0, 300)}`))));
  });

  const result = JSON.parse(output) as { is_error?: boolean; structured_output?: unknown; result?: string; total_cost_usd?: number };
  if (result.is_error || !result.structured_output) throw new Error(`Claude returned no data: ${String(result.result ?? '').slice(0, 300)}`);
  return { data: opts.schema.parse(result.structured_output), costUsd: result.total_cost_usd ?? 0 };
}
