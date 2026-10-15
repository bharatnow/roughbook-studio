import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { budgetProblems, countQuietHints, quietCounts } from './quiet.js';

// The quiet budget (ROUGHBOOK-QUIET-UI-PLAN.md, U1 step 5): the local UI's always-on hint
// paragraphs, per file, may only go down. The web counts its own the same way.

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('the quiet budget', () => {
  it('counts a <p> whose class holds text-slate or text-steel as a hint paragraph', () => {
    assert.equal(countQuietHints(`<p className="text-sm text-slate">Hint</p>`), 1);
    assert.equal(countQuietHints(`<p className="font-mono text-xs text-steel">Kicker</p>`), 1);
    assert.equal(countQuietHints(`<p className="text-sm text-graphite">Body</p>`), 0);
    assert.equal(countQuietHints(`<p>Plain</p>`), 0);
  });

  it('counts only <p>, not <pre>, <path> or a span', () => {
    const source = [
      `<pre className="text-slate">code</pre>`,
      `<path className="text-steel" d="M0 0" />`,
      `<span className="text-slate">aside</span>`,
      `<progress className="text-steel" />`
    ].join('\n');
    assert.equal(countQuietHints(source), 0);
  });

  it('reads attributes across lines, past a > inside an expression or a string', () => {
    const source = `
      <p
        key={item.id}
        onClick={() => setOpen(count > 1)}
        className={cn('mt-1 text-xs', tone === 'warn' ? 'text-danger' : 'text-slate')}
      >
        {count > 1 ? 'Many' : 'One'}
      </p>
      <p title="a > b" className="text-steel">x</p>
      <p className="text-graphite">{'text-slate'}</p>`;
    assert.equal(countQuietHints(source), 2);
  });

  it('finds a file over its budget, or one with hints and no entry', () => {
    assert.deepEqual(budgetProblems({ 'a.tsx': 2, 'b.tsx': 1 }, { 'a.tsx': 2, 'b.tsx': 3 }), []);
    assert.deepEqual(budgetProblems({ 'a.tsx': 3 }, { 'a.tsx': 2 }), [
      'a.tsx has 3 hint paragraphs; its budget is 2.'
    ]);
    assert.deepEqual(budgetProblems({ 'c.tsx': 1 }, {}), [
      'c.tsx has 1 hint paragraph and no budget entry.'
    ]);
    assert.deepEqual(budgetProblems({ 'd.tsx': 0 }, {}), []);
  });

  it('keeps every file of the local UI within the budget', () => {
    const budget = JSON.parse(
      readFileSync(path.join(root, 'src', 'tests', 'quiet-budget.json'), 'utf8')
    ) as Record<string, number>;
    const counts = quietCounts(root);
    assert.ok(Object.keys(counts).length > 10, "the walk found the local UI's components");
    assert.deepEqual(
      budgetProblems(counts, budget),
      [],
      'Move the explanation into a HelpTip, or remove it; run `npm run quiet-budget` only to record a lower count.'
    );
  });
});
