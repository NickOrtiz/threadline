#!/usr/bin/env node
// Claude Code status line for this project.
//
// Claude Code runs this after each reply and passes session JSON on stdin.
// For subscribers it includes `rate_limits`: how much of the 5-hour and
// weekly windows is used, and when each resets. This script keeps only
// that object and the capture time, in data/claude-usage.json, so the
// dashboard can show it. Paths and the rest of the payload are not stored.
//
// Plain CommonJS on purpose: it must run on whatever Node is first on PATH.
// Docs: https://code.claude.com/docs/en/statusline.md

const fs = require('fs');
const path = require('path');

let input = '';
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  let payload = {};
  try { payload = JSON.parse(input); } catch (e) { /* show a plain line below */ }

  const limits = payload.rate_limits || null;
  const window = (w) => w && typeof w.used_percentage === 'number'
    ? { usedPercent: w.used_percentage, resetsAt: typeof w.resets_at === 'number' ? new Date(w.resets_at * 1000).toISOString() : null }
    : null;
  const snapshot = {
    capturedAt: new Date().toISOString(),
    claudeCodeVersion: payload.version || null,
    // null means Claude Code sent no usage data for this plan or this session yet.
    fiveHour: window(limits && limits.five_hour),
    sevenDay: window(limits && limits.seven_day),
  };

  try {
    const file = path.join(__dirname, '..', 'data', 'claude-usage.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file + '.tmp', JSON.stringify(snapshot, null, 2));
    fs.renameSync(file + '.tmp', file);
  } catch (e) { /* never break the status line over a write */ }

  const model = (payload.model && payload.model.display_name) || 'Claude';
  const pct = (w, label) => (w ? `${label} ${Math.round(w.usedPercent)}%` : null);
  const parts = [model, pct(snapshot.fiveHour, '5h'), pct(snapshot.sevenDay, 'week')].filter(Boolean);
  process.stdout.write(parts.join(' · '));
});
