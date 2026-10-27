// The cards the canvas tells the server it shows (decision 65 of ROUGHBOOK-BROWNFIELD-PLAN.md).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { picturesChanged, SHOWN_MAX, shownCards } from './shown-cards.ts';

const box = (top: number, left: number, size = 100) => ({
  top,
  left,
  bottom: top + size,
  right: left + size
});

describe('the cards on screen', () => {
  it('names those at least partly inside, top to bottom, left to right, once each', () => {
    const keys = shownCards(
      [
        { key: 'iteration:home/b/iteration-00', box: box(300, 50) },
        { key: 'iteration:home/a/iteration-00', box: box(-50, 700) },
        { key: 'iteration:home/c/iteration-00', box: box(300, 10) },
        { key: 'iteration:home/c/iteration-00', box: box(300, 10) },
        { key: 'iteration:home/below/iteration-00', box: box(800, 10) },
        { key: 'iteration:home/left/iteration-00', box: box(10, -200) },
        { key: 'iteration:home/folded/iteration-00', box: { top: 5, left: 5, bottom: 5, right: 5 } }
      ],
      { width: 1024, height: 768 }
    );
    assert.deepEqual(keys, [
      'iteration:home/a/iteration-00',
      'iteration:home/c/iteration-00',
      'iteration:home/b/iteration-00'
    ]);
  });

  it('names at most as many as the server takes', () => {
    const many = Array.from({ length: SHOWN_MAX + 5 }, (_, index) => ({
      key: `iteration:home/c${index}/iteration-00`,
      box: box(index, 0, 10)
    }));
    assert.equal(shownCards(many, { width: 100, height: 10_000 }).length, SHOWN_MAX);
  });

  it('hears new pictures in the change feed', () => {
    assert.equal(picturesChanged(['home/hero/iteration-01']), false);
    assert.equal(picturesChanged(['home/hero/iteration-01', 'map:faq#images']), true);
  });
});
