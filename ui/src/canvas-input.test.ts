import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { layoutCanvas } from '@roughbook/ui/canvas';
import { PROJECT, RUNS } from './canvas-fixture.ts';
import { SKETCH_PICTURE, studioCanvasInput, type StudioCanvas } from './canvas-input.ts';

function cardsOf(canvas: StudioCanvas, page: string, component: string) {
  const frame = canvas.input.sections
    .find(section => section.id === page)
    ?.frames.find(item => item.id === component);
  assert.ok(frame, `${page}/${component} is a frame`);
  return new Map(frame.cards.map(card => [card.id, card]));
}

describe("the studio's canvas input", () => {
  const canvas = studioCanvasInput(PROJECT.tree, RUNS, PROJECT.local);
  const hero = cardsOf(canvas, 'home', 'hero');

  it('has the pages as sections and the components as frames, linked to their screens', () => {
    assert.deepEqual(
      canvas.input.sections.map(section => [section.id, section.href]),
      [
        ['home', '/home'],
        ['about', '/about']
      ]
    );
    assert.deepEqual(
      canvas.input.sections[0]!.frames.map(frame => [frame.id, frame.name, frame.href]),
      [
        ['hero', 'Hero', '/home/hero'],
        ['features', 'Features', '/home/features']
      ]
    );
    assert.equal(canvas.input.designSystem, null);
    assert.equal(hero.get('iteration-01')!.href, '/home/hero/iteration-01');
  });

  it('shows local iterations with a screenshot by it, through the local API', () => {
    assert.equal(
      hero.get('iteration-01')!.thumbnail,
      '/api/iterations/home/hero/iteration-01/screenshots/desktop'
    );
    assert.equal(hero.get('iteration-02')!.thumbnail, null, 'no screenshot yet');
    // An <img> cannot send the token: the server's image key goes in the address.
    const keyed = studioCanvasInput(PROJECT.tree, RUNS, PROJECT.local, { shotKey: 'k_1-2' });
    assert.equal(
      cardsOf(keyed, 'home', 'hero').get('iteration-01')!.thumbnail,
      '/api/iterations/home/hero/iteration-01/screenshots/desktop?key=k_1-2'
    );
    assert.deepEqual(canvas.cards['iteration:home/hero/iteration-01'], {
      kind: 'local',
      run: null,
      generated: true,
      pullable: false
    });
  });

  it("gives each card its glyph: selected, promoted, rejected and folded, a pulled sketch's lineage", () => {
    assert.deepEqual(hero.get('iteration-01')!.status, { glyph: 'selected', word: 'Selected' });
    assert.equal(hero.get('iteration-01')!.selected, true);
    assert.deepEqual(hero.get('iteration-06')!.status, { glyph: 'rejected', word: 'Rejected' });
    assert.equal(hero.get('iteration-06')!.folded, true);
    assert.equal(hero.get('iteration-02')!.from, 'iteration-41');
    assert.equal(hero.get('iteration-02')!.decision, 'exploring');
  });

  it('shows web sketches not yet pulled with a cloud, to pull', () => {
    const sketch = hero.get('iteration-40')!;
    assert.equal(sketch.thumbnail, SKETCH_PICTURE);
    assert.ok(SKETCH_PICTURE.startsWith('data:image/svg+xml,'));
    assert.deepEqual(sketch.status, { glyph: 'none', word: 'On the web' });
    assert.equal(sketch.href, '/home/hero/iterations#iteration-40');
    assert.deepEqual(canvas.cards['iteration:home/hero/iteration-40'], {
      kind: 'sketch',
      run: null,
      generated: true,
      pullable: true
    });
    // One the web is still making shows, and cannot be pulled yet.
    assert.equal(hero.get('iteration-42')!.status.glyph, 'making');
    assert.equal(canvas.cards['iteration:home/hero/iteration-42']!.pullable, false);
    // From a backend without origins, a finished sketch is told by its mode.
    const team = cardsOf(canvas, 'about', 'team');
    assert.equal(canvas.cards['iteration:about/team/iteration-01']!.kind, 'local');
    assert.equal(canvas.cards['iteration:about/team/iteration-02']!.kind, 'sketch');
    assert.equal(team.get('iteration-02')!.thumbnail, SKETCH_PICTURE);
  });

  it("leaves out a sketch pulled into this repo, and another studio's iterations", () => {
    assert.equal(hero.has('iteration-41'), false, 'pulled as iteration-02');
    assert.deepEqual(canvas.pulled['home/hero'], [{ sketch: 'iteration-41', as: 'iteration-02' }]);
    assert.equal(hero.has('iteration-05'), false, "its code is in another designer's repo");
  });

  it('makes open runs making cards, beside what they were made from', () => {
    const fork = hero.get('iteration-03')!;
    assert.deepEqual(fork.status, { glyph: 'making', word: 'Making' });
    assert.equal(fork.beside, 'iteration-01');
    assert.equal(canvas.cards['iteration:home/hero/iteration-03']!.run?.runId, 'run-fork');
    // Started a moment ago: the project read has no record of it yet, so the run is its card.
    const fresh = hero.get('iteration-08')!;
    assert.equal(fresh.name, 'iteration-08');
    assert.equal(fresh.status.glyph, 'making');
    assert.equal(fresh.beside, null);
    assert.equal(fresh.created, '2026-10-15T10:05:00.000Z');
    assert.deepEqual(canvas.cards['iteration:home/hero/iteration-08'], {
      kind: 'run',
      run: RUNS[0],
      generated: false,
      pullable: false
    });
    assert.equal(canvas.making, true);
    // Laid out, the fork sits right after its parent.
    const layout = layoutCanvas(canvas.input);
    const row = layout.items
      .filter(item => item.kind === 'card' && item.parent === 'component:home/hero')
      .map(item => item.id);
    assert.equal(row[row.indexOf('iteration-01') + 1], 'iteration-03');
  });

  it('leaves finished runs no card of their own', () => {
    assert.equal(hero.has('iteration-07'), false, 'failed before it was recorded');
    const first = hero.get('iteration-01')!;
    assert.equal(first.beside, null);
    assert.equal(canvas.cards['iteration:home/hero/iteration-01']!.run, null);
    const quiet = studioCanvasInput(
      PROJECT.tree,
      RUNS.filter(item => item.status === 'finished'),
      PROJECT.local
    );
    assert.equal(quiet.making, false);
    assert.equal(cardsOf(quiet, 'home', 'hero').has('iteration-08'), false);
  });
});
