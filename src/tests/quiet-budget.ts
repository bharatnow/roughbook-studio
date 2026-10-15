// Records today's hint-paragraph counts as the quiet budget. Run it after a pass has lowered them,
// and commit quiet-budget.json. A budget only goes down: a file it reports as raised needs its
// reason in the commit message.
//
//   npm run quiet-budget
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { quietCounts } from './quiet.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..', '..');
const budgetFile = path.join(here, 'quiet-budget.json');

const counts = quietCounts(root);
let previous: Record<string, number> = {};
try {
  previous = JSON.parse(readFileSync(budgetFile, 'utf8')) as Record<string, number>;
} catch {
  // The first run writes the file.
}

const next = Object.fromEntries(
  Object.keys(counts)
    .filter(file => counts[file]! > 0)
    .sort()
    .map(file => [file, counts[file]!])
);
writeFileSync(budgetFile, `${JSON.stringify(next, null, 2)}\n`);

const total = (budget: Record<string, number>) =>
  Object.values(budget).reduce((sum, count) => sum + count, 0);
const said: string[] = [];
for (const file of new Set([...Object.keys(previous), ...Object.keys(next)])) {
  const before = previous[file] ?? 0;
  const after = next[file] ?? 0;
  if (after > before) said.push(`raised  ${file}: ${before} -> ${after}`);
  else if (after < before) said.push(`lowered ${file}: ${before} -> ${after}`);
}
said.push(
  `${total(next)} hint paragraphs in ${Object.keys(next).length} files (was ${total(previous)}).`
);
process.stdout.write(`${said.join('\n')}\n`);
