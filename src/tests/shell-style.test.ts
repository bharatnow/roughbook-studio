import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  shellStyleCounts,
  shellStyleProblems,
  styleCounts,
  type ShellStyleBudget
} from './shell-style.js';

// The shell-style ratchet (ROUGHBOOK-APPLE-PLAN.md, A1 step 1; the web keeps the same one in
// src/lib/shell-style.ts): the habits A11 retires, counted per file of the local UI. A count may
// only go down.

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('the shell-style ratchet', () => {
  it('counts text at 11 px or less, in classes and style objects', () => {
    assert.equal(styleCounts(`'text-[11px] text-[10px] text-[0.625rem]'`)['small-text'], 3);
    assert.equal(
      styleCounts(`style={{ fontSize: 11 }} style={{ fontSize: '9px' }}`)['small-text'],
      2
    );
    assert.equal(styleCounts(`'text-[12px] text-xs text-[0.75rem]'`)['small-text'], 0);
    assert.equal(styleCounts(`fontSize: 13`)['small-text'], 0);
  });

  it('counts uppercase, tracking-[ and shadow-[', () => {
    const counts = styleCounts(
      `'font-mono text-[11px] uppercase tracking-[0.08em] shadow-[0_1px_1px_rgba(0,0,0,0.1)]'`
    );
    assert.equal(counts.uppercase, 1);
    assert.equal(counts.tracking, 1);
    assert.equal(counts.shadow, 1);
    assert.equal(styleCounts(`s.toUpperCase(); 'tracking-tight shadow-sm'`).uppercase, 0);
    assert.equal(styleCounts(`'tracking-tight shadow-sm'`).tracking, 0);
    assert.equal(styleCounts(`'tracking-tight shadow-sm'`).shadow, 0);
  });

  it('counts raw hex and rgba inside class arbitrary values, not elsewhere', () => {
    assert.equal(styleCounts(`'size-4 accent-[#5e4cff]'`)['raw-color'], 1);
    assert.equal(styleCounts(`'shadow-[0_8px_30px_rgba(39,40,53,0.12)]'`)['raw-color'], 1);
    assert.equal(styleCounts(`'bg-[rgb(1,2,3)] text-[#fff]'`)['raw-color'], 2);
    assert.equal(styleCounts(`theme: { background: '#1a1b25' }`)['raw-color'], 0);
    assert.equal(styleCounts(`'max-w-[calc(100vw-2rem)]'`)['raw-color'], 0);
  });

  it('counts outline-none only when its class string shows no focus', () => {
    assert.equal(styleCounts(`'px-2 outline-none hover:bg-frost'`)['outline-none'], 1);
    assert.equal(
      styleCounts(`'outline-none focus-visible:ring-2 focus-visible:ring-violet'`)['outline-none'],
      0
    );
    assert.equal(styleCounts(`"border outline-none focus:border-violet"`)['outline-none'], 0);
    assert.equal(
      styleCounts('`outline-none ${on ? "a" : "b"} focus-visible:outline-none`')['outline-none'],
      1
    );
  });

  it('counts title= on an element other than <iframe>, not on components', () => {
    assert.equal(styleCounts(`<span title="Why">x</span>`).title, 1);
    assert.equal(styleCounts(`<button\n  type="button"\n  title={label}\n>`).title, 1);
    assert.equal(styleCounts(`<iframe title="Sketch" src={url} />`).title, 0);
    assert.equal(styleCounts(`<Drawer open title="Refine">x</Drawer>`).title, 0);
    assert.equal(styleCounts(`<Panel icon={<b title="inner" />} title="outer" />`).title, 1);
    assert.equal(styleCounts(`<a data-title="x" aria-label="t">x</a>`).title, 0);
  });

  it('counts violet and text-white classes', () => {
    const counts = styleCounts(
      `'bg-violet text-white focus-visible:ring-violet hover:bg-violet/90'`
    );
    assert.equal(counts.violet, 3);
    assert.equal(counts['text-white'], 1);
    assert.equal(styleCounts(`'text-whitesmoke violets'`)['text-white'], 0);
    assert.equal(styleCounts(`'text-whitesmoke violets'`).violet, 0);
  });

  it('skips comment lines', () => {
    const counts = styleCounts(
      `// uppercase text-white violet\n  /* shadow-[x] */\n  {/* bg-violet */}`
    );
    assert.deepEqual(
      Object.values(counts).filter(count => count > 0),
      []
    );
  });

  it('finds a file over its budget in any category, or a counted file with no entry', () => {
    const counts = {
      'a.tsx': styleCounts(`'uppercase text-white'`),
      'b.tsx': styleCounts(`'bg-violet bg-violet'`),
      'c.tsx': styleCounts(`'text-graphite'`)
    };
    const budget: ShellStyleBudget = {
      'a.tsx': { uppercase: 1, 'text-white': 1 },
      'b.tsx': { violet: 1 }
    };
    assert.deepEqual(shellStyleProblems(counts, budget), ['b.tsx has 2 violet; its budget is 1.']);
    assert.deepEqual(shellStyleProblems(counts, {}), [
      'a.tsx has 1 uppercase, 1 text-white and no budget entry.',
      'b.tsx has 2 violet and no budget entry.'
    ]);
    assert.deepEqual(
      shellStyleProblems(counts, { 'a.tsx': { uppercase: 1 }, 'b.tsx': { violet: 2 } }),
      ['a.tsx has 1 text-white; its budget is 0.']
    );
  });

  it('keeps every file of the local UI within its budget', () => {
    const budget = JSON.parse(
      readFileSync(path.join(root, 'src', 'tests', 'shell-style-budget.json'), 'utf8')
    ) as ShellStyleBudget;
    const counts = shellStyleCounts(root);
    assert.ok(Object.keys(counts).length > 10, "the walk found the local UI's files");
    assert.deepEqual(
      shellStyleProblems(counts, budget),
      [],
      'Use a token, a type-ramp class or a visible focus instead; run `npm run shell-style-budget` only to record a lower count.'
    );
  });
});
