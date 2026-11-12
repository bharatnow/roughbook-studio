import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { describeCheck } from '../mcp/tools.js';
import { applyChecks } from '../runs/checks.js';
import {
  MEDIUM_AVOIDED,
  MEDIUM_AVOIDED_UNSURE,
  lookScreenFindings,
  mediaAvoidFindings,
  type LookScreen,
  type MediaStance
} from '../runs/lookScreen.js';
import type { Check, RunRecord } from '../runs/types.js';

// ROUGHBOOK-MEDIA-PLAN.md, V5: a section's or page's run is checked for the media its resolved
// stances avoid, by the look-screen check's scan and words. The backend sends the stances
// already resolved (its mediaStances.ts), so the studio only applies them. The same cases as the
// backend's src/tests/compile/sectionMedia.test.ts.

const hero = `export default function Hero() {
  return (
    <section>
      <h2>Rotas and tips, set down</h2>
      <p>Your week in one place.</p>
    </section>
  );
}
`;
const labelledMap: [string, string] = [
  'map.tsx',
  `export function Map() {
  return (
    <svg viewBox="0 0 600 400" role="img" aria-label="Classes across the city">
      <path d="M0 200 L600 180" />
      <circle cx="140" cy="120" r="8" />
      <text x="150" y="118">Ancoats</text>
      <circle cx="420" cy="260" r="8" />
      <text x="430" y="258">Chorlton</text>
    </svg>
  );
}
`
];
const drawing: [string, string] = [
  'art.tsx',
  `export function Art() {
  return (
    <svg viewBox="0 0 400 300" aria-hidden="true">
      <path d="M10 10 C 80 40, 120 40, 200 10" />
      <circle cx="120" cy="140" r="60" />
      <path d="M40 260 Q 200 180 360 260" />
    </svg>
  );
}
`
];
const tilted: [string, string] = [
  'hero.css',
  '.card {\n  transform: perspective(800px) rotateY(12deg);\n}\n'
];
const browserBar: [string, string] = [
  'shot.tsx',
  'export function Shot() {\n  return <div className="browser-bar"><span>app.coverwell.com</span></div>;\n}\n'
];

const files = (...more: [string, string][]) =>
  new Map<string, string>([['index.tsx', hero], ...more]);

const avoid = (...labels: string[]): MediaStance[] =>
  labels.map(label => ({ label, stance: 'avoid' }));

const checksFor = (media: MediaStance[], pictureStyle: 'type' | null = null): Check[] => [
  { kind: 'entry-file', file: 'index.tsx' },
  { kind: 'media-avoided', media, pictureStyle }
];

const codes = (found: { code: string }[]) => found.map(item => item.code);

describe("a section's media check (V5)", () => {
  it("fails the run on a sure avoided medium, in the look-screen check's words", () => {
    const outcome = applyChecks(checksFor(avoid('3D')), {
      iterationId: 'iteration-01',
      files: files(tilted)
    });
    assert.equal(outcome.failure?.code, MEDIUM_AVOIDED);
    const look = lookScreenFindings(
      files(tilted),
      { subline: '', points: [] } as unknown as LookScreen,
      { media: avoid('3D') }
    ).filter(item => item.code === MEDIUM_AVOIDED);
    assert.equal(outcome.failure?.message, look[0]?.message);
    assert.match(outcome.failure!.message, /a CSS 3D transform in hero\.css, line 2/);
  });

  it('fails on a labelled SVG diagram a page avoids', () => {
    const outcome = applyChecks(checksFor(avoid('SVG diagrams')), {
      iterationId: 'iteration-01',
      files: files(labelledMap)
    });
    assert.equal(outcome.failure?.code, MEDIUM_AVOIDED);
  });

  it('passes when the avoided medium is absent', () => {
    const outcome = applyChecks(checksFor(avoid('3D', 'Video')), {
      iterationId: 'iteration-01',
      files: files()
    });
    assert.equal(outcome.failure, null);
    assert.deepEqual(outcome.warnings, []);
  });

  it('lists Product UI as a warning, never the failure (decision 4)', () => {
    const outcome = applyChecks(checksFor(avoid('Product UI')), {
      iterationId: 'iteration-01',
      files: files(browserBar)
    });
    assert.equal(outcome.failure, null);
    assert.deepEqual(codes(outcome.warnings), [MEDIUM_AVOIDED_UNSURE]);
  });

  it('reads a drawing of shapes from the files as unsure', () => {
    assert.deepEqual(codes(mediaAvoidFindings(files(drawing), avoid('Illustration'))), [
      MEDIUM_AVOIDED_UNSURE
    ]);
  });

  it('is described by get_checks with the media it avoids', () => {
    const run = { targetFolder: 'rough/homepage/hero/iteration-03' } as RunRecord;
    const line = describeCheck(
      {
        kind: 'media-avoided',
        media: [...avoid('3D', 'SVG diagrams'), { label: 'Photography', stance: 'preferred' }],
        pictureStyle: null
      },
      run
    );
    assert.match(line, /^Uses none of the media this section avoids: 3D, SVG diagrams\./);
    assert.doesNotMatch(line, /Photography|does not know/);
  });

  it('never fails on Illustration under the type picture style', () => {
    const outcome = applyChecks(checksFor(avoid('Photography', 'Illustration'), 'type'), {
      iterationId: 'iteration-01',
      files: files(drawing)
    });
    assert.equal(outcome.failure, null);
  });
});
