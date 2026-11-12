import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mediaScan } from '../runs/mediaScan.js';

// ROUGHBOOK-MEDIA-PLAN.md, V2: the look-screen check runs before the render measures anything, so
// it asks the scan for a sure reading of a drawing in the files only where the files are certain:
// an SVG diagram by its own written-out <text>, larger than an icon, outside the header and links.
// A drawing of shapes alone stays 'low' until media-eval measures the file path. The same cases as
// the backend's src/tests/rules/mediaScanSure.test.ts, for the studio's copy.

const svg = (attrs: string, inner: string) =>
  `export function Art() {\n  return (\n    <svg ${attrs}>${inner}</svg>\n  );\n}\n`;

const MAP =
  '<path d="M0 0 L600 400" /><circle cx="1" cy="1" r="4" /><text x="2" y="2">Ancoats</text>';
const DRAWING =
  '<path d="M0 0 C 1 1 2 2 3 3" /><circle cx="1" cy="1" r="4" /><path d="M1 1 Q 2 2 3 3" />';

const read = (text: string, sureFromFiles?: boolean) =>
  mediaScan({ 'art.tsx': text }, undefined, { sureFromFiles }).map(use => [
    use.medium,
    use.confidence
  ]);

describe('the media scan, sure from the files', () => {
  it('stays low without the option, as before', () => {
    assert.deepEqual(read(svg('viewBox="0 0 600 400"', MAP)), [['SVG diagrams', 'low']]);
    assert.deepEqual(read(svg('viewBox="0 0 600 400"', MAP), false), [['SVG diagrams', 'low']]);
  });

  it("reads a labelled drawing surely, and a plain one by decision 7's line but low", () => {
    assert.deepEqual(read(svg('viewBox="0 0 600 400"', MAP), true), [['SVG diagrams', 'high']]);
    assert.deepEqual(read(svg('viewBox="0 0 400 300"', DRAWING), true), [['Illustration', 'low']]);
  });

  it('keeps connectors without text low', () => {
    const lines = '<line x1="0" y1="0" x2="9" y2="9" /><line x1="9" y1="0" x2="0" y2="9" />';
    assert.deepEqual(read(svg('viewBox="0 0 600 400"', lines), true), [['SVG diagrams', 'low']]);
  });

  it('keeps a wordmark in the header, the nav or a link low', () => {
    const mark = (open: string, close: string) =>
      `export function Top() {
  return (
    ${open}<svg viewBox="0 0 120 32">${MAP}</svg>${close}
  );
}
`;
    const wrappers: [string, string][] = [
      ['<header className="top">', '</header>'],
      ['<nav>', '</nav>'],
      ['<a href="/">', '</a>']
    ];
    for (const [open, close] of wrappers) {
      assert.deepEqual(read(mark(open, close), true), [['SVG diagrams', 'low']], open);
    }
  });

  it('keeps a drawing composed from expressions low, as its text may be elsewhere in the file', () => {
    const composed = svg(
      'viewBox="0 0 600 400"',
      '{places.map(place => <circle key={place} cx="1" cy="1" r="4" />)}'
    );
    const file = `const places = ['a', 'b'];
const note = <text>Ancoats</text>;
${composed}`;
    assert.deepEqual(read(file, true), [['SVG diagrams', 'low']]);
  });

  it('takes its own size when it has no viewBox', () => {
    assert.deepEqual(read(svg('width="320" height="200"', MAP), true), [['SVG diagrams', 'high']]);
    assert.deepEqual(read(svg('width="80" height="60"', MAP), true), [['SVG diagrams', 'low']]);
  });

  it('keeps a drawing no larger than a control icon low', () => {
    assert.deepEqual(read(svg('viewBox="0 0 80 60"', DRAWING), true), [['Illustration', 'low']]);
    assert.deepEqual(read(svg('viewBox="0 0 24 24"', DRAWING), true), []);
  });

  it('keeps a reading that is unclear by its contents low', () => {
    assert.deepEqual(read(svg('viewBox="0 0 400 300"', '<circle cx="1" cy="1" r="40" />'), true), [
      ['Illustration', 'low']
    ]);
  });
});
