import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { addressFor, parseRoute } from './router.ts';

describe("the studio's addresses", () => {
  it('opens the canvas on the project, a page, a component and its iterations', () => {
    assert.deepEqual(parseRoute(''), { screen: 'canvas', focus: { kind: 'project' } });
    assert.deepEqual(parseRoute('#/'), { screen: 'canvas', focus: { kind: 'project' } });
    assert.deepEqual(parseRoute('#/home'), {
      screen: 'canvas',
      focus: { kind: 'page', page: 'home' }
    });
    assert.deepEqual(parseRoute('#/home/hero'), {
      screen: 'canvas',
      focus: { kind: 'component', page: 'home', component: 'hero' }
    });
    // The old component screen's address.
    assert.deepEqual(parseRoute('#/home/hero/iterations'), {
      screen: 'canvas',
      focus: { kind: 'iterations', page: 'home', component: 'hero' }
    });
    // A card, as selecting one writes it.
    assert.deepEqual(parseRoute('#/home/hero/iterations#iteration-03'), {
      screen: 'canvas',
      focus: { kind: 'iteration', page: 'home', component: 'hero', iteration: 'iteration-03' }
    });
  });

  it("opens a terminal session in the canvas's dock, where its own screen was", () => {
    assert.deepEqual(parseRoute('#/terminals/11111111-1111-4111-8111-111111111111'), {
      screen: 'canvas',
      focus: { kind: 'project' },
      session: '11111111-1111-4111-8111-111111111111'
    });
  });

  it('keeps the stage and Compare as their own screens', () => {
    assert.deepEqual(parseRoute('#/home/hero/iteration-03?refine=1'), {
      screen: 'iteration',
      page: 'home',
      component: 'hero',
      iteration: 'iteration-03',
      refine: true
    });
    assert.deepEqual(parseRoute('#/home/hero/iterations/compare?ids=iteration-01,iteration-02'), {
      screen: 'compare',
      page: 'home',
      component: 'hero',
      ids: ['iteration-01', 'iteration-02']
    });
    assert.deepEqual(parseRoute('#/home/hero/nothing'), { screen: 'missing' });
  });

  it('writes the address of what the canvas selects, which opens on it again', () => {
    for (const key of [
      null,
      'page:home',
      'component:home/hero',
      'iteration:home/hero/iteration-03',
      'folded:home/hero'
    ]) {
      const address = addressFor(key);
      assert.equal(parseRoute(address).screen, 'canvas', address);
    }
    assert.equal(addressFor(null), '#/');
    assert.equal(
      addressFor('iteration:home/hero/iteration-03'),
      '#/home/hero/iterations#iteration-03'
    );
    assert.equal(addressFor('folded:home/hero'), '#/home/hero');
  });
});
