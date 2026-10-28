// Records today's shell-style counts as the ratchet's budget. Run it after a pass has lowered them,
// and commit shell-style-budget.json. A budget only goes down: a count it reports as raised needs
// its reason in the commit message.
//
//   npm run shell-style-budget
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  budgetEntry,
  SHELL_STYLE_CATEGORIES,
  shellStyleCounts,
  type ShellStyleBudget
} from './shell-style.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..', '..');
const budgetFile = path.join(here, 'shell-style-budget.json');

const counts = shellStyleCounts(root);
let previous: ShellStyleBudget = {};
try {
  previous = JSON.parse(readFileSync(budgetFile, 'utf8')) as ShellStyleBudget;
} catch {
  // The first run writes the file.
}

const next: ShellStyleBudget = Object.fromEntries(
  Object.keys(counts)
    .sort()
    .map(file => [file, budgetEntry(counts[file]!)] as const)
    .filter(([, entry]) => Object.keys(entry).length > 0)
);
writeFileSync(budgetFile, `${JSON.stringify(next, null, 2)}\n`);

const total = (budget: ShellStyleBudget) =>
  Object.values(budget).reduce(
    (sum, entry) => sum + Object.values(entry).reduce((a, b) => a + (b ?? 0), 0),
    0
  );
const said: string[] = [];
for (const file of new Set([...Object.keys(previous), ...Object.keys(next)])) {
  for (const category of SHELL_STYLE_CATEGORIES) {
    const before = previous[file]?.[category] ?? 0;
    const after = next[file]?.[category] ?? 0;
    if (after > before) said.push(`raised  ${file} ${category}: ${before} -> ${after}`);
    else if (after < before) said.push(`lowered ${file} ${category}: ${before} -> ${after}`);
  }
}
said.push(`${total(next)} counted in ${Object.keys(next).length} files (was ${total(previous)}).`);
process.stdout.write(`${said.join('\n')}\n`);
