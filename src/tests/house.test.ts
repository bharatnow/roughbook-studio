import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { describeCheck } from '../mcp/tools.js';
import { applyChecks } from '../runs/checks.js';
import type { Check, RunRecord } from '../runs/types.js';
import { liftedDefaults, liftedIds } from '../rules/vendor/houseRules.js';

// The house rules in a studio run (ROUGHBOOK-STUDIO-PARITY-PLAN.md, T1): the backend lifts a
// default from the designer's own words and sends the ids with the run's house check; the studio
// runs the backend's own scan (src/rules/vendor/houseChecks.ts) and drops what was lifted. The
// backend's src/tests/studioRuns.test.ts proves the same from its side.

const entry = { kind: 'entry-file', file: 'index.tsx' } as const;
const tall = new Map([
  ['index.tsx', '<section className="min-h-screen bg-[var(--surface)]">Fernside</section>']
]);
const run = { targetFolder: 'rough/homepage/hero/iteration-03' } as RunRecord;

/** The checks the backend sends a run whose designer wrote these words. */
function checksFor(words: string): Check[] {
  const lifted = liftedIds(liftedDefaults({ words: [{ from: 'instructions', text: words }] }));
  return [entry, { kind: 'house', lifted }];
}
const codes = (checks: Check[], files: Map<string, string>) => {
  const outcome = applyChecks(checks, { iterationId: 'iteration-03', files });
  return {
    failure: outcome.failure?.code ?? null,
    warnings: outcome.warnings.map(item => item.code)
  };
};

describe('the house check', () => {
  it('does not warn for a full-height opener the brief asked for, and warns when it did not', () => {
    const asked = checksFor('Open with a full-height opener: the photo fills the first screen.');
    // The critic's empty-hero tell follows the default, as on the web (houseRules.ts follows).
    assert.deepEqual(asked[1], { kind: 'house', lifted: ['no-full-height', 'critic:empty-hero'] });
    assert.deepEqual(codes(asked, tall), { failure: null, warnings: [] });

    const plain = checksFor('A quiet section about the clinic.');
    assert.deepEqual(plain[1], { kind: 'house', lifted: [] });
    assert.deepEqual(codes(plain, tall), { failure: null, warnings: ['HOUSE_FULL_HEIGHT'] });
    // Refused in the designer's words, it stays a default.
    assert.deepEqual(checksFor('Never a full-height opener.')[1], { kind: 'house', lifted: [] });
    // A studio the backend sends no house check finds nothing new.
    assert.deepEqual(codes([entry], tall), { failure: null, warnings: [] });
  });

  it('fails a floor whatever was lifted, and drops a lifted default from every check', () => {
    const moving = new Map([
      [
        'index.tsx',
        '<div className="backdrop-blur-md animate-[drift_4s_linear_infinite] bg-gradient-to-r from-purple-500 to-blue-500">Fernside</div>'
      ]
    ]);
    const held = codes(
      [...checksFor(''), { kind: 'detector', tells: ['purple-gradient'], fonts: [] }],
      moving
    );
    // The first floor's finding fails the check; the second follows the warnings.
    assert.equal(held.failure, 'REDUCED_MOTION_MISSING');
    assert.ok(held.warnings.includes('OPAQUE_MISSING'));
    assert.ok(held.warnings.includes('TELL_DECORATIVE_GLASS'));
    assert.ok(held.warnings.includes('TELL_PURPLE_GRADIENT'));

    // The designer asked for glass and a purple-to-blue gradient: the detector's finding and the
    // house check's are both dropped, and both floors still hold.
    const words = 'A frosted glass panel over a purple-to-blue gradient.';
    const lifted = codes(
      [...checksFor(words), { kind: 'detector', tells: ['purple-gradient'], fonts: [] }],
      moving
    );
    assert.equal(lifted.failure, 'REDUCED_MOTION_MISSING');
    assert.deepEqual(lifted.warnings, ['OPAQUE_MISSING']);

    // With a reduced-motion path and an opaque version, nothing fails.
    const kept = new Map([
      ...moving,
      [
        'styles.css',
        '@media (prefers-reduced-motion: reduce) { * { animation: none; } }\n@media (prefers-reduced-transparency: reduce) { div { backdrop-filter: none; } }'
      ]
    ]);
    assert.deepEqual(codes(checksFor(words), kept), { failure: null, warnings: [] });
  });

  it('is described to the agent: the floors fail, the defaults warn, and what was lifted', () => {
    const lifted = describeCheck({ kind: 'house', lifted: ['no-full-height'] }, run);
    assert.match(lifted, /6 floors hold whatever the direction and are never lifted/);
    assert.match(lifted, /fails the check until it is fixed/);
    assert.match(lifted, /Lifted by the designer's own words[^]*No section is sized to the window/);
    assert.match(
      describeCheck({ kind: 'house', lifted: [] }, run),
      /only the designer's own words in the brief or the run's instructions lift a default/
    );
  });
});
