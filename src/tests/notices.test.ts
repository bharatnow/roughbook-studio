import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

// The notices budget (ROUGHBOOK-APPLE-PLAN.md, A8 step 5): what the local UI says back is an
// <output> line beside the control that was used, never a notice in the corner. There were 29
// say() sites; the budget ended at none, and stays there. window.confirm became a sheet.

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ui = path.join(root, 'ui', 'src');

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sources(full);
    return /\.tsx?$/.test(entry.name) && !entry.name.endsWith('.test.ts') ? [full] : [];
  });
}

/** Calls of say(…), as a word of its own: not `essay(` or `.say(` in a comment's prose. */
function countSays(source: string): number {
  return source.match(/(?<![\w.])say\(/g)?.length ?? 0;
}

function countIn(pattern: RegExp): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const file of sources(ui)) {
    const text = readFileSync(file, 'utf8');
    const found = pattern === SAY ? countSays(text) : (text.match(pattern)?.length ?? 0);
    if (found) counts[path.relative(root, file).replaceAll('\\', '/')] = found;
  }
  return counts;
}

const SAY = /say\(/g;

describe('the notices budget', () => {
  it('counts say( as a call of its own', () => {
    assert.equal(countSays(`say({ tone: 'info', text })`), 1);
    assert.equal(countSays(`if (x) say(null); else say(y);`), 2);
    assert.equal(countSays(`essay(1); props.say(2); sayHello()`), 0);
  });

  it('has no say() left in the local UI', () => {
    assert.deepEqual(countIn(SAY), {});
  });

  it('asks in a sheet, never with window.confirm', () => {
    assert.deepEqual(countIn(/window\.confirm\(/g), {});
  });

  it('has no Notice in the corner', () => {
    assert.deepEqual(countIn(/<Notice\b/g), {});
  });
});
