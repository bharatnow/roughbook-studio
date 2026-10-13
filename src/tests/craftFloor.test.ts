import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { describeCheck } from '../mcp/tools.js';
import { applyChecks } from '../runs/checks.js';
import { craftFloorFindings } from '../runs/craftFloor.js';
import type { Check, RunRecord } from '../runs/types.js';

// The same cases as the backend's src/tests/compile/craftFloor.test.ts: the backend sends the
// craft-floor check, and both sides apply it the same way.
const rough = `export default function Hero() {
  return (
    <section className="transition-all">
      <h1>Lorem ipsum dolor sit amet</h1>
      <p>Signed, Jane Doe</p>
      <img src="/a.png" />
      <img
        src="/b.png"
        alt="Bowls on a shelf"
      />
      <button className="outline-none" onClick={() => {}}><ArrowRight /></button>
      <a className="outline-none focus-visible:ring-2" href="#">Read</a>
    </section>
  );
}
`;
const roughCss = `.card { transition: all 200ms; }
.card:focus { outline: none; }
`;
const clean = `export default function Hero() {
  return (
    <section className="transition-transform">
      <h1>A new batch is out of the kiln.</h1>
      <img src="/a.png" alt="" />
      <button aria-label="Next" className="outline-none focus-visible:ring-2"><ArrowRight aria-hidden /></button>
    </section>
  );
}
`;

describe('the craft floor', () => {
  it('names each kind of slip once per file, with how often', () => {
    const findings = craftFloorFindings(
      new Map([
        ['index.tsx', rough],
        ['styles.css', roughCss]
      ])
    );
    assert.deepEqual(
      findings.map(finding => finding.code),
      [
        'PLACEHOLDER_COPY',
        'TRANSITION_ALL',
        'IMG_WITHOUT_ALT',
        'ICON_BUTTON_UNNAMED',
        'OUTLINE_WITHOUT_FOCUS',
        'TRANSITION_ALL',
        'OUTLINE_WITHOUT_FOCUS'
      ]
    );
    assert.match(findings[0]!.message, /^index\.tsx has placeholder copy/);
    assert.match(findings[2]!.message, /^index\.tsx has 1 img without alt text/);
    assert.match(findings[5]!.message, /^styles\.css transitions every property/);
  });

  it('finds nothing in a section that keeps to it', () => {
    assert.deepEqual(craftFloorFindings(new Map([['index.tsx', clean]])), []);
  });

  it('runs as a check the backend sends, as warnings only, and an agent can read it', () => {
    const checks: Check[] = [{ kind: 'entry-file', file: 'index.tsx' }, { kind: 'craft-floor' }];
    const outcome = applyChecks(checks, {
      iterationId: 'iteration-03',
      files: new Map([['index.tsx', rough]])
    });
    assert.equal(outcome.failure, null);
    assert.ok(outcome.warnings.some(warning => warning.code === 'TRANSITION_ALL'));
    assert.equal(
      applyChecks([{ kind: 'entry-file', file: 'index.tsx' }], {
        iterationId: 'iteration-03',
        files: new Map([['index.tsx', rough]])
      }).warnings.length,
      0,
      'only when the backend asks for it'
    );
    const run = { targetFolder: 'rough/homepage/hero/iteration-03' } as RunRecord;
    assert.match(describeCheck({ kind: 'craft-floor' }, run), /lorem ipsum/);
    // A kind this studio does not know is still described, not printed as undefined.
    assert.match(describeCheck({ kind: 'later-kind' } as unknown as Check, run), /later-kind/);
  });
});
